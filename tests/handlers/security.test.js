'use strict';

jest.mock('../../src/config', () => ({
  getMainGroupId: jest.fn(() => -100111),
  sanitizeName: (name) => (name || 'there').replace(/[<>&\r\n\t*_`\[\]()~\\]/g, '').trim().slice(0, 64) || 'there',
}));

jest.mock('../../src/adminCache', () => ({
  isAdmin: jest.fn().mockResolvedValue(false),
}));

const config = require('../../src/config');
const adminCache = require('../../src/adminCache');
const security = require('../../src/handlers/security');

const MAIN_GROUP = -100111;
const OTHER_CHAT = -100222;

function makeBot() {
  let msgHandler;
  let channelPostHandler;
  return {
    on: jest.fn((event, fn) => {
      if (event === 'message') msgHandler = fn;
      if (event === 'channel_post') channelPostHandler = fn;
    }),
    getHandler: () => msgHandler,
    getChannelPostHandler: () => channelPostHandler,
  };
}

function makeCtx({ chatId = MAIN_GROUP, text = '', entities = [], from = { id: 1, username: 'alice' } } = {}) {
  return {
    chat: { id: chatId },
    from,
    message: { text, entities },
    reply: jest.fn().mockResolvedValue({ message_id: 99 }),
    deleteMessage: jest.fn().mockResolvedValue(true),
    telegram: {},
  };
}

const next = jest.fn();
let handler;
let channelPostHandler;

beforeEach(() => {
  jest.clearAllMocks();
  adminCache.isAdmin.mockResolvedValue(false);
  const bot = makeBot();
  security.register(bot);
  handler = bot.getHandler();
  channelPostHandler = bot.getChannelPostHandler();
});

// ---- isSuspiciousUrl unit tests ----

describe('isSuspiciousUrl', () => {
  const { isSuspiciousUrl } = security;

  test('flags IPv4-based URLs', () => {
    expect(isSuspiciousUrl('http://192.168.1.1/login')).toBe(true);
    expect(isSuspiciousUrl('https://10.0.0.1/claim')).toBe(true);
  });

  test('flags IPv6-based URLs', () => {
    expect(isSuspiciousUrl('http://[::1]/login')).toBe(true);
    expect(isSuspiciousUrl('http://[2001:db8::1]/phish')).toBe(true);
  });

  test('flags known URL shorteners', () => {
    expect(isSuspiciousUrl('https://bit.ly/abc123')).toBe(true);
    expect(isSuspiciousUrl('https://tinyurl.com/xyz')).toBe(true);
    expect(isSuspiciousUrl('https://t.co/abc')).toBe(true);
    expect(isSuspiciousUrl('https://rebrand.ly/abc')).toBe(true);
    expect(isSuspiciousUrl('https://linktr.ee/abc')).toBe(true);
  });

  test('flags t.me invite links', () => {
    expect(isSuspiciousUrl('https://t.me/+abc123')).toBe(true);
    expect(isSuspiciousUrl('https://t.me/+XYZ')).toBe(true);
  });

  test('flags tg:// join invite links', () => {
    expect(isSuspiciousUrl('tg://join?invite=abc123')).toBe(true);
    expect(isSuspiciousUrl('tg://join?invite=XYZ')).toBe(true);
  });

  test('does not flag normal t.me profile/group links', () => {
    expect(isSuspiciousUrl('https://t.me/superteammy')).toBe(false);
  });

  test('flags IDN/homograph hostnames (punycode)', () => {
    // xn-- prefix indicates an internationalised domain name
    expect(isSuspiciousUrl('https://xn--slana-5ya.com')).toBe(true);
    expect(isSuspiciousUrl('https://legit.xn--example-cdh.com')).toBe(true);
  });

  test('does not flag normal domains', () => {
    expect(isSuspiciousUrl('https://solana.com')).toBe(false);
    expect(isSuspiciousUrl('https://superteam.fun')).toBe(false);
    expect(isSuspiciousUrl('https://github.com/repo')).toBe(false);
  });

  test('returns false for malformed URLs', () => {
    expect(isSuspiciousUrl('not-a-url')).toBe(false);
    expect(isSuspiciousUrl('')).toBe(false);
  });
});

// ---- extractUrls unit tests ----

describe('extractUrls', () => {
  const { extractUrls } = security;

  test('extracts url entities from text messages', () => {
    const message = {
      text: 'Check https://bit.ly/abc out',
      entities: [{ type: 'url', offset: 6, length: 18 }],
    };
    expect(extractUrls(message)).toEqual(['https://bit.ly/abc']);
  });

  test('extracts text_link entities', () => {
    const message = {
      text: 'Click here',
      entities: [{ type: 'text_link', offset: 0, length: 10, url: 'https://bit.ly/abc' }],
    };
    expect(extractUrls(message)).toEqual(['https://bit.ly/abc']);
  });

  test('extracts urls from captions', () => {
    const message = {
      caption: 'Check https://bit.ly/abc',
      caption_entities: [{ type: 'url', offset: 6, length: 18 }],
    };
    expect(extractUrls(message)).toEqual(['https://bit.ly/abc']);
  });

  test('returns empty array when no url entities', () => {
    const message = { text: 'hello', entities: [{ type: 'bold', offset: 0, length: 5 }] };
    expect(extractUrls(message)).toEqual([]);
  });

  test('discards url entities with out-of-bounds offsets', () => {
    // Crafted entity that points past the end of the text — bypass attempt
    const message = {
      text: 'hello world',
      entities: [{ type: 'url', offset: 100, length: 18 }],
    };
    expect(extractUrls(message)).toEqual([]);
  });

  test('discards url entities with negative offset', () => {
    const message = {
      text: 'https://bit.ly/abc',
      entities: [{ type: 'url', offset: -1, length: 18 }],
    };
    expect(extractUrls(message)).toEqual([]);
  });

  test('discards url entities with zero length', () => {
    const message = {
      text: 'https://bit.ly/abc',
      entities: [{ type: 'url', offset: 0, length: 0 }],
    };
    expect(extractUrls(message)).toEqual([]);
  });
});

// ---- Handler integration tests ----

describe('security handler', () => {
  test('ignores messages outside the main group', async () => {
    const ctx = makeCtx({ chatId: OTHER_CHAT, text: 'https://bit.ly/abc', entities: [{ type: 'url', offset: 0, length: 18 }] });
    await handler(ctx, next);
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(ctx.deleteMessage).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  test('deletes and warns on a suspicious link', async () => {
    const ctx = makeCtx({
      text: 'https://bit.ly/abc',
      entities: [{ type: 'url', offset: 0, length: 18 }],
    });
    ctx.message.message_id = 42;
    await handler(ctx, next);
    expect(ctx.deleteMessage).toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('@alice'));
    expect(next).toHaveBeenCalled();
  });

  test('falls back to first_name when user has no username', async () => {
    const ctx = makeCtx({
      text: 'https://bit.ly/abc',
      entities: [{ type: 'url', offset: 0, length: 18 }],
      from: { id: 1, first_name: 'Alice' },
    });
    ctx.message.message_id = 42;
    await handler(ctx, next);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Alice'));
  });

  test('does not act on clean messages', async () => {
    const ctx = makeCtx({
      text: 'https://solana.com',
      entities: [{ type: 'url', offset: 0, length: 18 }],
    });
    await handler(ctx, next);
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(ctx.deleteMessage).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  test('does not act on messages with no links', async () => {
    const ctx = makeCtx({ text: 'hey everyone!', entities: [] });
    await handler(ctx, next);
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(ctx.deleteMessage).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  test('always calls next() regardless of suspicious link', async () => {
    const ctx = makeCtx({
      text: 'https://bit.ly/abc',
      entities: [{ type: 'url', offset: 0, length: 18 }],
    });
    ctx.message.message_id = 1;
    await handler(ctx, next);
    expect(next).toHaveBeenCalled();
  });

  test('does nothing when main group is not configured', async () => {
    config.getMainGroupId.mockReturnValueOnce(null);
    const ctx = makeCtx({
      text: 'https://bit.ly/abc',
      entities: [{ type: 'url', offset: 0, length: 18 }],
    });
    await handler(ctx, next);
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(ctx.deleteMessage).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  test('does not act on messages from admins', async () => {
    adminCache.isAdmin.mockResolvedValue(true);
    const ctx = makeCtx({
      text: 'https://bit.ly/abc',
      entities: [{ type: 'url', offset: 0, length: 18 }],
    });
    await handler(ctx, next);
    expect(ctx.deleteMessage).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});

// ---- channel_post handler ----

describe('channel_post handler', () => {
  function makeChannelPostCtx({ chatId = MAIN_GROUP, text = '', entities = [] } = {}) {
    return {
      chat: { id: chatId },
      channelPost: { text, entities },
      reply: jest.fn().mockResolvedValue({ message_id: 99 }),
      deleteMessage: jest.fn().mockResolvedValue(true),
    };
  }

  test('deletes a suspicious link in a channel post', async () => {
    const ctx = makeChannelPostCtx({
      text: 'https://bit.ly/abc',
      entities: [{ type: 'url', offset: 0, length: 18 }],
    });
    await channelPostHandler(ctx, next);
    expect(ctx.deleteMessage).toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  test('passes through clean channel posts', async () => {
    const ctx = makeChannelPostCtx({
      text: 'https://solana.com',
      entities: [{ type: 'url', offset: 0, length: 18 }],
    });
    await channelPostHandler(ctx, next);
    expect(ctx.deleteMessage).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  test('ignores channel posts outside the main group', async () => {
    const ctx = makeChannelPostCtx({ chatId: OTHER_CHAT, text: 'https://bit.ly/abc', entities: [{ type: 'url', offset: 0, length: 18 }] });
    await channelPostHandler(ctx, next);
    expect(ctx.deleteMessage).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
