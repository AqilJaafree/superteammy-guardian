const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DEFAULT_DB_DIR = path.resolve(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(DEFAULT_DB_DIR, 'bot.sqlite');

// Maximum number of pending users returned at once to prevent memory exhaustion.
const MAX_PENDING_RESULTS = 200;

let db;

function initialize() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  db = new Database(DB_PATH);

  // Restrict file permissions so only the owner can read/write the database.
  try {
    fs.chmodSync(DB_PATH, 0o600);
  } catch (_) {
    // Non-fatal on platforms that do not support chmod (e.g. some CI environments).
  }

  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  // Prevent external processes from attaching to the database.
  db.pragma('trusted_schema = OFF');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id       INTEGER PRIMARY KEY,
      username      TEXT,
      first_name    TEXT,
      introduced    INTEGER DEFAULT 0,
      introduced_at TEXT,
      joined_at     TEXT DEFAULT (datetime('now')),
      intro_msg_id  INTEGER,
      updated_at    TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

const VALID_SETTING_KEYS = ['MAIN_GROUP_ID', 'INTRO_CHANNEL_ID'];

function setSetting(key, value) {
  if (!VALID_SETTING_KEYS.includes(key)) {
    throw new Error(`Invalid setting key: ${key}`);
  }
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

/**
 * Validate that a value is a safe positive integer suitable for use as a user ID.
 */
function assertSafeInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${label}: must be a positive integer, got ${typeof value}(${value})`);
  }
}

function getUser(userId) {
  assertSafeInteger(userId, 'userId');
  return db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId) || null;
}

function upsertUser(userId, username, firstName) {
  assertSafeInteger(userId, 'userId');
  // Truncate string inputs to reasonable lengths to prevent storage abuse.
  const safeUsername = username ? String(username).slice(0, 64) : null;
  const safeFirstName = firstName ? String(firstName).slice(0, 128) : null;

  db.prepare(`
    INSERT INTO users (user_id, username, first_name)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name,
      updated_at = datetime('now')
  `).run(userId, safeUsername, safeFirstName);
}

function markIntroduced(userId, msgId) {
  assertSafeInteger(userId, 'userId');
  if (msgId != null) {
    assertSafeInteger(msgId, 'msgId');
  }
  db.prepare(`
    UPDATE users SET
      introduced = 1,
      introduced_at = datetime('now'),
      intro_msg_id = ?,
      updated_at = datetime('now')
    WHERE user_id = ?
  `).run(msgId || null, userId);
}

function resetUser(userId) {
  assertSafeInteger(userId, 'userId');
  db.prepare(`
    UPDATE users SET
      introduced = 0,
      introduced_at = NULL,
      intro_msg_id = NULL,
      updated_at = datetime('now')
    WHERE user_id = ?
  `).run(userId);
}

function getPending() {
  return db
    .prepare('SELECT * FROM users WHERE introduced = 0 ORDER BY joined_at ASC LIMIT ?')
    .all(MAX_PENDING_RESULTS);
}

/**
 * Gracefully close the database connection.
 */
function close() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { initialize, getUser, upsertUser, markIntroduced, resetUser, getPending, getSetting, setSetting, close };
