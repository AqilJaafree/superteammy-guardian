'use strict';

jest.mock('../../src/db');
jest.mock('../../src/adminCache');
jest.mock('../../src/config', () => ({
  getMainGroupId: jest.fn(() => -100111),
  setMainGroupId: jest.fn(),
  getIntroChannelId: jest.fn(() => -100999),
  setIntroChannelId: jest.fn(),
  isMainGroupFromEnv: jest.fn(() => false),
  isIntroChannelFromEnv: jest.fn(() => false),
  EPHEMERAL_REPLY_TTL_MS: 0, // fire immediately so timers don't linger
  PENDING_PAGE_SIZE: 50,
  sanitizeName: jest.fn((name) => name || 'N/A'),
}));

const db = require('../../src/db');
const adminCache = require('../../src/adminCache');
const config = require('../../src/config');
const admin = require('../../src/handlers/admin');

const MAIN_GROUP = -100111;
const INTRO_CHANNEL = -100999;
const OTHER_CHAT = -100333;

function makeBot() {
  const commands = {};
  return {
    command: jest.fn((cmd, fn) => { commands[cmd] = fn; }),
    getCommand: (cmd) => commands[cmd],
  };
}

function makeCtx({
  chatId = MAIN_GROUP,
  chatType = 'supergroup',
  userId = 1,
  text = '',
  replyTo = null,
} = {}) {
  return {
    chat: { id: chatId, type: chatType },
    from: { id: userId },
    message: {
      text,
      reply_to_message: replyTo,
    },
    reply: jest.fn().mockResolvedValue({ message_id: 888 }),
    telegram: {
      deleteMessage: jest.fn().mockResolvedValue(true),
    },
  };
}

let bot;

beforeEach(() => {
  // Fake timers prevent ephemeralReply's setTimeout from firing between tests
  // (which would crash once resetAllMocks clears the deleteMessage mock).
  jest.useFakeTimers();
  // resetAllMocks clears both call history AND implementations, so each test
  // starts with a clean slate regardless of what previous tests overrode.
  jest.resetAllMocks();
  // Re-establish defaults after the reset.
  config.getMainGroupId.mockReturnValue(-100111);
  config.getIntroChannelId.mockReturnValue(-100999);
  config.isMainGroupFromEnv.mockReturnValue(false);
  config.isIntroChannelFromEnv.mockReturnValue(false);
  config.sanitizeName.mockImplementation((name) => name || 'N/A');
  adminCache.isAdmin.mockResolvedValue(true); // admin by default
  bot = makeBot();
  admin.register(bot);
});

afterEach(() => {
  jest.useRealTimers();
});

// ---- /setgroup ----

describe('/setgroup', () => {
  test('rejects when used in a private chat', async () => {
    const ctx = makeCtx({ chatType: 'private' });
    await bot.getCommand('setgroup')(ctx);
    expect(ctx.reply).toHaveBeenCalled();
    expect(config.setMainGroupId).not.toHaveBeenCalled();
  });

  test('ignores non-admins', async () => {
    adminCache.isAdmin.mockResolvedValue(false);
    const ctx = makeCtx({ chatId: OTHER_CHAT });
    await bot.getCommand('setgroup')(ctx);
    expect(config.setMainGroupId).not.toHaveBeenCalled();
  });

  test('rejects when the main group is locked via env var', async () => {
    config.isMainGroupFromEnv.mockReturnValue(true);
    const ctx = makeCtx({ chatId: OTHER_CHAT });
    await bot.getCommand('setgroup')(ctx);
    expect(config.setMainGroupId).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalled();
  });

  test('sets the main group when called by a group admin', async () => {
    config.getMainGroupId.mockReturnValue(null); // no group set yet
    const ctx = makeCtx({ chatId: OTHER_CHAT });
    await bot.getCommand('setgroup')(ctx);
    expect(db.setSetting).toHaveBeenCalledWith('MAIN_GROUP_ID', OTHER_CHAT);
    expect(config.setMainGroupId).toHaveBeenCalledWith(OTHER_CHAT);
    expect(ctx.reply).toHaveBeenCalled();
  });
});

// ---- /setintro ----

describe('/setintro', () => {
  test('rejects when used in a private chat', async () => {
    const ctx = makeCtx({ chatType: 'private' });
    await bot.getCommand('setintro')(ctx);
    expect(ctx.reply).toHaveBeenCalled();
    expect(config.setIntroChannelId).not.toHaveBeenCalled();
  });

  test('rejects if the intro channel would be the same as the main group', async () => {
    config.getIntroChannelId.mockReturnValue(null);
    const ctx = makeCtx({ chatId: MAIN_GROUP }); // same as main group
    await bot.getCommand('setintro')(ctx);
    expect(config.setIntroChannelId).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalled();
  });

  test('sets the intro channel when called by a group admin', async () => {
    config.getIntroChannelId.mockReturnValue(null); // not set yet
    const ctx = makeCtx({ chatId: OTHER_CHAT });
    await bot.getCommand('setintro')(ctx);
    expect(db.setSetting).toHaveBeenCalledWith('INTRO_CHANNEL_ID', OTHER_CHAT);
    expect(config.setIntroChannelId).toHaveBeenCalledWith(OTHER_CHAT);
  });
});

