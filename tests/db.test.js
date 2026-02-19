'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

let db;
let dbPath;

beforeEach(() => {
  // Use a unique temp file per test so each test gets a clean, empty database.
  dbPath = path.join(os.tmpdir(), `test-bot-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  process.env.DB_PATH = dbPath;
  jest.resetModules();
  db = require('../src/db');
  db.initialize();
});

afterEach(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch (_) {}
  }
});

// ---- users table ----

describe('getUser', () => {
  test('returns null for an unknown user', () => {
    expect(db.getUser(999)).toBeNull();
  });

  test('throws for zero userId', () => {
    expect(() => db.getUser(0)).toThrow();
  });

  test('throws for negative userId', () => {
    expect(() => db.getUser(-1)).toThrow();
  });

  test('throws for string userId', () => {
    expect(() => db.getUser('abc')).toThrow();
  });
});

describe('upsertUser', () => {
  test('creates a new user record', () => {
    db.upsertUser(1, 'alice', 'Alice');
    const user = db.getUser(1);
    expect(user).not.toBeNull();
    expect(user.user_id).toBe(1);
    expect(user.username).toBe('alice');
    expect(user.first_name).toBe('Alice');
    expect(user.introduced).toBe(0);
  });

  test('updates an existing user record', () => {
    db.upsertUser(1, 'old_name', 'Old');
    db.upsertUser(1, 'new_name', 'New');
    const user = db.getUser(1);
    expect(user.username).toBe('new_name');
    expect(user.first_name).toBe('New');
  });

  test('accepts null username and first_name', () => {
    db.upsertUser(1, null, null);
    const user = db.getUser(1);
    expect(user.username).toBeNull();
    expect(user.first_name).toBeNull();
  });

  test('truncates username to 64 characters', () => {
    db.upsertUser(1, 'u'.repeat(100), 'Test');
    expect(db.getUser(1).username).toHaveLength(64);
  });

  test('truncates first_name to 128 characters', () => {
    db.upsertUser(1, 'test', 'n'.repeat(200));
    expect(db.getUser(1).first_name).toHaveLength(128);
  });
});

describe('markIntroduced', () => {
  test('sets introduced = 1 and stores the message ID', () => {
    db.upsertUser(1, 'test', 'Test');
    db.markIntroduced(1, 42);
    const user = db.getUser(1);
    expect(user.introduced).toBe(1);
    expect(user.intro_msg_id).toBe(42);
    expect(user.introduced_at).not.toBeNull();
  });

  test('works with null msgId', () => {
    db.upsertUser(1, 'test', 'Test');
    db.markIntroduced(1, null);
    expect(db.getUser(1).introduced).toBe(1);
  });
});

describe('resetUser', () => {
  test('clears introduced status, timestamp, and message ID', () => {
    db.upsertUser(1, 'test', 'Test');
    db.markIntroduced(1, 42);
    db.resetUser(1);
    const user = db.getUser(1);
    expect(user.introduced).toBe(0);
    expect(user.intro_msg_id).toBeNull();
    expect(user.introduced_at).toBeNull();
  });
});

describe('getPending', () => {
  test('returns an empty array when there are no users', () => {
    expect(db.getPending()).toHaveLength(0);
  });

  test('returns only unintroduced users', () => {
    db.upsertUser(1, 'a', 'A');
    db.upsertUser(2, 'b', 'B');
    db.upsertUser(3, 'c', 'C');
    db.markIntroduced(2, 10);
    const pending = db.getPending();
    expect(pending).toHaveLength(2);
    const ids = pending.map((u) => u.user_id);
    expect(ids).toContain(1);
    expect(ids).toContain(3);
    expect(ids).not.toContain(2);
  });

  test('returns empty array when all users are introduced', () => {
    db.upsertUser(1, 'a', 'A');
    db.markIntroduced(1, 10);
    expect(db.getPending()).toHaveLength(0);
  });
});

// ---- settings table ----

describe('getSetting', () => {
  test('returns null for an unknown key', () => {
    expect(db.getSetting('MAIN_GROUP_ID')).toBeNull();
  });
});

describe('setSetting / getSetting', () => {
  test('stores and retrieves MAIN_GROUP_ID', () => {
    db.setSetting('MAIN_GROUP_ID', '-100123456');
    expect(db.getSetting('MAIN_GROUP_ID')).toBe('-100123456');
  });

  test('stores and retrieves INTRO_CHANNEL_ID', () => {
    db.setSetting('INTRO_CHANNEL_ID', '-100654321');
    expect(db.getSetting('INTRO_CHANNEL_ID')).toBe('-100654321');
  });

  test('updates an existing setting', () => {
    db.setSetting('MAIN_GROUP_ID', '-100111');
    db.setSetting('MAIN_GROUP_ID', '-100222');
    expect(db.getSetting('MAIN_GROUP_ID')).toBe('-100222');
  });

  test('throws for an invalid key', () => {
    expect(() => db.setSetting('INVALID_KEY', 'val')).toThrow('Invalid setting key');
  });

  test('throws for empty string key', () => {
    expect(() => db.setSetting('', 'val')).toThrow('Invalid setting key');
  });
});
