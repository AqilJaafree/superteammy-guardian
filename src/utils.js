/**
 * Sanitize user-supplied strings before embedding them in bot messages.
 * Strips characters that could be used for Telegram Markdown/HTML injection
 * and Unicode BiDi overrides that can reverse visible text direction.
 */
function sanitizeName(name) {
  if (!name) return 'there';
  const clean = name
    .replace(/[<>&\r\n\t*_`\[\]()~\\]/g, '')
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .trim()
    .slice(0, 64);
  return clean || 'there';
}

/**
 * Attaches a catch handler to a promise that logs the error without crashing.
 * Use for fire-and-forget async operations where errors should not propagate.
 */
function logError(promise, label) {
  promise.catch((err) => console.error(`${label}:`, err.message));
}

/**
 * Returns a display mention for a Telegram user object.
 * Uses @username when available; falls back to sanitized first_name.
 */
function getMention(from) {
  return from.username
    ? `@${from.username}`
    : sanitizeName(from.first_name);
}

module.exports = { sanitizeName, logError, getMention };
