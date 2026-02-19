'use strict';

/**
 * Integration tests — all four handlers run together against a real SQLite
 * database. Only the Telegram API surface (ctx.reply, ctx.deleteMessage, etc.)
 * and adminCache are mocked. Everything else (db, config, CooldownMap) is real.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

jest.mock('../src/adminCache');

const MAIN_GROUP = -100111;
const INTRO_CHANNEL = -100999;

let db, config, adminCache, bot, dbPath;

// ---- Mock bot that replicates Telegraf's middleware chain ----

function makeMockBot() {
  const commands = {};
  const messageHandlers = [];
  const joinHandlers = [];

  return {
    command(cmd, fn) { commands[cmd] = fn; },
    on(event, fn) {
      if (event === 'message') messageHandlers.push(fn);
      else if (event === 'new_chat_members') joinHandlers.push(fn);
    },
    // Runs message handlers in registration order; each handler may call next()
    // to pass control to the next one, exactly as Telegraf does.
    async dispatchMessage(ctx) {
      let index = 0;
      const next = async () => {
        if (index < messageHandlers.length) {
          await messageHandlers[index++](ctx, next);
        }
      };
      await next();
    },
    async dispatchJoin(ctx) {
      for (const fn of joinHandlers) await fn(ctx);
    },
    async dispatchCommand(cmd, ctx) {
      if (commands[cmd]) await commands[cmd](ctx);
    },
  };
}

// ---- Context factories ----

function makeUser({ id = 1, username = 'user', firstName = 'User', isBot = false } = {}) {
  return { id, username, first_name: firstName, is_bot: isBot };
}

function makeMessageCtx({ chatId, user, text = 'hello' } = {}) {
  return {
    chat: { id: chatId, type: 'supergroup' },
    from: user,
    message: { message_id: Math.ceil(Math.random() * 9000) + 1000, text },
    reply: jest.fn().mockResolvedValue({ message_id: 88888 }),
    deleteMessage: jest.fn().mockResolvedValue(true),
    telegram: { deleteMessage: jest.fn().mockResolvedValue(true) },
  };
}

function makeJoinCtx({ chatId, members }) {
  return {
    chat: { id: chatId },
    message: { new_chat_members: members },
    reply: jest.fn().mockResolvedValue({ message_id: 77777 }),
  };
}

function makeCommandCtx({ chatId, user, text, replyTo = null } = {}) {
  return {
    chat: { id: chatId, type: 'supergroup' },
    from: user,
    message: { message_id: 1, text, reply_to_message: replyTo },
    reply: jest.fn().mockResolvedValue({ message_id: 66666 }),
    telegram: { deleteMessage: jest.fn().mockResolvedValue(true) },
  };
}

// ---- Intro text that satisfies the real isValidIntro heuristic ----
// 2 keywords + >= 50 chars total.
function validIntro() {
  return 'who are you: Alice, a developer. what do you do: I build web apps. extra padding here!';
}

// ---- Setup / teardown ----

beforeEach(() => {
  // Fake timers prevent ephemeralReply / reminder auto-delete timers from
  // firing between tests and crashing after mocks are cleared.
  jest.useFakeTimers();

  dbPath = path.join(
    os.tmpdir(),
    `integration-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
  );
  process.env.BOT_TOKEN = 'test-token';
  process.env.DB_PATH = dbPath;
  // Ensure chat IDs are NOT read from env vars so config.is*FromEnv() is false.
  delete process.env.MAIN_GROUP_ID;
  delete process.env.INTRO_CHANNEL_ID;

  // Fresh modules for every test — ensures handlers share clean DB + config state.
  jest.resetModules();

  db = require('../src/db');
  config = require('../src/config');
  adminCache = require('../src/adminCache');

  db.initialize();
  config.setMainGroupId(MAIN_GROUP);
  config.setIntroChannelId(INTRO_CHANNEL);

  adminCache.isAdmin.mockResolvedValue(false);  // regular user by default
  adminCache.destroy.mockImplementation(() => {}); // suppress interval cleanup

  bot = makeMockBot();
  // Register handlers in the same order as bot.js
  require('../src/handlers/admin').register(bot);
  require('../src/handlers/welcome').register(bot);
  require('../src/handlers/intro').register(bot);
  require('../src/handlers/gatekeeper').register(bot);
});

afterEach(() => {
  db.close();
  jest.useRealTimers();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch (_) {}
  }
});

// ============================================================
// User flows
// ============================================================

describe('Complete onboarding flow', () => {
  test('join → blocked → intro → unblocked', async () => {
    const user = makeUser({ id: 101, username: 'alice', firstName: 'Alice' });

    // Step 1: user joins the main group — DB record created, welcome sent
    const joinCtx = makeJoinCtx({ chatId: MAIN_GROUP, members: [user] });
    await bot.dispatchJoin(joinCtx);
    expect(db.getUser(101)).toMatchObject({ user_id: 101, introduced: 0 });
    expect(joinCtx.reply).toHaveBeenCalled();

    // Step 2: un-introduced user tries to post → message deleted, reminder sent
    const blockedCtx = makeMessageCtx({ chatId: MAIN_GROUP, user });
    await bot.dispatchMessage(blockedCtx);
    expect(blockedCtx.deleteMessage).toHaveBeenCalled();
    expect(blockedCtx.reply).toHaveBeenCalledWith(expect.stringContaining('introduce'));
    expect(db.getUser(101).introduced).toBe(0); // still not introduced

    // Step 3: user posts a valid intro in the intro channel → accepted
    const introCtx = makeMessageCtx({ chatId: INTRO_CHANNEL, user, text: validIntro() });
    await bot.dispatchMessage(introCtx);
    expect(db.getUser(101).introduced).toBe(1);
    expect(introCtx.reply).toHaveBeenCalled();

    // Step 4: now introduced — main group post passes through
    const allowedCtx = makeMessageCtx({ chatId: MAIN_GROUP, user });
    await bot.dispatchMessage(allowedCtx);
    expect(allowedCtx.deleteMessage).not.toHaveBeenCalled();
  });
});

describe('Intro channel validation', () => {
  test('invalid intro shows nudge; valid intro marks user as introduced', async () => {
    const user = makeUser({ id: 102 });
    db.upsertUser(102, user.username, user.first_name);

    // Too short → nudge, user still pending
    const nudgeCtx = makeMessageCtx({ chatId: INTRO_CHANNEL, user, text: 'Hi!' });
    await bot.dispatchMessage(nudgeCtx);
    expect(db.getUser(102).introduced).toBe(0);
    expect(nudgeCtx.reply).toHaveBeenCalled();

    // Valid intro → accepted, user introduced
    const acceptCtx = makeMessageCtx({ chatId: INTRO_CHANNEL, user, text: validIntro() });
    await bot.dispatchMessage(acceptCtx);
    expect(db.getUser(102).introduced).toBe(1);
    expect(acceptCtx.reply).toHaveBeenCalled();
  });

  test('bypass: text >= 150 chars is accepted without keyword matches', async () => {
    const user = makeUser({ id: 103 });
    db.upsertUser(103, user.username, user.first_name);

    const ctx = makeMessageCtx({ chatId: INTRO_CHANNEL, user, text: 'x'.repeat(150) });
    await bot.dispatchMessage(ctx);
    expect(db.getUser(103).introduced).toBe(1);
  });

  test('intro channel messages do not reach gatekeeper (no deletion)', async () => {
    const user = makeUser({ id: 104 });
    db.upsertUser(104, user.username, user.first_name);

    // Posting in intro channel — even if the text is invalid, the message
    // must NOT be deleted (that is gatekeeper's job, and only for main group).
    const ctx = makeMessageCtx({ chatId: INTRO_CHANNEL, user, text: 'Hi!' });
    await bot.dispatchMessage(ctx);
    expect(ctx.deleteMessage).not.toHaveBeenCalled();
  });

  test('pre-bot user posting in intro channel gets auto-created and introduced', async () => {
    const user = makeUser({ id: 105, username: 'prebot', firstName: 'PreBot' });
    // No DB record — user predates the bot

    const ctx = makeMessageCtx({ chatId: INTRO_CHANNEL, user, text: validIntro() });
    await bot.dispatchMessage(ctx);

    const record = db.getUser(105);
    expect(record).not.toBeNull();
    expect(record.username).toBe('prebot');
    expect(record.introduced).toBe(1);
  });
});

describe('Gatekeeper', () => {
  test('pre-bot user (no DB record) can post in main group freely', async () => {
    const user = makeUser({ id: 201 });
    // No DB record — user predates the bot

    const ctx = makeMessageCtx({ chatId: MAIN_GROUP, user });
    await bot.dispatchMessage(ctx);
    expect(ctx.deleteMessage).not.toHaveBeenCalled();
  });

  test('group admin is never blocked even without an intro', async () => {
    const user = makeUser({ id: 202 });
    db.upsertUser(202, user.username, user.first_name); // not introduced
    adminCache.isAdmin.mockResolvedValue(true);

    const ctx = makeMessageCtx({ chatId: MAIN_GROUP, user });
    await bot.dispatchMessage(ctx);
    expect(ctx.deleteMessage).not.toHaveBeenCalled();
  });

  test('bot messages are always allowed through', async () => {
    const botUser = makeUser({ id: 203, isBot: true });

    const ctx = makeMessageCtx({ chatId: MAIN_GROUP, user: botUser });
    await bot.dispatchMessage(ctx);
    expect(ctx.deleteMessage).not.toHaveBeenCalled();
  });

  test('reminder is not repeated within the cooldown window (30 s)', async () => {
    const user = makeUser({ id: 204 });
    db.upsertUser(204, user.username, user.first_name);

    // First message → reminder sent, cooldown starts
    const ctx1 = makeMessageCtx({ chatId: MAIN_GROUP, user });
    await bot.dispatchMessage(ctx1);
    expect(ctx1.deleteMessage).toHaveBeenCalled();
    expect(ctx1.reply).toHaveBeenCalled();

    // Second message within cooldown → deleted but no new reminder
    const ctx2 = makeMessageCtx({ chatId: MAIN_GROUP, user });
    await bot.dispatchMessage(ctx2);
    expect(ctx2.deleteMessage).toHaveBeenCalled();
    expect(ctx2.reply).not.toHaveBeenCalled();
  });
});

describe('Admin: /approve', () => {
  test('manually approving a user allows them to post without an intro', async () => {
    const user = makeUser({ id: 301, username: 'bob', firstName: 'Bob' });
    const admin = makeUser({ id: 1 });

    // User joins but never submits an intro
    await bot.dispatchJoin(makeJoinCtx({ chatId: MAIN_GROUP, members: [user] }));
    expect(db.getUser(301).introduced).toBe(0);

    // User gets blocked
    const blockedCtx = makeMessageCtx({ chatId: MAIN_GROUP, user });
    await bot.dispatchMessage(blockedCtx);
    expect(blockedCtx.deleteMessage).toHaveBeenCalled();

    // Admin approves the user
    adminCache.isAdmin.mockResolvedValue(true);
    const approveCtx = makeCommandCtx({
      chatId: MAIN_GROUP,
      user: admin,
      text: `/approve ${user.id}`,
    });
    await bot.dispatchCommand('approve', approveCtx);
    expect(db.getUser(301).introduced).toBe(1);

    // User can now post freely
    adminCache.isAdmin.mockResolvedValue(false);
    const allowedCtx = makeMessageCtx({ chatId: MAIN_GROUP, user });
    await bot.dispatchMessage(allowedCtx);
    expect(allowedCtx.deleteMessage).not.toHaveBeenCalled();
  });

  test('/approve by reply-to works the same as by user ID', async () => {
    const user = makeUser({ id: 302 });
    const admin = makeUser({ id: 1 });
    db.upsertUser(302, user.username, user.first_name);

    adminCache.isAdmin.mockResolvedValue(true);
    const ctx = makeCommandCtx({
      chatId: MAIN_GROUP,
      user: admin,
      text: '/approve',
      replyTo: { from: user },
    });
    await bot.dispatchCommand('approve', ctx);
    expect(db.getUser(302).introduced).toBe(1);
  });
});

describe('Admin: /reset', () => {
  test('resetting an introduced user blocks them again until they re-introduce', async () => {
    const user = makeUser({ id: 401, username: 'carol', firstName: 'Carol' });
    const admin = makeUser({ id: 1 });

    // Full onboarding: join + intro
    await bot.dispatchJoin(makeJoinCtx({ chatId: MAIN_GROUP, members: [user] }));
    await bot.dispatchMessage(makeMessageCtx({ chatId: INTRO_CHANNEL, user, text: validIntro() }));
    expect(db.getUser(401).introduced).toBe(1);

    // Admin resets the user
    adminCache.isAdmin.mockResolvedValue(true);
    const resetCtx = makeCommandCtx({
      chatId: MAIN_GROUP,
      user: admin,
      text: `/reset ${user.id}`,
    });
    await bot.dispatchCommand('reset', resetCtx);
    expect(db.getUser(401).introduced).toBe(0);

    // User is blocked again
    adminCache.isAdmin.mockResolvedValue(false);
    const blockedCtx = makeMessageCtx({ chatId: MAIN_GROUP, user });
    await bot.dispatchMessage(blockedCtx);
    expect(blockedCtx.deleteMessage).toHaveBeenCalled();

    // Re-introducing unblocks them
    await bot.dispatchMessage(makeMessageCtx({ chatId: INTRO_CHANNEL, user, text: validIntro() }));
    expect(db.getUser(401).introduced).toBe(1);

    const allowedCtx = makeMessageCtx({ chatId: MAIN_GROUP, user });
    await bot.dispatchMessage(allowedCtx);
    expect(allowedCtx.deleteMessage).not.toHaveBeenCalled();
  });
});

describe('Welcome handler', () => {
  test('sends a welcome message and tracks a new member in the DB', async () => {
    const user = makeUser({ id: 501, firstName: 'Dave' });
    const ctx = makeJoinCtx({ chatId: MAIN_GROUP, members: [user] });
    await bot.dispatchJoin(ctx);
    expect(ctx.reply).toHaveBeenCalled();
    expect(db.getUser(501)).toMatchObject({ user_id: 501, introduced: 0 });
  });

  test('bot members are silently skipped (no DB record, no welcome)', async () => {
    const botUser = makeUser({ id: 502, isBot: true });
    const ctx = makeJoinCtx({ chatId: MAIN_GROUP, members: [botUser] });
    await bot.dispatchJoin(ctx);
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(db.getUser(502)).toBeNull();
  });

  test('mass join: all users tracked, no welcome messages sent', async () => {
    const members = Array.from({ length: 11 }, (_, i) => makeUser({ id: 600 + i }));
    const ctx = makeJoinCtx({ chatId: MAIN_GROUP, members });
    await bot.dispatchJoin(ctx);
    expect(ctx.reply).not.toHaveBeenCalled();
    for (const m of members) {
      expect(db.getUser(m.id)).not.toBeNull();
    }
  });
});

describe('Bot setup: /setgroup and /setintro', () => {
  test('commands persist chat IDs to DB and update config', async () => {
    const admin = makeUser({ id: 1 });
    adminCache.isAdmin.mockResolvedValue(true);

    // Simulate a fresh bot with no chats configured
    config.setMainGroupId(null);
    config.setIntroChannelId(null);

    // Run /setgroup in the would-be main group
    const groupCtx = makeCommandCtx({ chatId: -100500, user: admin, text: '/setgroup' });
    await bot.dispatchCommand('setgroup', groupCtx);
    expect(config.getMainGroupId()).toBe(-100500);
    expect(db.getSetting('MAIN_GROUP_ID')).toBe(String(-100500));

    // Run /setintro in a different chat
    const introCtx = makeCommandCtx({ chatId: -100600, user: admin, text: '/setintro' });
    await bot.dispatchCommand('setintro', introCtx);
    expect(config.getIntroChannelId()).toBe(-100600);
    expect(db.getSetting('INTRO_CHANNEL_ID')).toBe(String(-100600));
  });

  test('DB-persisted chat IDs are loaded on restart (simulated by re-requiring config + db)', async () => {
    // Persist IDs as if /setgroup and /setintro had been run
    db.setSetting('MAIN_GROUP_ID', String(MAIN_GROUP));
    db.setSetting('INTRO_CHANNEL_ID', String(INTRO_CHANNEL));

    // Simulate a bot restart: re-require config and db, then load IDs from DB
    jest.resetModules();
    const freshDb = require('../src/db');
    freshDb.initialize();
    const freshConfig = require('../src/config');

    // Replicate the startup fallback in bot.js
    if (!freshConfig.getMainGroupId()) {
      const saved = freshDb.getSetting('MAIN_GROUP_ID');
      const parsed = Number(saved);
      if (saved && Number.isFinite(parsed) && Number.isInteger(parsed)) {
        freshConfig.setMainGroupId(parsed);
      }
    }
    if (!freshConfig.getIntroChannelId()) {
      const saved = freshDb.getSetting('INTRO_CHANNEL_ID');
      const parsed = Number(saved);
      if (saved && Number.isFinite(parsed) && Number.isInteger(parsed)) {
        freshConfig.setIntroChannelId(parsed);
      }
    }

    expect(freshConfig.getMainGroupId()).toBe(MAIN_GROUP);
    expect(freshConfig.getIntroChannelId()).toBe(INTRO_CHANNEL);

    freshDb.close();
  });
});
