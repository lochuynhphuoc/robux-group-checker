const { createHmac } = require('crypto');
const { isIP } = require('net');
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
const ROBLOX_API_KEY = process.env.ROBLOX_API_KEY || "";
const ROBLOX_REQUEST_TIMEOUT_MS = 8000;
const CHECK_TIMEOUT_MS = 60_000;
const GROUPS_PER_PAGE = 8;
const JOIN_DATE_CONCURRENCY = 3;
const RATE_LIMIT_PER_MINUTE = 20;
const RATE_LIMIT_PER_HOUR = 120;
const RATE_LIMIT_TTL_MS = 2 * 60 * 60 * 1000;

const headers = {
  "User-Agent": "RoSealGroupCheckerWeb/2.0",
  "Content-Type": "application/json"
};

let cachedClientPromise;
let rateLimitCollectionPromise;

async function connectToDatabase() {
  if (!MONGODB_URI) throw new Error("Request protection is unavailable: MONGODB_URI is not configured.");
  if (!cachedClientPromise) {
    const client = new MongoClient(MONGODB_URI, { connectTimeoutMS: 5000, serverSelectionTimeoutMS: 5000 });
    cachedClientPromise = client.connect().catch(error => {
      cachedClientPromise = null;
      throw error;
    });
  }
  return cachedClientPromise;
}

async function getRateLimitCollection() {
  if (!rateLimitCollectionPromise) {
    rateLimitCollectionPromise = connectToDatabase()
      .then(client => client.db('rocheck').collection('request_rate_limits'))
      .then(async collection => {
        await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
        return collection;
      })
      .catch(error => {
        rateLimitCollectionPromise = null;
        throw error;
      });
  }
  return rateLimitCollectionPromise;
}

function getClientIp(req) {
  const realIp = req.headers?.['x-real-ip'];
  const forwardedFor = req.headers?.['x-forwarded-for'];
  const candidate = (typeof realIp === 'string' ? realIp : typeof forwardedFor === 'string' ? forwardedFor.split(',')[0] : '')
    .trim()
    .replace(/^::ffff:/i, '')
    .replace(/^\[([^\]]+)\](?::\d+)?$/, '$1');
  return isIP(candidate) ? candidate : null;
}

async function checkRateLimit(req, res) {
  const ip = getClientIp(req);
  if (!ip) {
    res.status(503).json({ error: "Could not verify the request IP. Please try again later." });
    return false;
  }

  const now = Date.now();
  const minuteWindow = Math.floor(now / 60_000) * 60_000;
  const hourWindow = Math.floor(now / 3_600_000) * 3_600_000;
  const id = createHmac('sha256', MONGODB_URI || 'missing-mongodb-uri').update(ip).digest('hex');
  const collection = await getRateLimitCollection();
  const update = [{
    $set: {
      minuteCount: {
        $cond: [
          { $eq: ['$minuteWindow', minuteWindow] },
          { $add: [{ $ifNull: ['$minuteCount', 0] }, 1] },
          1
        ]
      },
      hourCount: {
        $cond: [
          { $eq: ['$hourWindow', hourWindow] },
          { $add: [{ $ifNull: ['$hourCount', 0] }, 1] },
          1
        ]
      },
      minuteWindow,
      hourWindow,
      expiresAt: new Date(now + RATE_LIMIT_TTL_MS)
    }
  }];
  const options = { upsert: true, returnDocument: 'after', includeResultMetadata: false, maxTimeMS: 3000 };
  let record;
  try {
    record = await collection.findOneAndUpdate({ _id: id }, update, options);
  } catch (error) {
    if (error.code !== 11000) throw error;
    record = await collection.findOneAndUpdate({ _id: id }, update, { ...options, upsert: false });
  }

  if (!record) throw new Error("Could not update the request rate limit.");
  if (record.minuteCount > RATE_LIMIT_PER_MINUTE || record.hourCount > RATE_LIMIT_PER_HOUR) {
    const retryAfter = record.minuteCount > RATE_LIMIT_PER_MINUTE
      ? Math.ceil((minuteWindow + 60_000 - now) / 1000)
      : Math.ceil((hourWindow + 3_600_000 - now) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({ error: "Too many checks from this network. Please wait before trying again." });
    return false;
  }
  return true;
}

async function roblox(url, options = {}) {
  const requestTimeout = AbortSignal.timeout(ROBLOX_REQUEST_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, requestTimeout]) : requestTimeout;
  const r = await fetch(url, {
    ...options,
    signal,
    headers: { ...headers, ...(options.headers || {}) }
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!r.ok) throw new Error(`${r.status}: ${text.slice(0, 300)}`);
  return data;
}

function duration(iso) {
  const d = new Date(iso), n = new Date();
  let y = n.getUTCFullYear() - d.getUTCFullYear(), m = n.getUTCMonth() - d.getUTCMonth(), day = n.getUTCDate() - d.getUTCDate();
  if (day < 0) { m--; const prev = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 0)); day += prev.getUTCDate(); }
  if (m < 0) { y--; m += 12; }
  const parts = [];
  if (y) parts.push(`${y} year${y !== 1 ? 's' : ''}`);
  if (m) parts.push(`${m} month${m !== 1 ? 's' : ''}`);
  if (!y && !m) parts.push(`${Math.max(day, 0)} day${day !== 1 ? 's' : ''}`);
  return parts.join(', ') || 'Just now';
}

