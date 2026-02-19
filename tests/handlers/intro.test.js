'use strict';

// Variables prefixed with "mock" can be referenced inside jest.mock() factory
// functions (Jest hoists mock calls but allows this naming convention).
const mockCooldownInstance = {
  increment: jest.fn().mockReturnValue(false), // not rate-limited by default
};

jest.mock('../../src/db');
jest.mock('../../src/CooldownMap', () => jest.fn().mockImplementation(() => mockCooldownInstance));
jest.mock('../../src/config', () => ({
  getIntroChannelId: jest.fn(() => -100999),
  INTRO_RATE_LIMIT_WINDOW_MS: 60_000,
  INTRO_RATE_LIMIT_MAX: 5,
  INTRO_MIN_LENGTH: 50,
  INTRO_MAX_LENGTH: 4000,
  INTRO_KEYWORD_BYPASS_LENGTH: 150,
  INTRO_KEYWORDS: ['who are you', 'what do you do', 'where are you based', 'fun fact', 'contribute'],
  INTRO_ACCEPTED_MESSAGE: (name) => `Thanks ${name}!`,
  INTRO_NUDGE_MESSAGE: 'Tell us more about yourself!',
}));

const db = require('../../src/db');
const intro = require('../../src/handlers/intro');

const INTRO_CHAT = -100999;
const OTHER_CHAT = -100111;

function makeBot() {
  let messageHandler;
  return {
    on: jest.fn((event, fn) => { if (event === 'message') messageHandler = fn; }),
    getHandler: () => messageHandler,
  };
}

function makeCtx({ chatId = INTRO_CHAT, userId = 123, text = null, messageId = 1 } = {}) {
  return {
    chat: { id: chatId },
    from: { id: userId, username: 'testuser', first_name: 'Test' },
    message: { message_id: messageId, text },
    reply: jest.fn().mockResolvedValue({ message_id: 999 }),
  };
}

let handler;
let next;

beforeEach(() => {
  jest.clearAllMocks();
  mockCooldownInstance.increment.mockReturnValue(false);
  const bot = makeBot();
  intro.register(bot);
  handler = bot.getHandler();
  next = jest.fn();
});

// ---- Chat filtering ----

describe('chat filtering', () => {
  test('calls next() when the message is not in the intro channel', async () => {
    const ctx = makeCtx({ chatId: OTHER_CHAT, text: 'hello' });
    await handler(ctx, next);
    expect(next).toHaveBeenCalled();
  });

  test('does not call next() for messages in the intro channel', async () => {
    db.getUser.mockReturnValue({ user_id: 123, introduced: 0 });
    const ctx = makeCtx({ text: 'hello' });
    await handler(ctx, next);
    expect(next).not.toHaveBeenCalled();
  });

  test('ignores messages posted as the channel (from.id === chat.id)', async () => {
    const ctx = makeCtx({ userId: INTRO_CHAT, text: 'channel post' });
    await handler(ctx, next);
    expect(db.getUser).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });
});

// ---- Non-text messages ----

describe('non-text messages', () => {
  test('nudges an unintroduced user who posts media', async () => {
    db.getUser.mockReturnValue({ user_id: 123, introduced: 0 });
    const ctx = makeCtx({ text: null });
    await handler(ctx, next);
    expect(ctx.reply).toHaveBeenCalled();
  });

  test('does not nudge an introduced user who posts media', async () => {
    db.getUser.mockReturnValue({ user_id: 123, introduced: 1 });
    const ctx = makeCtx({ text: null });
    await handler(ctx, next);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  test('does not nudge a user not in the DB who posts media', async () => {
    db.getUser.mockReturnValue(null);
    const ctx = makeCtx({ text: null });
    await handler(ctx, next);
    expect(ctx.reply).not.toHaveBeenCalled();
  });
});

// ---- Rate limiting ----

describe('rate limiting', () => {
  test('ignores the message silently when the user is rate-limited', async () => {
    mockCooldownInstance.increment.mockReturnValue(true); // over limit
    db.getUser.mockReturnValue({ user_id: 123, introduced: 0 });
    const ctx = makeCtx({ text: 'x'.repeat(200) });
    await handler(ctx, next);
    expect(db.markIntroduced).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });
});

// ---- Intro validation ----

describe('intro validation', () => {
  async function run(text, userRecord = { user_id: 123, introduced: 0 }) {
    db.getUser.mockReturnValue(userRecord);
    const ctx = makeCtx({ text });
    await handler(ctx, next);
    return ctx;
  }

  test('rejects an intro that is too short (< 50 chars)', async () => {
    const ctx = await run('hello');
    expect(db.markIntroduced).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Tell us more'),
      expect.anything(),
    );
  });

  test('rejects an intro that is too long (> 4000 chars)', async () => {
    const ctx = await run('x'.repeat(4001));
    expect(db.markIntroduced).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Tell us more'),
      expect.anything(),
    );
  });

  test('accepts an intro with 2 or more keywords', async () => {
    // 55 chars, contains "who are you" and "what do you do"
    const text = 'who are you: dev. what do you do: build stuff. padding!';
    const ctx = await run(text);
    expect(db.markIntroduced).toHaveBeenCalledWith(123, 1);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Thanks'),
      expect.anything(),
    );
  });

  test('accepts an intro >= 150 chars without any keywords (bypass)', async () => {
    const ctx = await run('x'.repeat(150));
    expect(db.markIntroduced).toHaveBeenCalledWith(123, 1);
  });

  test('rejects an intro with only 1 keyword and < 150 chars', async () => {
    // ~55 chars, only "who are you" matches, < 150 chars so bypass does not apply
    const text = 'who are you: I am a developer. padding padding pad!!';
    const ctx = await run(text);
    expect(db.markIntroduced).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Tell us more'),
      expect.anything(),
    );
  });

  test('allows an already-introduced user to post freely', async () => {
    const ctx = await run('hi', { user_id: 123, introduced: 1 });
    expect(db.markIntroduced).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  test('auto-creates a DB record for a user that predates the bot', async () => {
    db.getUser
      .mockReturnValueOnce(null)                          // first call: not found
      .mockReturnValueOnce({ user_id: 123, introduced: 0 }); // after upsert
    const ctx = makeCtx({ text: 'x'.repeat(50) });
    await handler(ctx, next);
    expect(db.upsertUser).toHaveBeenCalledWith(123, 'testuser', 'Test');
  });
});
