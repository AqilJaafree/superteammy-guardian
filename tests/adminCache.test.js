'use strict';

let adminCache;

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetModules();
  adminCache = require('../src/adminCache');
});

afterEach(() => {
  adminCache.destroy();
  jest.useRealTimers();
});

describe('isAdmin — input validation', () => {
  test('returns false when chatId is not an integer', async () => {
    const telegram = { getChatMember: jest.fn() };
    expect(await adminCache.isAdmin(telegram, 'abc', 123)).toBe(false);
    expect(telegram.getChatMember).not.toHaveBeenCalled();
  });

  test('returns false when userId is not an integer', async () => {
    const telegram = { getChatMember: jest.fn() };
    expect(await adminCache.isAdmin(telegram, -100123, 'abc')).toBe(false);
    expect(telegram.getChatMember).not.toHaveBeenCalled();
  });

  test('returns false when chatId is a float', async () => {
    const telegram = { getChatMember: jest.fn() };
    expect(await adminCache.isAdmin(telegram, 1.5, 123)).toBe(false);
  });
});

describe('isAdmin — Telegram API results', () => {
  test('returns true for "creator" status', async () => {
    const telegram = { getChatMember: jest.fn().mockResolvedValue({ status: 'creator' }) };
    expect(await adminCache.isAdmin(telegram, -100123, 456)).toBe(true);
  });

  test('returns true for "administrator" status', async () => {
    const telegram = { getChatMember: jest.fn().mockResolvedValue({ status: 'administrator' }) };
    expect(await adminCache.isAdmin(telegram, -100123, 456)).toBe(true);
  });

  test('returns false for "member" status', async () => {
    const telegram = { getChatMember: jest.fn().mockResolvedValue({ status: 'member' }) };
    expect(await adminCache.isAdmin(telegram, -100123, 456)).toBe(false);
  });

  test('returns false for "restricted" status', async () => {
    const telegram = { getChatMember: jest.fn().mockResolvedValue({ status: 'restricted' }) };
    expect(await adminCache.isAdmin(telegram, -100123, 456)).toBe(false);
  });

  test('returns false when the API throws', async () => {
    const telegram = { getChatMember: jest.fn().mockRejectedValue(new Error('Forbidden')) };
    expect(await adminCache.isAdmin(telegram, -100123, 456)).toBe(false);
  });
});

describe('isAdmin — caching', () => {
  test('caches the result and does not call the API again within the TTL', async () => {
    const telegram = { getChatMember: jest.fn().mockResolvedValue({ status: 'administrator' }) };
    await adminCache.isAdmin(telegram, -100123, 456);
    await adminCache.isAdmin(telegram, -100123, 456);
    expect(telegram.getChatMember).toHaveBeenCalledTimes(1);
  });

  test('re-queries the API after the cache TTL expires (5 minutes)', async () => {
    const telegram = { getChatMember: jest.fn().mockResolvedValue({ status: 'administrator' }) };
    await adminCache.isAdmin(telegram, -100123, 456);
    jest.advanceTimersByTime(5 * 60 * 1000 + 1);
    await adminCache.isAdmin(telegram, -100123, 456);
    expect(telegram.getChatMember).toHaveBeenCalledTimes(2);
  });

  test('caches independently for different chatId + userId combinations', async () => {
    const telegram = { getChatMember: jest.fn().mockResolvedValue({ status: 'administrator' }) };
    await adminCache.isAdmin(telegram, -1001111, 1);
    await adminCache.isAdmin(telegram, -1002222, 1);
    expect(telegram.getChatMember).toHaveBeenCalledTimes(2);
  });
});