// ---- /approve ----

describe('/approve', () => {
  test('approves a user by ID argument', async () => {
    db.getUser.mockReturnValue({ user_id: 999 });
    const ctx = makeCtx({ text: '/approve 999' });
    await bot.getCommand('approve')(ctx);
    expect(db.markIntroduced).toHaveBeenCalledWith(999, null);
    expect(ctx.reply).toHaveBeenCalled();
  });

  test('approves a user by reply', async () => {
    db.getUser.mockReturnValue({ user_id: 777 });
    const ctx = makeCtx({
      replyTo: { from: { id: 777, is_bot: false } },
      text: '/approve',
    });
    await bot.getCommand('approve')(ctx);
    expect(db.markIntroduced).toHaveBeenCalledWith(777, null);
  });

  test('creates a DB record if the user is not found before approving', async () => {
    db.getUser.mockReturnValue(null);
    const ctx = makeCtx({ text: '/approve 999' });
    await bot.getCommand('approve')(ctx);
    expect(db.upsertUser).toHaveBeenCalledWith(999, null, null);
    expect(db.markIntroduced).toHaveBeenCalledWith(999, null);
  });

  test('rejects with usage hint when no target is given', async () => {
    const ctx = makeCtx({ text: '/approve' });
    await bot.getCommand('approve')(ctx);
    expect(db.markIntroduced).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  test('ignores the command when the user is not a main group admin', async () => {
    adminCache.isAdmin.mockResolvedValue(false);
    const ctx = makeCtx({ text: '/approve 999' });
    await bot.getCommand('approve')(ctx);
    expect(db.markIntroduced).not.toHaveBeenCalled();
  });

  test('ignores the command when issued outside the main group', async () => {
    const ctx = makeCtx({ chatId: OTHER_CHAT, text: '/approve 999' });
    await bot.getCommand('approve')(ctx);
    expect(db.markIntroduced).not.toHaveBeenCalled();
  });
});

// ---- /reset ----

describe('/reset', () => {
  test('resets a user by ID argument', async () => {
    db.getUser.mockReturnValue({ user_id: 999, introduced: 1 });
    const ctx = makeCtx({ text: '/reset 999' });
    await bot.getCommand('reset')(ctx);
    expect(db.resetUser).toHaveBeenCalledWith(999);
    expect(ctx.reply).toHaveBeenCalled();
  });

  test('replies with an error when the user is not found', async () => {
    db.getUser.mockReturnValue(null);
    const ctx = makeCtx({ text: '/reset 999' });
    await bot.getCommand('reset')(ctx);
    expect(db.resetUser).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  test('rejects with usage hint when no target is given', async () => {
    const ctx = makeCtx({ text: '/reset' });
    await bot.getCommand('reset')(ctx);
    expect(db.resetUser).not.toHaveBeenCalled();
  });
});

// ---- /status ----

describe('/status', () => {
  test('replies with user info for a known user', async () => {
    db.getUser.mockReturnValue({
      user_id: 999,
      first_name: 'Ali',
      username: 'ali',
      introduced: 0,
      joined_at: '2024-01-01',
      introduced_at: null,
    });
    const ctx = makeCtx({ text: '/status 999' });
    await bot.getCommand('status')(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('999'));
  });

  test('replies with an error when the user is not found', async () => {
    db.getUser.mockReturnValue(null);
    const ctx = makeCtx({ text: '/status 999' });
    await bot.getCommand('status')(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });
});

// ---- /pending ----

describe('/pending', () => {
  test('replies with "no pending users" when the list is empty', async () => {
    db.getPending.mockReturnValue([]);
    const ctx = makeCtx({ text: '/pending' });
    await bot.getCommand('pending')(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('No pending'));
  });

  test('lists pending users on page 1', async () => {
    db.getPending.mockReturnValue([
      { user_id: 1, first_name: 'Alice', username: 'alice' },
      { user_id: 2, first_name: 'Bob', username: 'bob' },
    ]);
    const ctx = makeCtx({ text: '/pending' });
    await bot.getCommand('pending')(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Pending'));
  });

  test('handles an out-of-range page number gracefully', async () => {
    db.getPending.mockReturnValue([{ user_id: 1, first_name: 'Alice', username: 'alice' }]);
    const ctx = makeCtx({ text: '/pending 99' });
    await bot.getCommand('pending')(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('No results'));
  });
});
