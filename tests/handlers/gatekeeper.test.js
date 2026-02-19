'use strict';

const mockCooldownInstance = {
  isLimited: jest.fn().mockReturnValue(false),
  touch: jest.fn(),
};

jest.mock('../../src/db');
jest.mock('../../src/adminCache');
jest.mock('../../src/CooldownMap', () => jest.fn().mockImplementation(() => mockCooldownInstance));
jest.mock('../../src/config', () => ({
  getMainGroupId: jest.fn(() => -100111),
  REMINDER_COOLDOWN_MS: 30_000,
  REMINDER_AUTO_DELETE_MS: 0, // fire immediately so timers don't linger
  REMINDER_MESSAGE: 'Please introduce yourself.',
}));

const db = require('../../src/db');
const adminCache = require('../../src/adminCache');
const gatekeeper = require('../../src/handlers/gatekeeper');

const MAIN_GROUP = -100111;
const OTHER_CHAT = -100222;

function makeBot() {
  let messageHandler;
  return {
    on: jest.fn((event, fn) => { if (event === 'message') messageHandler = fn; }),
    getHandler: () => messageHandler,
  };
}

function makeCtx({ chatId = MAIN_GROUP, userId = 123, isBot = false } = {}) {
  return {
    chat: { id: chatId },
    from: { id: userId, is_bot: isBot },
    message: { message_id: 1, text: 'hello' },
    reply: jest.fn().mockResolvedValue({ message_id: 888 }),
    deleteMessage: jest.fn().mockResolvedValue(true),
    telegram: {
      deleteMessage: jest.fn().mockResolvedValue(true),
    },
  };
}

let handler;
let next;

beforeEach(() => {
  jest.clearAllMocks();
  mockCooldownInstance.isLimited.mockReturnValue(false);
  mockCooldownInstance.touch.mockReset();
  adminCache.isAdmin.mockResolvedValue(false);
  const bot = makeBot();
  gatekeeper.register(bot);
  handler = bot.getHandler();
  next = jest.fn();
});

// ---- Pass-through cases ----

describe('pass-through: next() is called', () => {
  test('when the message is not in the main group', async () => {
    const ctx = makeCtx({ chatId: OTHER_CHAT });
    await handler(ctx, next);
    expect(next).toHaveBeenCalled();
    expect(ctx.deleteMessage).not.toHaveBeenCalled();
  });

  test('when the sender is a bot', async () => {
    const ctx = makeCtx({ isBot: true });
    await handler(ctx, next);
    expect(next).toHaveBeenCalled();
    expect(ctx.deleteMessage).not.toHaveBeenCalled();
  });

  test('when the sender is a group admin', async () => {
    adminCache.isAdmin.mockResolvedValue(true);
    const ctx = makeCtx();
    await handler(ctx, next);
    expect(next).toHaveBeenCalled();
    expect(ctx.deleteMessage).not.toHaveBeenCalled();
  });

  test('when the user has no DB record (pre-bot member)', async () => {
    db.getUser.mockReturnValue(null);
    const ctx = makeCtx();
    await handler(ctx, next);
    expect(next).toHaveBeenCalled();
    expect(ctx.deleteMessage).not.toHaveBeenCalled();
  });

  test('when the user is introduced', async () => {
    db.getUser.mockReturnValue({ user_id: 123, introduced: 1 });
    const ctx = makeCtx();
    await handler(ctx, next);
    expect(next).toHaveBeenCalled();
    expect(ctx.deleteMessage).not.toHaveBeenCalled();
  });
});

// ---- Blocking cases ----

describe('blocking: un-introduced user', () => {
  test('deletes the message', async () => {
    db.getUser.mockReturnValue({ user_id: 123, introduced: 0 });
    const ctx = makeCtx();
    await handler(ctx, next);
    expect(ctx.deleteMessage).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('sends a reminder when not in cooldown', async () => {
    db.getUser.mockReturnValue({ user_id: 123, introduced: 0 });
    const ctx = makeCtx();
    await handler(ctx, next);
    expect(ctx.reply).toHaveBeenCalledWith('Please introduce yourself.');
    expect(mockCooldownInstance.touch).toHaveBeenCalledWith(123);
  });

  test('does not send a reminder when the user is in cooldown', async () => {
    mockCooldownInstance.isLimited.mockReturnValue(true);
    db.getUser.mockReturnValue({ user_id: 123, introduced: 0 });
    const ctx = makeCtx();
    await handler(ctx, next);
    expect(ctx.deleteMessage).toHaveBeenCalled(); // message is still deleted
    expect(ctx.reply).not.toHaveBeenCalled();     // but no reminder
  });
});
