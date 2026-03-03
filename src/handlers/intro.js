const config = require('../config');
const db = require('../db');
const adminCache = require('../adminCache');
const CooldownMap = require('../CooldownMap');
const { logError } = require('../utils');

const introRateLimiter = new CooldownMap(config.INTRO_RATE_LIMIT_WINDOW_MS, { cleanupMultiplier: 2 });

const MEDIA_NUDGE_MESSAGE = 'Please post a text introduction — photos and media are not accepted as intros.';

function isValidIntro(text) {
  if (text.length < config.INTRO_MIN_LENGTH) return false;
  if (text.length > config.INTRO_MAX_LENGTH) return false;

  const lower = text.toLowerCase();
  const keywordMatches = config.INTRO_KEYWORDS.filter((kw) => lower.includes(kw.toLowerCase()));

  // Accept if either 2+ keywords match, or text is long enough even without keywords
  return keywordMatches.length >= 2 || text.length >= config.INTRO_KEYWORD_BYPASS_LENGTH;
}

function isIntroChannel(ctx) {
  if (ctx.chat.id !== config.getIntroChannelId()) return false;
  const topicId = config.getIntroTopicId();
  if (!topicId) return true;
  return (ctx.message?.message_thread_id ?? null) === topicId;
}

function isChannelPost(ctx) {
  // sender_chat is set when a channel (rather than a user) sends the message
  return !!ctx.message?.sender_chat;
}

async function isMainGroupAdmin(ctx) {
  const mainGroupId = config.getMainGroupId();
  if (!mainGroupId) return false;
  return adminCache.isAdmin(ctx.telegram, mainGroupId, ctx.from.id);
}

function sendReplyWithContext(ctx, message, errorLabel) {
  logError(
    ctx.reply(message, {
      reply_parameters: { message_id: ctx.message.message_id },
    }),
    errorLabel
  );
}

function handleMediaPost(ctx) {
  const user = db.getUser(ctx.from.id);
  if (user && !user.introduced) {
    sendReplyWithContext(ctx, MEDIA_NUDGE_MESSAGE, 'Failed to send media nudge');
  }
}

function ensureUserExists(userId, username, firstName) {
  let user = db.getUser(userId);
  if (!user) {
    db.upsertUser(userId, username, firstName);
    user = db.getUser(userId);
  }
  return user;
}

async function handleIntroSubmission(ctx, user, text) {
  const userId = ctx.from.id;

  // Re-read from DB — a concurrent handler (multiple rapid messages) may have already
  // committed introduced=1 between when `user` was fetched and now.
  const fresh = db.getUser(userId);
  if (fresh?.introduced) return;

  if (isValidIntro(text)) {
    db.markIntroduced(userId, ctx.message.message_id);
    introRateLimiter.delete(userId); // clear counter — no need to track after success

    // Delete the welcome message from the main group
    if (user.welcome_msg_id) {
      await ctx.telegram.deleteMessage(config.getMainGroupId(), user.welcome_msg_id).catch(() => {});
    }

    sendReplyWithContext(
      ctx,
      config.INTRO_ACCEPTED_MESSAGE(ctx.from.first_name),
      'Failed to send intro accepted'
    );
  } else {
    sendReplyWithContext(ctx, config.INTRO_NUDGE_MESSAGE, 'Failed to send intro nudge');
  }
}

function register(bot) {
  bot.on('message', async (ctx, next) => {
    if (!isIntroChannel(ctx)) return next();
    if (!ctx.from) return;
    if (isChannelPost(ctx)) return;
    if (await isMainGroupAdmin(ctx)) return;

    // Handle media posts separately
    if (!ctx.message.text) {
      handleMediaPost(ctx);
      return;
    }

    const userId = ctx.from.id;
    const text = ctx.message.text;

    // Rate-limit intro submissions per user
    if (introRateLimiter.increment(userId, config.INTRO_RATE_LIMIT_MAX)) return;

    const user = ensureUserExists(userId, ctx.from.username, ctx.from.first_name);

    // Already introduced users can post freely
    if (user.introduced) return;

    await handleIntroSubmission(ctx, user, text);
  });
}

module.exports = { register };
