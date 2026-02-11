const config = require('../config');
const db = require('../db');
const adminCache = require('../adminCache');

function logError(promise, label) {
  promise.catch((err) => console.error(`${label}:`, err.message));
}

/**
 * Check if the user is an admin of the current chat.
 */
async function isAdmin(ctx) {
  if (!ctx.from) return false;
  return adminCache.isAdmin(ctx.telegram, ctx.chat.id, ctx.from.id);
}

/**
 * Check if the current chat is the main group.
 */
function isMainGroup(chatId) {
  return chatId === config.getMainGroupId();
}

// Send a reply that auto-deletes after EPHEMERAL_REPLY_TTL_MS to avoid leaking info in the group chat.
function ephemeralReply(ctx, text) {
  ctx.reply(text)
    .then((msg) => {
      setTimeout(() => {
        ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});
      }, config.EPHEMERAL_REPLY_TTL_MS).unref();
    })
    .catch((err) => console.error('Failed to send ephemeral reply:', err.message));
}

function resolveTargetId(ctx) {
  if (ctx.message.reply_to_message) {
    const from = ctx.message.reply_to_message.from;
    if (!from || from.is_bot) return null;
    return from.id;
  }

  const args = (ctx.message.text || '').split(/\s+/).slice(1);
  if (args.length > 0) {
    const parsed = Number(args[0]);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }

  return null;
}

/**
 * Higher-order function: wraps a command handler with main-group + admin guard.
 * Checks that the command is in the main group and the user is a main-group admin.
 */
function requireMainGroupAdmin(handler) {
  return async (ctx) => {
    if (!isMainGroup(ctx.chat.id)) return;
    if (!ctx.from) return;
    if (!config.getMainGroupId()) return;
    if (!(await adminCache.isAdmin(ctx.telegram, config.getMainGroupId(), ctx.from.id))) return;
    return handler(ctx);
  };
}

