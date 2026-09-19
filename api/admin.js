const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_PASS = process.env.ADMIN_PASS || "";

let cachedClient = null;
async function connectToDatabase() {
  if (cachedClient) return cachedClient;
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  cachedClient = client;
  return client;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  
  const { pass, action, groupId } = req.body || {};
  
  // Xác thực mật khẩu
  if (pass !== ADMIN_PASS) {
    return res.status(401).json({ error: "Unauthorized: Sai mật khẩu admin!" });
  }

  try {
    const client = await connectToDatabase();
    const db = client.db('rocheck');
    const collection = db.collection('settings');
    
    let config = await collection.findOne({ _id: 'group_config' });
    if (!config) {
      config = { _id: 'group_config', groupIds: [] };
      await collection.insertOne(config);
    }

    let updatedIds = [...config.groupIds];
    const idNum = parseInt(groupId, 10);

    // Xử lý Thêm / Xóa
    if (action === 'add' && idNum) {
      if (!updatedIds.includes(idNum)) updatedIds.push(idNum);
    } else if (action === 'remove' && idNum) {
      updatedIds = updatedIds.filter(id => id !== idNum);
    }

    // Nếu chỉ lấy danh sách (action = get) thì bỏ qua lệnh lưu
    if (action === 'add' || action === 'remove') {
      await collection.updateOne({ _id: 'group_config' }, { $set: { groupIds: updatedIds } });
    }

    return res.status(200).json({ success: true, groupIds: updatedIds });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}