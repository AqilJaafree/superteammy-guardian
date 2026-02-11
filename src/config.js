// ---- Environment variable validation ----
if (!process.env.BOT_TOKEN) {
  console.error('FATAL: Missing required environment variable: BOT_TOKEN');
  process.exit(1);
}

/**
 * Sanitize user-supplied strings before embedding them in bot messages.
 * Strips characters that could be used for Telegram Markdown / HTML injection.
 */
function sanitizeName(name) {
  if (!name) return 'there';
  const clean = name.replace(/[<>&\r\n\t*_`\[\]()~\\]/g, '').trim().slice(0, 64);
  return clean || 'there';
}

// ---- Mutable chat IDs with getter/setter ----
let _mainGroupId = process.env.MAIN_GROUP_ID ? Number(process.env.MAIN_GROUP_ID) : null;
let _introChannelId = process.env.INTRO_CHANNEL_ID ? Number(process.env.INTRO_CHANNEL_ID) : null;
const _mainGroupFromEnv = !!process.env.MAIN_GROUP_ID;
const _introChannelFromEnv = !!process.env.INTRO_CHANNEL_ID;

function getMainGroupId() { return _mainGroupId; }
function setMainGroupId(id) { _mainGroupId = id; }
function getIntroChannelId() { return _introChannelId; }
function setIntroChannelId(id) { _introChannelId = id; }
function isMainGroupFromEnv() { return _mainGroupFromEnv; }
function isIntroChannelFromEnv() { return _introChannelFromEnv; }

// ---- Operator-tunable constants ----
const WELCOME_COOLDOWN_MS = 5_000;
const MAX_NEW_MEMBERS_PER_EVENT = 10;
const INTRO_RATE_LIMIT_WINDOW_MS = 60_000;
const INTRO_RATE_LIMIT_MAX = 5;
const INTRO_KEYWORD_BYPASS_LENGTH = 150;
const REMINDER_COOLDOWN_MS = 30_000;
const REMINDER_AUTO_DELETE_MS = 15_000;
const EPHEMERAL_REPLY_TTL_MS = 30_000;
const PENDING_PAGE_SIZE = 50;

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN,

  // Chat ID getters/setters
  getMainGroupId,
  setMainGroupId,
  getIntroChannelId,
  setIntroChannelId,
  isMainGroupFromEnv,
  isIntroChannelFromEnv,

  // Timing / rate-limit constants
  WELCOME_COOLDOWN_MS,
  MAX_NEW_MEMBERS_PER_EVENT,
  INTRO_RATE_LIMIT_WINDOW_MS,
  INTRO_RATE_LIMIT_MAX,
  INTRO_KEYWORD_BYPASS_LENGTH,
  REMINDER_COOLDOWN_MS,
  REMINDER_AUTO_DELETE_MS,
  EPHEMERAL_REPLY_TTL_MS,
  PENDING_PAGE_SIZE,

  // Intro validation
  INTRO_MIN_LENGTH: 50,
  INTRO_MAX_LENGTH: 4000,
  INTRO_KEYWORDS: [
    'who are you',
    'what do you do',
    'where are you based',
    'fun fact',
    'contribute',
  ],

  // Message templates
  WELCOME_MESSAGE: (firstName, introChannelId) =>
    `Hey ${sanitizeName(firstName)}! Welcome to Superteam Malaysia!\n\n` +
    `Before you can chat here, please introduce yourself in our intro channel.\n\n` +
    `Here's a suggested format:\n` +
    `- Who are you?\n` +
    `- What do you do?\n` +
    `- Where are you based?\n` +
    `- A fun fact about you\n` +
    `- How would you like to contribute to Superteam Malaysia?\n\n` +
    `Example:\n` +
    `"Hi! I'm Ali, a frontend dev from KL. I've been building on Solana for about a year ` +
    `and I'm excited about DeFi. Fun fact: I once mass-adopted a dozen stray cats. ` +
    `I'd love to help with community tooling and hackathon projects!"\n\n` +
    (introChannelId
      ? `Post your intro here: https://t.me/c/${String(introChannelId).replace(/^-100/, '')}`
      : 'Post your intro in the intro channel!'),

  REMINDER_MESSAGE:
    'You need to introduce yourself in the intro channel before you can post here. ' +
    'Check the pinned message for the format!',

  INTRO_ACCEPTED_MESSAGE: (firstName) =>
    `Thanks for the intro, ${sanitizeName(firstName)}! You can now chat in the main group. Welcome aboard!`,

  INTRO_NUDGE_MESSAGE:
    'Thanks for posting! Could you tell us a bit more about yourself? ' +
    'Try including who you are, what you do, and how you want to contribute. ' +
    'A few more sentences would help the community get to know you!',

  sanitizeName,
};