function register(bot) {
  // ---- Setup commands ----
  // First-time setup: any group admin of the current chat can run these.
  // Reassignment: must be an admin of the EXISTING main group to prevent hijacking.

  bot.command('setgroup', async (ctx) => {
    if (ctx.chat.type === 'private') return ephemeralReply(ctx, 'This command must be used in a group, not a private chat.');
    if (!(await isAdmin(ctx))) return;

    // If a main group is already set, require admin of the existing group to reassign
    if (config.getMainGroupId() && config.getMainGroupId() !== ctx.chat.id) {
      const isExistingAdmin = await adminCache.isAdmin(ctx.telegram, config.getMainGroupId(), ctx.from.id);
      if (!isExistingAdmin) {
        return ephemeralReply(ctx, 'A main group is already configured. Only admins of the existing main group can reassign it.');
      }
    }

    const chatId = ctx.chat.id;
    if (config.isMainGroupFromEnv()) {
      return ephemeralReply(ctx, 'Main group is set via MAIN_GROUP_ID environment variable. Remove it from .env to use /setgroup instead.');
    }
    db.setSetting('MAIN_GROUP_ID', chatId);
    config.setMainGroupId(chatId);
    ephemeralReply(ctx, 'Main group set to this chat.');
  });

  bot.command('setintro', async (ctx) => {
    if (ctx.chat.type === 'private') return ephemeralReply(ctx, 'This command must be used in a group or channel, not a private chat.');
    if (!(await isAdmin(ctx))) return;

    // If an intro channel is already set, require admin of the main group to reassign.
    // If main group isn't set yet, deny reassignment entirely (no authority to verify against).
    if (config.getIntroChannelId() && config.getIntroChannelId() !== ctx.chat.id) {
      if (!config.getMainGroupId()) {
        return ephemeralReply(ctx, 'An intro channel is already configured. Set up the main group with /setgroup first before reassigning.');
      }
      const isGroupAdmin = await adminCache.isAdmin(ctx.telegram, config.getMainGroupId(), ctx.from.id);
      if (!isGroupAdmin) {
        return ephemeralReply(ctx, 'An intro channel is already configured. Only admins of the main group can reassign it.');
      }
    }

    const chatId = ctx.chat.id;
    if (chatId === config.getMainGroupId()) {
      return ephemeralReply(ctx, 'The intro channel cannot be the same as the main group.');
    }
    if (config.isIntroChannelFromEnv()) {
      return ephemeralReply(ctx, 'Intro channel is set via INTRO_CHANNEL_ID environment variable. Remove it from .env to use /setintro instead.');
    }
    db.setSetting('INTRO_CHANNEL_ID', chatId);
    config.setIntroChannelId(chatId);
    ephemeralReply(ctx, 'Intro channel set to this chat.');
  });

  // ---- Management commands (main group only, main group admins) ----

  bot.command('approve', requireMainGroupAdmin((ctx) => {
    const targetId = resolveTargetId(ctx);
    if (!targetId) {
      return ephemeralReply(ctx, 'Usage: /approve <user_id> or reply to a message');
    }

    if (!db.getUser(targetId)) {
      db.upsertUser(targetId, null, null);
    }
    db.markIntroduced(targetId, null);

    ephemeralReply(ctx, 'User has been manually approved.');
  }));

  bot.command('reset', requireMainGroupAdmin((ctx) => {
    const targetId = resolveTargetId(ctx);
    if (!targetId) {
      return ephemeralReply(ctx, 'Usage: /reset <user_id> or reply to a message');
    }

    const user = db.getUser(targetId);
    if (!user) {
      return ephemeralReply(ctx, 'User not found in database.');
    }

    db.resetUser(targetId);
    ephemeralReply(ctx, 'User has been reset. They will need to re-introduce themselves.');
  }));

  bot.command('status', requireMainGroupAdmin((ctx) => {
    const targetId = resolveTargetId(ctx);
    if (!targetId) {
      return ephemeralReply(ctx, 'Usage: /status <user_id> or reply to a message');
    }

    const user = db.getUser(targetId);
    if (!user) {
      return ephemeralReply(ctx, 'User not found in database.');
    }

    const status = user.introduced ? 'Introduced' : 'Pending';
    const safeName = config.sanitizeName(user.first_name) || 'N/A';
    const safeUsername = user.username ? config.sanitizeName(user.username) : 'N/A';
    const lines = [
      `User: ${safeName} (@${safeUsername})`,
      `ID: ${user.user_id}`,
      `Status: ${status}`,
      `Joined: ${user.joined_at || 'N/A'}`,
    ];
    if (user.introduced) {
      lines.push(`Introduced at: ${user.introduced_at}`);
    }

    ephemeralReply(ctx, lines.join('\n'));
  }));

  bot.command('pending', requireMainGroupAdmin((ctx) => {
    const pending = db.getPending();
    if (pending.length === 0) {
      return ephemeralReply(ctx, 'No pending users.');
    }

    // Parse optional page number: /pending 2
    const args = (ctx.message.text || '').split(/\s+/).slice(1);
    const pageNum = Math.max(1, Number(args[0]) || 1);

    const start = (pageNum - 1) * config.PENDING_PAGE_SIZE;
    const page = pending.slice(start, start + config.PENDING_PAGE_SIZE);
    const totalPages = Math.ceil(pending.length / config.PENDING_PAGE_SIZE);

    if (page.length === 0) {
      return ephemeralReply(ctx, `No results on page ${pageNum}. Total pages: ${totalPages}.`);
    }

    const lines = page.map((u) => {
      const name = config.sanitizeName(u.first_name) || 'N/A';
      const uname = u.username ? config.sanitizeName(u.username) : 'N/A';
      return `- ${name} (@${uname}) -- ID: ${u.user_id}`;
    });
    let text = `Pending introductions (${pending.length}) — page ${pageNum}/${totalPages}:\n\n${lines.join('\n')}`;
    if (pageNum < totalPages) {
      text += `\n\nUse /pending ${pageNum + 1} for next page.`;
    }
    ephemeralReply(ctx, text);
  }));
}

module.exports = { register };
