'use strict';

// Must be set before config.js is required — it exits if missing.
process.env.BOT_TOKEN = 'test-token';

const config = require('../src/config');

describe('sanitizeName', () => {
  test('returns "there" for null', () => {
    expect(config.sanitizeName(null)).toBe('there');
  });

  test('returns "there" for undefined', () => {
    expect(config.sanitizeName(undefined)).toBe('there');
  });

  test('returns "there" for empty string', () => {
    expect(config.sanitizeName('')).toBe('there');
  });

  test('returns "there" when name becomes empty after stripping', () => {
    expect(config.sanitizeName('***')).toBe('there');
    expect(config.sanitizeName('<>')).toBe('there');
  });

  test('strips HTML injection characters', () => {
    expect(config.sanitizeName('<script>alert(1)</script>')).toBe('scriptalert1/script');
  });

  test('strips Markdown bold/italic characters', () => {
    expect(config.sanitizeName('**bold**')).toBe('bold');
    expect(config.sanitizeName('_italic_')).toBe('italic');
  });

  test('strips backticks', () => {
    expect(config.sanitizeName('`code`')).toBe('code');
  });

  test('strips square brackets and parentheses', () => {
    expect(config.sanitizeName('[link](url)')).toBe('linkurl');
  });

  test('strips ampersand', () => {
    expect(config.sanitizeName('a&b')).toBe('ab');
  });

  test('strips newlines and tabs', () => {
    expect(config.sanitizeName('line1\nline2')).toBe('line1line2');
    expect(config.sanitizeName('col1\tcol2')).toBe('col1col2');
  });

  test('preserves normal ASCII names', () => {
    expect(config.sanitizeName('Ali')).toBe('Ali');
    expect(config.sanitizeName('Ahmad Zaki')).toBe('Ahmad Zaki');
  });

  test('truncates to 64 characters', () => {
    const long = 'a'.repeat(100);
    expect(config.sanitizeName(long)).toHaveLength(64);
  });

  test('does not truncate names shorter than 64 characters', () => {
    const short = 'abc';
    expect(config.sanitizeName(short)).toBe('abc');
  });
});

describe('chat ID getters and setters', () => {
  test('setMainGroupId / getMainGroupId round-trips', () => {
    config.setMainGroupId(-1001234567890);
    expect(config.getMainGroupId()).toBe(-1001234567890);
  });

  test('setIntroChannelId / getIntroChannelId round-trips', () => {
    config.setIntroChannelId(-1009876543210);
    expect(config.getIntroChannelId()).toBe(-1009876543210);
  });
});

describe('WELCOME_MESSAGE', () => {
  test('includes the sanitized first name', () => {
    const msg = config.WELCOME_MESSAGE('Ali', null);
    expect(msg).toContain('Ali');
  });

  test('includes the intro channel link when an ID is provided', () => {
    const msg = config.WELCOME_MESSAGE('Ali', -1001234567890);
    expect(msg).toContain('t.me/c/');
    expect(msg).toContain('1234567890');
  });

  test('strips the -100 prefix from the channel ID in the URL', () => {
    const msg = config.WELCOME_MESSAGE('Ali', -1001234567890);
    expect(msg).not.toContain('-100');
  });

  test('falls back to generic text when no intro channel ID', () => {
    const msg = config.WELCOME_MESSAGE('Ali', null);
    expect(msg).toContain('intro channel');
    expect(msg).not.toContain('t.me/c/');
  });
});

describe('INTRO_ACCEPTED_MESSAGE', () => {
  test('includes the sanitized first name', () => {
    const msg = config.INTRO_ACCEPTED_MESSAGE('Zara');
    expect(msg).toContain('Zara');
  });
});

describe('constants', () => {
  test('INTRO_MIN_LENGTH is 50', () => {
    expect(config.INTRO_MIN_LENGTH).toBe(50);
  });

  test('INTRO_MAX_LENGTH is 4000', () => {
    expect(config.INTRO_MAX_LENGTH).toBe(4000);
  });

  test('INTRO_KEYWORDS is a non-empty array', () => {
    expect(Array.isArray(config.INTRO_KEYWORDS)).toBe(true);
    expect(config.INTRO_KEYWORDS.length).toBeGreaterThan(0);
  });
});
