'use strict';

const mockCooldownInstance = {
  isLimited: jest.fn().mockReturnValue(false),
  touch: jest.fn(),
};

jest.mock('../../src/db');
jest.mock('../../src/adminCache', () => ({ isAdmin: jest.fn().mockResolvedValue(false) }));
jest.mock('../../src/CooldownMap', () => jest.fn().mockImplementation(() => mockCooldownInstance));
jest.mock('../../src/config', () => ({
  getMainGroupId: jest.fn(() => -100111),
  getIntroChannelId: jest.fn(() => -100999),
  getIntroTopicId: jest.fn(() => null),
  WELCOME_COOLDOWN_MS: 5_000,
  MAX_NEW_MEMBERS_PER_EVENT: 10,
  WELCOME_MESSAGE: (name) => `Welcome ${name}!`,
}));

const db = require('../../src/db');
const welcome = require('../../src/handlers/welcome');

const MAIN_GROUP = -100111;
const OTHER_CHAT = -100222;

function makeBot() {
  let joinHandler;
  return {
    on: jest.fn((event, fn) => { if (event === 'new_chat_members') joinHandler = fn; }),
    getHandler: () => joinHandler,
  };
}

function makeMember({ id = 1, isBot = false, username = 'user', firstName = 'User' } = {}) {
  return { id, is_bot: isBot, username, first_name: firstName };
}

function makeCtx({ chatId = MAIN_GROUP, members = [makeMember()] } = {}) {
  return {
    chat: { id: chatId },
    message: { new_chat_members: members },
    reply: jest.fn().mockResolvedValue({ message_id: 777 }),
    telegram: {
      deleteMessage: jest.fn().mockResolvedValue(true),
    },
  };
}

let handler;

beforeEach(() => {
  jest.clearAllMocks();
  mockCooldownInstance.isLimited.mockReturnValue(false);
  mockCooldownInstance.touch.mockReset();
  // Default: user is not in DB (brand new member).
  db.getUser.mockReturnValue(null);
  const bot = makeBot();
  welcome.register(bot);
  handler = bot.getHandler();
});

// ---- Chat filtering ----

describe('chat filtering', () => {
  test('ignores join events not in the main group', async () => {
    const ctx = makeCtx({ chatId: OTHER_CHAT });
    await handler(ctx);
    expect(db.upsertUser).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });
});

// ---- Bot members ----

describe('bot members', () => {
  test('skips bot members — no DB record, no welcome', async () => {
    const ctx = makeCtx({ members: [makeMember({ isBot: true })] });
    await handler(ctx);
    expect(db.upsertUser).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });
});

// ---- Normal join ----

describe('normal join', () => {
  test('creates a DB record for a new real member', async () => {
    const ctx = makeCtx({ members: [makeMember({ id: 42, username: 'alice', firstName: 'Alice' })] });
    await handler(ctx);
    expect(db.upsertUser).toHaveBeenCalledWith(42, 'alice', 'Alice');
  });

  test('sends welcome message to the group', async () => {
    const ctx = makeCtx({ members: [makeMember({ id: 1, firstName: 'Alice' })] });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith('Welcome Alice!');
  });

  test('stores the welcome message ID in DB after sending', async () => {
    const ctx = makeCtx({ members: [makeMember({ id: 1, firstName: 'Alice' })] });
    await handler(ctx);
    expect(db.setWelcomeMsgId).toHaveBeenCalledWith(1, 777);
  });
});

// ---- Cooldown ----

describe('welcome cooldown', () => {
  test('does not send a second welcome when the cooldown is active', async () => {
    mockCooldownInstance.isLimited
      .mockReturnValueOnce(false) // first member: allowed
      .mockReturnValueOnce(true); // second member: throttled
    const members = [makeMember({ id: 1 }), makeMember({ id: 2 })];
    const ctx = makeCtx({ members });
    await handler(ctx);
    expect(db.upsertUser).toHaveBeenCalledTimes(2); // both tracked
    expect(ctx.reply).toHaveBeenCalledTimes(1);     // only one welcome
  });

  test('touches the cooldown after sending a welcome', async () => {
    const ctx = makeCtx();
    await handler(ctx);
    expect(mockCooldownInstance.touch).toHaveBeenCalledWith(MAIN_GROUP);
  });
});

// ---- Mass join ----

describe('mass join (> MAX_NEW_MEMBERS_PER_EVENT)', () => {
  test('tracks all users in the DB', async () => {
    const members = Array.from({ length: 11 }, (_, i) => makeMember({ id: i + 1 }));
    const ctx = makeCtx({ members });
    await handler(ctx);
    expect(db.upsertUser).toHaveBeenCalledTimes(11);
  });

  test('sends no welcome messages', async () => {
    const members = Array.from({ length: 11 }, (_, i) => makeMember({ id: i + 1 }));
    const ctx = makeCtx({ members });
    handler(ctx);
    expect(ctx.reply).not.toHaveBeenCalled();
  });
});

// ---- Rejoin: already-introduced user ----

describe('rejoin: already-introduced user', () => {
  test('does not send a welcome to an introduced user who rejoins', () => {
    db.getUser.mockReturnValue({ user_id: 1, introduced: 1, welcome_msg_id: null });
    const ctx = makeCtx({ members: [makeMember({ id: 1, firstName: 'Alice' })] });
    handler(ctx);
    expect(db.upsertUser).toHaveBeenCalled(); // DB record still refreshed
    expect(ctx.reply).not.toHaveBeenCalled(); // no welcome message
  });

  test('does not delete any message when an introduced user rejoins', () => {
    db.getUser.mockReturnValue({ user_id: 1, introduced: 1, welcome_msg_id: 555 });
    const ctx = makeCtx({ members: [makeMember({ id: 1 })] });
    handler(ctx);
    expect(ctx.telegram.deleteMessage).not.toHaveBeenCalled();
  });
});

// ---- Rejoin: pending user ----

describe('rejoin: pending user', () => {
  test('deletes the old welcome message and sends a new one', async () => {
    db.getUser.mockReturnValue({ user_id: 1, introduced: 0, welcome_msg_id: 555 });
    const ctx = makeCtx({ members: [makeMember({ id: 1, firstName: 'Alice' })] });
    await handler(ctx);
    expect(ctx.telegram.deleteMessage).toHaveBeenCalledWith(MAIN_GROUP, 555);
    expect(ctx.reply).toHaveBeenCalledWith('Welcome Alice!');
  });

  test('does not call deleteMessage when pending user has no previous welcome', async () => {
    db.getUser.mockReturnValue({ user_id: 1, introduced: 0, welcome_msg_id: null });
    const ctx = makeCtx({ members: [makeMember({ id: 1, firstName: 'Alice' })] });
    await handler(ctx);
    expect(ctx.telegram.deleteMessage).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith('Welcome Alice!');
  });

  test('sends a welcome for a brand-new user not yet in the DB', async () => {
    // db.getUser returns null (set in beforeEach)
    const ctx = makeCtx({ members: [makeMember({ id: 1, firstName: 'Alice' })] });
    await handler(ctx);
    expect(ctx.telegram.deleteMessage).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith('Welcome Alice!');
  });
});
