const ADMIN_CACHE_MS = 5 * 60 * 1000;
const ADMIN_CACHE_MAX = 10_000;

// key: "chatId:userId" -> { isAdmin, expires }
const _cache = new Map();

async function isAdmin(telegram, chatId, userId) {
  if (!Number.isInteger(chatId) || !Number.isInteger(userId)) return false;
  const key = `${chatId}:${userId}`;
  const cached = _cache.get(key);
  if (cached && Date.now() < cached.expires) return cached.isAdmin;

  try {
    const member = await telegram.getChatMember(chatId, userId);
    const result = member.status === 'creator' || member.status === 'administrator';
    if (_cache.size >= ADMIN_CACHE_MAX) {
      const oldest = _cache.keys().next().value;
      _cache.delete(oldest);
    }
    _cache.set(key, { isAdmin: result, expires: Date.now() + ADMIN_CACHE_MS });
    return result;
  } catch {
    return false;
  }
}

// Periodic purge of expired entries
const _interval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of _cache) {
    if (now >= entry.expires) _cache.delete(key);
  }
}, ADMIN_CACHE_MS * 2).unref();

function destroy() { clearInterval(_interval); }

module.exports = { isAdmin, destroy };
