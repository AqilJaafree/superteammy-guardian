const config = require('../config');
const db = require('../db');
const adminCache = require('../adminCache');
const CooldownMap = require('../CooldownMap');
const { logError } = require('../utils');

const reminderCooldowns = new CooldownMap(config.REMINDER_COOLDOWN_MS, { cleanupMultiplier: 4 });

function shouldBypassGatekeeper(ctx, mainGroupId) {
  if (ctx.chat.id !== mainGroupId) return true;
  if (!ctx.from || ctx.from.is_bot) return true;
  return false;
}

function isServiceMessage(message) {
  return message.new_chat_members || message.left_chat_member;
}

async function isUserIntroduced(ctx, mainGroupId) {
  if (await adminCache.isAdmin(ctx.telegram, mainGroupId, ctx.from.id)) return true;
  const user = db.getUser(ctx.from.id);
  return user?.introduced || false;
}

async function sendAutoDeleteReminder(ctx) {
  if (reminderCooldowns.isLimited(ctx.from.id)) return;
  reminderCooldowns.touch(ctx.from.id);

  try {
    const reminder = await ctx.reply(config.REMINDER_MESSAGE);
    setTimeout(() => {
      ctx.telegram.deleteMessage(ctx.chat.id, reminder.message_id).catch(() => {});
    }, config.REMINDER_AUTO_DELETE_MS).unref();
  } catch (err) {
    console.error('Failed to send reminder:', err.message);
  }
}

function register(bot) {
  bot.on('message', async (ctx, next) => {
    const mainGroupId = config.getMainGroupId();

    // Safe-fail: if the bot is not yet configured, do nothing rather than passing everything through.
    if (!mainGroupId) return;
    if (shouldBypassGatekeeper(ctx, mainGroupId)) return next();
    if (isServiceMessage(ctx.message)) return next();
    if (await isUserIntroduced(ctx, mainGroupId)) return next();

    // Not introduced -- delete the message and send reminder
    logError(ctx.deleteMessage(), 'Failed to delete message');
    await sendAutoDeleteReminder(ctx);
  });

  // Block edits from non-introduced users. Without this, a user who was reset via /reset
  // could still edit their previously-sent messages to change the visible content.
  bot.on('edited_message', async (ctx, next) => {
    const mainGroupId = config.getMainGroupId();

    // Unlike the message handler, we call next() when unconfigured — there are no
    // downstream handlers for edited_message that need to be blocked.
    if (!mainGroupId || shouldBypassGatekeeper(ctx, mainGroupId)) return next();
    if (isServiceMessage(ctx.message)) return next();
    if (await isUserIntroduced(ctx, mainGroupId)) return next();

    logError(ctx.deleteMessage(), 'Failed to delete edited message from non-introduced user');
  });
}

module.exports = { register };
