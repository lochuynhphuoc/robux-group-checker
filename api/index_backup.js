const DEFAULT_GROUP_IDS = [
  287620571, 76759687, 151671782, 746952538, 207158903, 
  1014182420
  // 929265546, 33882983, 829067064, 36074769, 33162943
];

const ROBLOX_API_KEY = process.env.ROBLOX_API_KEY || "";

const headers = {
  "User-Agent": "RoSealGroupCheckerWeb/2.0",
  "Content-Type": "application/json"
};

async function roblox(url, options = {}) {
  const r = await fetch(url, {
    ...options,
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

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  
  try {
    const { username, customGroup } = req.body || {};
    if (!username || typeof username !== "string") return res.status(400).json({ error: "Username or ID is required" });
    
    const inputStr = username.trim();
    let userId;
    let userData;

    try {
      const u = await roblox("https://users.roblox.com/v1/usernames/users", {
        method: "POST",
        body: JSON.stringify({ usernames: [inputStr], excludeBannedUsers: false })
      });
      if (u.data?.length) {
        userData = u.data[0];
        userId = userData.id;
      } else if (/^\d+$/.test(inputStr)) {
        const uById = await roblox(`https://users.roblox.com/v1/users/${inputStr}`);
        if (uById && uById.id) {
          userData = uById;
          userId = uById.id;
        }
      }
    } catch (e) { }

    if (!userId) return res.status(404).json({ error: "Roblox user not found (Check Username or ID)" });

    let groupIdsToCheck = DEFAULT_GROUP_IDS;
    if (customGroup && typeof customGroup === "string" && customGroup.trim() !== "") {
      const match = customGroup.match(/\d+/);
      if (match) {
        groupIdsToCheck = [parseInt(match[0], 10)];
      } else {
        return res.status(400).json({ error: "Invalid Group Link or ID format" });
      }
    }
    
    const [gi, ug, tb, userAvatarRes] = await Promise.all([
      roblox(`https://groups.roblox.com/v2/groups?groupIds=${groupIdsToCheck.join(',')}`),
      roblox(`https://groups.roblox.com/v2/users/${userId}/groups/roles`),
      roblox(`https://thumbnails.roblox.com/v1/groups/icons?groupIds=${groupIdsToCheck.join(',')}&size=150x150&format=Png&isCircular=false`),
      roblox(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=true`)
    ]);
    
    const userAvatar = userAvatarRes?.data?.[0]?.imageUrl || '';
    const joinedIds = new Set((ug.data || []).map(x => x.group?.id).filter(Boolean));
    const info = new Map((gi.data || []).map(g => [g.id, g]));
    const icons = new Map((tb.data || []).map(t => [t.targetId, t.imageUrl]));
    
    let dates = {};
    let dateWarning = null;
    
    if (ROBLOX_API_KEY) {
      await Promise.all(groupIdsToCheck.filter(id => joinedIds.has(id)).map(async id => {
        try {
          const d = await roblox(`https://apis.roblox.com/cloud/v2/groups/${id}/memberships?filter=${encodeURIComponent(`user == 'users/${userId}'`)}&maxPageSize=10`, { headers: { "x-api-key": ROBLOX_API_KEY } });
          const item = d.groupMemberships?.[0];
          if (item?.createTime) dates[id] = item.createTime;
        } catch (e) {
          dateWarning = "Some join dates could not be loaded.";
        }
      }));
    } else {
      dateWarning = "Join dates require ROBLOX_API_KEY in Vercel Environment Variables.";
    }
    
    const groups = groupIdsToCheck.map(id => {
      const g = info.get(id) || {};
      const joined = joinedIds.has(id);
      
      let payoutEligible = null;
      if (dates[id]) {
        const joinDateMs = new Date(dates[id]).getTime();
        const nowMs = Date.now();
        // Tính toán khoảng cách theo ngày (1 ngày = 86400000 ms)
        const diffDays = (nowMs - joinDateMs) / (1000 * 60 * 60 * 24);
        payoutEligible = diffDays >= 14;
      }

      return {
        id,
        name: g.name || `Group ID ${id}`,
        url: `https://www.roblox.com/communities/${id}`,
        icon: icons.get(id) || '',
        joined,
        joinedAt: dates[id] || null,
        ago: dates[id] ? duration(dates[id]) : null,
        payoutEligible
      };
    });
    
    return res.status(200).json({
      user: { id: userId, name: userData.name, displayName: userData.displayName, avatar: userAvatar },
      groups,
      joinedCount: groups.filter(g => g.joined).length,
      total: groups.length,
      isCustom: groupIdsToCheck.length === 1 && customGroup,
      dateWarning
    });
    
  } catch (e) {
    return res.status(500).json({ error: e.message || "Internal error" });
  }
}

module.exports = handler;