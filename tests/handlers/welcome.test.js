'use strict';

const mockCooldownInstance = {
  isLimited: jest.fn().mockReturnValue(false),
  touch: jest.fn(),
};

jest.mock('../../src/db');
jest.mock('../../src/CooldownMap', () => jest.fn().mockImplementation(() => mockCooldownInstance));
jest.mock('../../src/config', () => ({
  getMainGroupId: jest.fn(() => -100111),
  getIntroChannelId: jest.fn(() => -100999),
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
  };
}

let handler;

beforeEach(() => {
  jest.clearAllMocks();
  mockCooldownInstance.isLimited.mockReturnValue(false);
  mockCooldownInstance.touch.mockReset();
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

  test('sends a welcome message', async () => {
    const ctx = makeCtx({ members: [makeMember({ firstName: 'Alice' })] });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith('Welcome Alice!');
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
    await handler(ctx);
    expect(ctx.reply).not.toHaveBeenCalled();
  });
});
