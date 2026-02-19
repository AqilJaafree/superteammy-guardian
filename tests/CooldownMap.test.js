'use strict';

const CooldownMap = require('../src/CooldownMap');

describe('CooldownMap — timestamp mode (isLimited / touch)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('returns false for an unknown key', () => {
    const map = new CooldownMap(1000);
    expect(map.isLimited('key')).toBe(false);
  });

  test('returns true immediately after touch', () => {
    const map = new CooldownMap(1000);
    map.touch('key');
    expect(map.isLimited('key')).toBe(true);
  });

  test('returns true within the window', () => {
    const map = new CooldownMap(1000);
    map.touch('key');
    jest.advanceTimersByTime(999);
    expect(map.isLimited('key')).toBe(true);
  });

  test('returns false after the window expires', () => {
    const map = new CooldownMap(1000);
    map.touch('key');
    jest.advanceTimersByTime(1001);
    expect(map.isLimited('key')).toBe(false);
  });

  test('independent keys do not affect each other', () => {
    const map = new CooldownMap(1000);
    map.touch('a');
    expect(map.isLimited('a')).toBe(true);
    expect(map.isLimited('b')).toBe(false);
  });
});

describe('CooldownMap — count mode (increment)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('returns false for each call below the max', () => {
    const map = new CooldownMap(60000);
    expect(map.increment('key', 3)).toBe(false);
    expect(map.increment('key', 3)).toBe(false);
    expect(map.increment('key', 3)).toBe(false);
  });

  test('returns true when exceeding the max', () => {
    const map = new CooldownMap(60000);
    map.increment('key', 2);
    map.increment('key', 2);
    expect(map.increment('key', 2)).toBe(true);
  });

  test('resets count after the window expires', () => {
    const map = new CooldownMap(1000);
    map.increment('key', 1);
    map.increment('key', 1); // now exceeded
    jest.advanceTimersByTime(1001);
    // New window — count starts from 1, not exceeded yet
    expect(map.increment('key', 1)).toBe(false);
  });

  test('independent keys have independent counts', () => {
    const map = new CooldownMap(60000);
    map.increment('a', 1);
    expect(map.increment('a', 1)).toBe(true);
    expect(map.increment('b', 1)).toBe(false);
  });
});

describe('CooldownMap — _purge', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('removes expired timestamp entries on purge tick', () => {
    const map = new CooldownMap(1000, { cleanupMultiplier: 2 });
    map.touch('key');
    expect(map.size).toBe(1);
    jest.advanceTimersByTime(2001); // purge fires at 2000 ms
    expect(map.size).toBe(0);
  });

  test('keeps non-expired timestamp entries on purge tick', () => {
    const map = new CooldownMap(5000, { cleanupMultiplier: 2 });
    map.touch('key');
    jest.advanceTimersByTime(10001); // purge fires, but entry is only 10s old and window is 5s — expired
    expect(map.size).toBe(0);
  });

  // Regression test for the _purge bug: count-style entries must also be purged.
  // Previously val.expires (undefined) was used as the fallback, making the
  // comparison NaN > windowMs which is always false — entries were never purged.
  test('removes expired count entries on purge tick', () => {
    const map = new CooldownMap(1000, { cleanupMultiplier: 2 });
    map.increment('key', 5);
    expect(map.size).toBe(1);
    jest.advanceTimersByTime(2001); // purge fires, entry's firstAttempt is now > windowMs ago
    expect(map.size).toBe(0);
  });

  test('does not remove non-expired count entries on purge tick', () => {
    const map = new CooldownMap(10000, { cleanupMultiplier: 2 });
    map.increment('key', 5);
    expect(map.size).toBe(1);
    jest.advanceTimersByTime(20001); // purge fires, but is entry expired? 10s window, 20s passed — yes
    expect(map.size).toBe(0);
  });
});

describe('CooldownMap — maxSize eviction', () => {
  test('evicts the oldest entry when at capacity', () => {
    const map = new CooldownMap(60000, { maxSize: 2 });
    map.touch('a');
    map.touch('b');
    map.touch('c'); // evicts 'a'
    expect(map.size).toBe(2);
    expect(map.isLimited('a')).toBe(false);
    expect(map.isLimited('b')).toBe(true);
    expect(map.isLimited('c')).toBe(true);
  });

  test('does not evict when below capacity', () => {
    const map = new CooldownMap(60000, { maxSize: 3 });
    map.touch('a');
    map.touch('b');
    expect(map.size).toBe(2);
  });
});

describe('CooldownMap — destroy', () => {
  test('clears the interval without throwing', () => {
    const map = new CooldownMap(1000);
    expect(() => map.destroy()).not.toThrow();
  });
});
