const config = require('../config');
const db = require('../db');
const adminCache = require('../adminCache');
const CooldownMap = require('../CooldownMap');
const { logError } = require('../utils');

const reminderCooldowns = new CooldownMap(config.REMINDER_COOLDOWN_MS, { cleanupMultiplier: 4 });

function register(bot) {
  bot.on('message', async (ctx, next) => {
    const mainGroupId = config.getMainGroupId();
    // Safe-fail: if the bot is not yet configured, do nothing rather than passing everything through.
    if (!mainGroupId) return;
    if (ctx.chat.id !== mainGroupId) return next();
    if (!ctx.from) return next();
    if (ctx.from.is_bot) return next();
    // Skip service messages (join/leave events, pins, etc.) — they have no user content.
    if (ctx.message.new_chat_members || ctx.message.left_chat_member) return next();
    if (await adminCache.isAdmin(ctx.telegram, mainGroupId, ctx.from.id)) return next();

    const user = db.getUser(ctx.from.id);

    // Allow only users who are confirmed introduced; everyone else is blocked.
    if (user && user.introduced) return next();

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

  // Block edits from non-introduced users. Without this, a user who was reset via /reset
  // could still edit their previously-sent messages to change the visible content.
  bot.on('edited_message', async (ctx, next) => {
    const mainGroupId = config.getMainGroupId();
    if (!mainGroupId || ctx.chat.id !== mainGroupId) return next();
    if (!ctx.from) return next();
    if (ctx.from.is_bot) return next();
    if (await adminCache.isAdmin(ctx.telegram, mainGroupId, ctx.from.id)) return next();

    const user = db.getUser(ctx.from.id);
    if (user && user.introduced) return next();

    logError(ctx.deleteMessage(), 'Failed to delete edited message from non-introduced user');
  });
}

module.exports = { register };
