const config = require('../config');
const db = require('../db');
const CooldownMap = require('../CooldownMap');
const { logError } = require('../utils');

const introRateLimiter = new CooldownMap(config.INTRO_RATE_LIMIT_WINDOW_MS, { cleanupMultiplier: 2 });

function isValidIntro(text) {
  if (text.length < config.INTRO_MIN_LENGTH) return false;
  if (text.length > config.INTRO_MAX_LENGTH) return false;

  const lower = text.toLowerCase();
  const matches = config.INTRO_KEYWORDS.filter((kw) => lower.includes(kw.toLowerCase()));

  // Accept if long enough even without keywords (some people write freely)
  return matches.length >= 2 || text.length >= config.INTRO_KEYWORD_BYPASS_LENGTH;
}

function isIntroChannel(ctx) {
  if (ctx.chat.id !== config.getIntroChannelId()) return false;
  const topicId = config.getIntroTopicId();
  if (!topicId) return true;
  return (ctx.message?.message_thread_id ?? null) === topicId;
}

function register(bot) {
  bot.on('message', (ctx, next) => {
    if (!isIntroChannel(ctx)) return next();
    if (!ctx.from) return;
    // Ignore messages posted "as channel" — from.id would be the channel, not a real user.
    if (ctx.from.id === ctx.chat.id) return;
    if (!ctx.message.text) {
      // Only nudge non-introduced users who post media instead of text.
      const uid = ctx.from.id;
      const existing = db.getUser(uid);
      if (existing && !existing.introduced) {
        logError(
          ctx.reply('Please post a text introduction — photos and media are not accepted as intros.', {
            reply_parameters: { message_id: ctx.message.message_id },
          }),
          'Failed to send media nudge',
        );
      }
      return;
    }

    const userId = ctx.from.id;
    const text = ctx.message.text;

    // Rate-limit intro submissions per user.
    if (introRateLimiter.increment(userId, config.INTRO_RATE_LIMIT_MAX)) return;

    let user = db.getUser(userId);

    // User not tracked yet (joined before bot) -- create record first.
    if (!user) {
      db.upsertUser(userId, ctx.from.username, ctx.from.first_name);
      user = db.getUser(userId);
    }

    // Already introduced -- let them post freely
    if (user.introduced) return;

    if (isValidIntro(text)) {
      db.markIntroduced(userId, ctx.message.message_id);
      // Delete the welcome message from the main group now that they've introduced.
      if (user.welcome_msg_id) {
        ctx.telegram.deleteMessage(config.getMainGroupId(), user.welcome_msg_id).catch(() => {});
      }
      logError(
        ctx.reply(config.INTRO_ACCEPTED_MESSAGE(ctx.from.first_name), {
          reply_parameters: { message_id: ctx.message.message_id },
        }),
        'Failed to send intro accepted',
      );
    } else {
      logError(
        ctx.reply(config.INTRO_NUDGE_MESSAGE, {
          reply_parameters: { message_id: ctx.message.message_id },
        }),
        'Failed to send intro nudge',
      );
    }
  });
}

module.exports = { register };
