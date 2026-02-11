const config = require('../config');
const db = require('../db');
const adminCache = require('../adminCache');
const CooldownMap = require('../CooldownMap');

const reminderCooldowns = new CooldownMap(config.REMINDER_COOLDOWN_MS, { cleanupMultiplier: 4 });

function logError(promise, label) {
  promise.catch((err) => console.error(`${label}:`, err.message));
}

function register(bot) {
  bot.on('message', async (ctx, next) => {
    if (ctx.chat.id !== config.getMainGroupId()) return next();
    if (!ctx.from) return next();
    if (ctx.from.is_bot) return next();
    if (await adminCache.isAdmin(ctx.telegram, config.getMainGroupId(), ctx.from.id)) return next();

    const user = db.getUser(ctx.from.id);

    // User not in DB (pre-bot member, never triggered join) or already introduced -- allow
    if (!user || user.introduced) return next();

    // Not introduced -- delete the message
    logError(ctx.deleteMessage(), 'Failed to delete message');

    // Only send a reminder if the user has not received one recently.
    if (reminderCooldowns.isLimited(ctx.from.id)) return;
    reminderCooldowns.touch(ctx.from.id);

    ctx.reply(config.REMINDER_MESSAGE)
      .then((reminder) => {
        setTimeout(() => {
          ctx.telegram.deleteMessage(ctx.chat.id, reminder.message_id).catch(() => {});
        }, config.REMINDER_AUTO_DELETE_MS).unref();
      })
      .catch((err) => console.error('Failed to send reminder:', err.message));
  });
}

module.exports = { register };