function parseGroupIds(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' && !Array.isArray(value)) {
    throw new Error("Group links or IDs must be text.");
  }

  const entries = (Array.isArray(value) ? value : value.split(/[\s,;]+/))
    .map(item => String(item).trim())
    .filter(Boolean);
  if (!entries.length) return null;

  const ids = [];
  for (const entry of entries) {
    const match = /^\d+$/.test(entry)
      ? [entry, entry]
      : entry.match(/^(?:https?:\/\/)?(?:www\.)?roblox\.com\/(?:groups|communities)\/(\d+)(?:[/?#].*)?$/i);
    const id = match && Number(match[1]);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error(`Invalid Roblox group link or ID: ${entry}`);
    }
    if (!ids.includes(id)) ids.push(id);
  }

  if (ids.length > 100) {
    throw new Error("A maximum of 100 groups can be checked at once.");
  }
  return ids;
}

async function fetchGroupData(baseUrl, groupIds, querySuffix = '', signal) {
  const chunks = [];
  for (let i = 0; i < groupIds.length; i += 100) {
    chunks.push(groupIds.slice(i, i + 100));
  }
  const responses = await Promise.all(chunks.map(ids => roblox(`${baseUrl}${ids.join(',')}${querySuffix}`, { signal })));
  return responses.flatMap(response => response.data || []);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  const requestSignal = AbortSignal.timeout(CHECK_TIMEOUT_MS);

  try {
    const body = req.body || {};
    const { username } = body;
    if (!username || typeof username !== "string") return res.status(400).json({ error: "Username or ID is required" });
    let groupIdsInput;
    try {
      groupIdsInput = parseGroupIds(body.groupIds ?? body.customGroup);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const offset = Number(body.offset ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset % GROUPS_PER_PAGE !== 0) {
      return res.status(400).json({ error: `Offset must be a non-negative multiple of ${GROUPS_PER_PAGE}.` });
    }

    try {
      if (!await checkRateLimit(req, res)) return res;
    } catch (e) {
      console.error("Request rate limiter unavailable:", e.message);
      return res.status(503).json({ error: "Request protection is temporarily unavailable. Please try again later." });
    }

    const inputStr = username.trim();
    let userId;
    let userData;

    try {
      const u = await roblox("https://users.roblox.com/v1/usernames/users", {
        method: "POST", body: JSON.stringify({ usernames: [inputStr], excludeBannedUsers: false }), signal: requestSignal
      });
      if (u.data?.length) {
        userData = u.data[0]; userId = userData.id;
      } else if (/^\d+$/.test(inputStr)) {
        const uById = await roblox(`https://users.roblox.com/v1/users/${inputStr}`, { signal: requestSignal });
        if (uById && uById.id) { userData = uById; userId = uById.id; }
      }
    } catch (e) {
      if (requestSignal.aborted) throw e;
      // Bỏ qua lỗi tìm user vì sẽ xử lý ở dòng dưới
    }

    if (!userId) return res.status(404).json({ error: "Roblox user not found (Check Username or ID)" });

    const [ug, userAvatarRes] = await Promise.all([
      roblox(`https://groups.roblox.com/v2/users/${userId}/groups/roles`, { signal: requestSignal }),
      offset === 0
        ? roblox(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=true`, { signal: requestSignal })
        : Promise.resolve(null)
    ]);

    const userAvatar = userAvatarRes?.data?.[0]?.imageUrl || '';
    const joinedIds = new Set((ug.data || []).map(x => x.group?.id).filter(Boolean));
    const includeOther = body.includeOther === true && Array.isArray(groupIdsInput);
    const isSavedList = typeof body.savedListId === 'string' && body.savedListId.length > 0;
    const allGroupIds = groupIdsInput
      ? includeOther
        ? [...groupIdsInput, ...Array.from(joinedIds).filter(id => !groupIdsInput.includes(id))]
        : groupIdsInput
      : Array.from(joinedIds);
    const totalGroups = allGroupIds.length;
    const groupIdsToCheck = allGroupIds.slice(offset, offset + GROUPS_PER_PAGE);
    if (!totalGroups) {
      return res.status(200).json({
        user: { id: userId, name: userData.name, displayName: userData.displayName, avatar: userAvatar },
        groups: [], joinedCount: 0, total: 0, totalGroups: 0, hasMore: false, isCustom: false, dateWarning: null
      });
    }

    const [groupInfo, groupIcons] = groupIdsToCheck.length
      ? await Promise.all([
        fetchGroupData('https://groups.roblox.com/v2/groups?groupIds=', groupIdsToCheck, '', requestSignal),
        fetchGroupData('https://thumbnails.roblox.com/v1/groups/icons?groupIds=', groupIdsToCheck, '&size=150x150&format=Png&isCircular=false', requestSignal)
      ])
      : [[], []];
    const info = new Map(groupInfo.map(g => [g.id, g]));
    const icons = new Map(groupIcons.map(t => [t.targetId, t.imageUrl]));
    
    let dates = {};
    let dateWarning = null;
    if (ROBLOX_API_KEY) {
      const joinedGroups = groupIdsToCheck.filter(id => joinedIds.has(id));
      for (let i = 0; i < joinedGroups.length; i += JOIN_DATE_CONCURRENCY) {
        await Promise.all(joinedGroups.slice(i, i + JOIN_DATE_CONCURRENCY).map(async id => {
          try {
            const d = await roblox(`https://apis.roblox.com/cloud/v2/groups/${id}/memberships?filter=${encodeURIComponent(`user == 'users/${userId}'`)}&maxPageSize=10`, { headers: { "x-api-key": ROBLOX_API_KEY }, signal: requestSignal });
            const item = d.groupMemberships?.[0];
            if (item?.createTime) dates[id] = item.createTime;
          } catch (e) {
            if (requestSignal.aborted) throw e;
            console.error(`Roblox join-date request failed for group ${id}:`, e.name === 'TimeoutError' ? 'Request timed out' : e.message);
            dateWarning = "Some join dates could not be loaded. Please try again later.";
          }
        }));
      }
    }
    
    const groups = groupIdsToCheck.map(id => {
      const g = info.get(id) || {};
      const joined = joinedIds.has(id);
      let payoutEligible = null;
      if (dates[id]) {
        const diffDays = (Date.now() - new Date(dates[id]).getTime()) / (1000 * 60 * 60 * 24);
        payoutEligible = diffDays >= 14;
      }
      return {
        id, name: g.name || `Group ID ${id}`, url: `https://www.roblox.com/communities/${id}`,
        icon: icons.get(id) || '', joined, joinedAt: dates[id] || null, ago: dates[id] ? duration(dates[id]) : null, payoutEligible
      };
    });
    
    return res.status(200).json({
      user: { id: userId, name: userData.name, displayName: userData.displayName, avatar: userAvatar },
      groups,
      joinedCount: groups.filter(g => g.joined).length,
      total: groups.length,
      totalGroups,
      hasMore: offset + groups.length < totalGroups,
      nextOffset: offset + groups.length,
      isCustom: groupIdsInput?.length === 1 && totalGroups === 1 && !includeOther && !isSavedList,
      savedGroupIds: groupIdsInput || [],
      includesOther: includeOther,
      isSavedList,
      dateWarning
    });
  } catch (e) {
    const timedOut = requestSignal.aborted || e.name === 'TimeoutError' || e.name === 'AbortError';
    return res.status(timedOut ? 504 : 500).json({
      error: timedOut ? "Group check timed out after 1 minute. Please try again." : e.message || "Internal error"
    });
  }
}