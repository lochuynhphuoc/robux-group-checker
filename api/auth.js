const {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual
} = require('crypto');
const { ObjectId, MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
const SESSION_COOKIE = 'rocheck_session';
const SESSION_DAYS = 30;
const MAX_SAVED_LISTS = 20;
const MAX_GROUPS_PER_LIST = 100;

let clientPromise;
let indexesPromise;

async function connectToDatabase() {
  if (!MONGODB_URI) throw new Error('Account storage is not configured.');
  if (!clientPromise) {
    const client = new MongoClient(MONGODB_URI, {
      connectTimeoutMS: 5000,
      serverSelectionTimeoutMS: 5000
    });
    clientPromise = client.connect().catch(error => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}

async function getCollections() {
  const client = await connectToDatabase();
  const db = client.db('rocheck');
  if (!indexesPromise) {
    indexesPromise = Promise.all([
      db.collection('users').createIndex({ usernameLower: 1 }, { unique: true }),
      db.collection('sessions').createIndex({ tokenHash: 1 }, { unique: true }),
      db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
    ]).catch(error => {
      indexesPromise = null;
      throw error;
    });
  }
  await indexesPromise;
  return { users: db.collection('users'), sessions: db.collection('sessions') };
}

function parseCookies(req) {
  const header = req.headers?.cookie || '';
  return Object.fromEntries(header.split(';').map(part => {
    const index = part.indexOf('=');
    return index < 0 ? [] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(pair => pair.length));
}

function publicUser(user) {
  return {
    id: user._id.toString(),
    username: user.username,
    lists: (user.savedLists || []).map(list => ({
      id: list.id,
      name: list.name,
      groupIds: list.groupIds
    }))
  };
}

function normalizeUsername(value) {
  if (typeof value !== 'string') throw new Error('Username is required.');
  const username = value.trim();
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
    throw new Error('Username must be 3-24 characters using letters, numbers, or underscore.');
  }
  return username;
}

function normalizeGroups(value) {
  if (!Array.isArray(value) || !value.length || value.length > MAX_GROUPS_PER_LIST) {
    throw new Error(`Choose between 1 and ${MAX_GROUPS_PER_LIST} groups.`);
  }
  const ids = [...new Set(value.map(id => Number(id)))];
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Group IDs are invalid.');
  return ids;
}

function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString('hex');
}

function createPasswordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${hashPassword(password, salt)}`;
}

function verifyPassword(password, stored) {
  const [salt, expected] = String(stored).split(':');
  if (!salt || !expected) return false;
  const actual = Buffer.from(hashPassword(password, salt), 'hex');
  const target = Buffer.from(expected, 'hex');
  return actual.length === target.length && timingSafeEqual(actual, target);
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`);
}

async function getCurrentUser(req, collections) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const session = await collections.sessions.findOne({ tokenHash: tokenHash(token), expiresAt: { $gt: new Date() } });
  if (!session) return null;
  return collections.users.findOne({ _id: new ObjectId(session.userId) });
}

function respondError(res, error, status = 400) {
  return res.status(status).json({ error: error.message || 'Account request failed.' });
}

module.exports = async function handler(req, res) {
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  try {
    const collections = await getCollections();
    const action = req.query?.action || req.body?.action || (req.method === 'GET' ? 'me' : '');

    if (action === 'me') {
      const user = await getCurrentUser(req, collections);
      return res.status(200).json({ user: user ? publicUser(user) : null });
    }

    if (action === 'logout') {
      const token = parseCookies(req)[SESSION_COOKIE];
      if (token) await collections.sessions.deleteOne({ tokenHash: tokenHash(token) });
      res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
      return res.status(200).json({ success: true });
    }

    if (action === 'register' || action === 'login') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
      const username = normalizeUsername(req.body?.username);
      const password = req.body?.password;
      if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
        return res.status(400).json({ error: 'Password must be 8-128 characters.' });
      }

      let user = await collections.users.findOne({ usernameLower: username.toLowerCase() });
      if (action === 'register') {
        if (user) return res.status(409).json({ error: 'This account already exists.' });
        user = {
          username,
          usernameLower: username.toLowerCase(),
          passwordHash: createPasswordHash(password),
          savedLists: [],
          createdAt: new Date()
        };
        const result = await collections.users.insertOne(user);
        user._id = result.insertedId;
      } else if (!user || !verifyPassword(password, user.passwordHash)) {
        return res.status(401).json({ error: 'Incorrect username or password.' });
      }

      const token = randomBytes(32).toString('base64url');
      await collections.sessions.insertOne({
        tokenHash: tokenHash(token),
        userId: user._id.toString(),
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + SESSION_DAYS * 86400 * 1000)
      });
      setSessionCookie(res, token);
      return res.status(200).json({ user: publicUser(user) });
    }

    const user = await getCurrentUser(req, collections);
    if (!user) return res.status(401).json({ error: 'Please log in to manage saved groups.' });
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

    if (action === 'save-list') {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 40) : '';
      if (!name) return res.status(400).json({ error: 'List name is required.' });
      const groupIds = normalizeGroups(req.body?.groupIds);
      const list = {
        id: randomBytes(8).toString('hex'),
        name,
        groupIds,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      if ((user.savedLists || []).length >= MAX_SAVED_LISTS) {
        return res.status(400).json({ error: `You can save up to ${MAX_SAVED_LISTS} lists.` });
      }
      await collections.users.updateOne({ _id: user._id }, { $push: { savedLists: list } });
      return res.status(200).json({ user: publicUser({ ...user, savedLists: [...(user.savedLists || []), list] }) });
    }

    if (action === 'delete-list') {
      const listId = String(req.body?.listId || '');
      await collections.users.updateOne({ _id: user._id }, { $pull: { savedLists: { id: listId } } });
      return res.status(200).json({ user: publicUser({ ...user, savedLists: (user.savedLists || []).filter(list => list.id !== listId) }) });
    }

    return res.status(400).json({ error: 'Unknown account action.' });
  } catch (error) {
    console.error('Account request failed:', error.message);
    const clientError = /required|must be|choose between|invalid|log in|unknown account/i.test(error.message || '');
    return respondError(res, error, error.code === 11000 ? 409 : clientError ? 400 : 500);
  }
};
