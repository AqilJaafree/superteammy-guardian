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
const config = require('../../src/config');
const gatekeeper = require('../../src/handlers/gatekeeper');

const MAIN_GROUP = -100111;
const OTHER_CHAT = -100222;

function makeBot() {
  let messageHandler;
  let editedMessageHandler;
  return {
    on: jest.fn((event, fn) => {
      if (event === 'message') messageHandler = fn;
      if (event === 'edited_message') editedMessageHandler = fn;
    }),
    getHandler: () => messageHandler,
    getEditHandler: () => editedMessageHandler,
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
let editHandler;
let next;

beforeEach(() => {
  jest.clearAllMocks();
  mockCooldownInstance.isLimited.mockReturnValue(false);
  mockCooldownInstance.touch.mockReset();
  adminCache.isAdmin.mockResolvedValue(false);
  config.getMainGroupId.mockReturnValue(MAIN_GROUP);
  const bot = makeBot();
  gatekeeper.register(bot);
  handler = bot.getHandler();
  editHandler = bot.getEditHandler();
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

  test('when the message is a join service message', async () => {
    const ctx = makeCtx();
    ctx.message = { message_id: 1, new_chat_members: [{ id: 123 }] };
    await handler(ctx, next);
    expect(next).toHaveBeenCalled();
    expect(ctx.deleteMessage).not.toHaveBeenCalled();
  });

  test('when the message is a leave service message', async () => {
    const ctx = makeCtx();
    ctx.message = { message_id: 1, left_chat_member: { id: 123 } };
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
  test('blocks a user with no DB record', async () => {
    db.getUser.mockReturnValue(null);
    const ctx = makeCtx();
    await handler(ctx, next);
    expect(ctx.deleteMessage).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

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

// ---- Unconfigured state ----

describe('unconfigured state (getMainGroupId returns null)', () => {
  test('does nothing and does not call next() when main group ID is not set', async () => {
    config.getMainGroupId.mockReturnValue(null);
    db.getUser.mockReturnValue(null);
    const ctx = makeCtx();
    await handler(ctx, next);
    expect(next).not.toHaveBeenCalled();
    expect(ctx.deleteMessage).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });
});

// ---- edited_message handler ----

describe('edited_message: pass-through cases', () => {
  test('calls next() for a message not in the main group', async () => {
    const ctx = makeCtx({ chatId: OTHER_CHAT });
    await editHandler(ctx, next);
    expect(next).toHaveBeenCalled();
    expect(ctx.deleteMessage).not.toHaveBeenCalled();
  });

  test('calls next() when main group is not configured', async () => {
    config.getMainGroupId.mockReturnValue(null);
    const ctx = makeCtx();
    await editHandler(ctx, next);
    expect(next).toHaveBeenCalled();
    expect(ctx.deleteMessage).not.toHaveBeenCalled();
  });

  test('calls next() when sender is a bot', async () => {
    const ctx = makeCtx({ isBot: true });
    await editHandler(ctx, next);
    expect(next).toHaveBeenCalled();
    expect(ctx.deleteMessage).not.toHaveBeenCalled();
  });

  test('calls next() when sender is a group admin', async () => {
    adminCache.isAdmin.mockResolvedValue(true);
    const ctx = makeCtx();
    await editHandler(ctx, next);
    expect(next).toHaveBeenCalled();
    expect(ctx.deleteMessage).not.toHaveBeenCalled();
  });

  test('calls next() when the user is introduced', async () => {
    db.getUser.mockReturnValue({ user_id: 123, introduced: 1 });
    const ctx = makeCtx();
    await editHandler(ctx, next);
    expect(next).toHaveBeenCalled();
    expect(ctx.deleteMessage).not.toHaveBeenCalled();
  });
});

describe('edited_message: blocking cases', () => {
  test('deletes an edit from a user with introduced=0', async () => {
    db.getUser.mockReturnValue({ user_id: 123, introduced: 0 });
    const ctx = makeCtx();
    await editHandler(ctx, next);
    expect(ctx.deleteMessage).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('deletes an edit from a user with no DB record', async () => {
    db.getUser.mockReturnValue(null);
    const ctx = makeCtx();
    await editHandler(ctx, next);
    expect(ctx.deleteMessage).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('does not send a reminder for blocked edits', async () => {
    db.getUser.mockReturnValue({ user_id: 123, introduced: 0 });
    const ctx = makeCtx();
    await editHandler(ctx, next);
    expect(ctx.reply).not.toHaveBeenCalled();
  });
});
