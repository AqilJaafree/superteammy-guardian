const config = require('../config');
const db = require('../db');
const adminCache = require('../adminCache');
const { getMention } = require('../utils');

const ERRORS = {
  PRIVATE_CHAT_SETGROUP: 'This command must be used in a group, not a private chat.',
  PRIVATE_CHAT_SETINTRO: 'This command must be used in a group or channel, not a private chat.',
  MAIN_GROUP_REASSIGN: 'A main group is already configured. Only admins of the existing main group can reassign it.',
  MAIN_GROUP_ENV: 'Main group is set via MAIN_GROUP_ID environment variable. Remove it from .env to use /setgroup instead.',
  INTRO_CHANNEL_NO_MAIN: 'An intro channel is already configured. Set up the main group with /setgroup first before reassigning.',
  INTRO_CHANNEL_REASSIGN: 'An intro channel is already configured. Only admins of the main group can reassign it.',
  INTRO_SAME_AS_MAIN: 'The intro channel cannot be the same as the main group. Run /setintro inside a forum topic to use a topic as the intro channel.',
  INTRO_CHANNEL_ENV: 'Intro channel is set via INTRO_CHANNEL_ID environment variable. Remove it from .env to use /setintro instead.',
  USAGE_APPROVE: 'Usage: /approve <user_id> or reply to a message',
  USAGE_RESET: 'Usage: /reset <user_id> or reply to a message',
  USAGE_STATUS: 'Usage: /status <user_id> or reply to a message',
  USER_NOT_FOUND: 'User not found in database.',
};

const SUCCESS = {
  MAIN_GROUP_SET: 'Main group set to this chat.',
  INTRO_TOPIC_SET: 'Intro topic set to this forum topic.',
  INTRO_CHANNEL_SET: 'Intro channel set to this chat.',
  NO_PENDING: 'No pending users.',
};

async function isAdmin(ctx) {
  if (!ctx.from) return false;
  return adminCache.isAdmin(ctx.telegram, ctx.chat.id, ctx.from.id);
}

function isMainGroup(chatId) {
  return chatId === config.getMainGroupId();
}

async function ephemeralReply(ctx, text) {
  try {
    const msg = await ctx.reply(text);
    setTimeout(() => {
      ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});
    }, config.EPHEMERAL_REPLY_TTL_MS).unref();
  } catch (err) {
    console.error('Failed to send ephemeral reply:', err.message);
  }
}

function formatUserDisplay(user) {
  const name = config.sanitizeName(user.first_name) || 'N/A';
  const username = user.username ? config.sanitizeName(user.username) : 'N/A';
  return { name, username };
}

function resolveTarget(ctx) {
  if (ctx.message.reply_to_message) {
    const from = ctx.message.reply_to_message.from;
    if (!from || from.is_bot) return null;
    return { id: from.id, mention: getMention(from) };
  }

  const args = (ctx.message.text || '').split(/\s+/).slice(1);
  if (args.length > 0) {
    const arg = args[0];

    // Support /command @username
    if (arg.startsWith('@')) {
      const user = db.getUserByUsername(arg.slice(1));
      if (!user) return { error: `User ${arg} not found in the database. Try using their numeric user ID instead.` };
      return { id: user.user_id, mention: getMention(user) };
    }

    // Support /command <user_id>
    const parsed = Number(arg);
    if (Number.isInteger(parsed) && parsed > 0) {
      const user = db.getUser(parsed);
      const mention = user ? getMention(user) : `user ${parsed}`;
      return { id: parsed, mention };
    }
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
    if (!(await adminCache.isAdmin(ctx.telegram, config.getMainGroupId(), ctx.from.id))) return;
    return handler(ctx);
  };
}

function register(bot) {
  // ---- Setup commands ----
  // First-time setup: any group admin of the current chat can run these.
  // Reassignment: must be an admin of the EXISTING main group to prevent hijacking.

  bot.command('setgroup', async (ctx) => {
    if (ctx.chat.type === 'private') return ephemeralReply(ctx, ERRORS.PRIVATE_CHAT_SETGROUP);
    if (!(await isAdmin(ctx))) return;

    // If a main group is already set, require admin of the existing group to reassign
    if (config.getMainGroupId() && config.getMainGroupId() !== ctx.chat.id) {
      const isExistingAdmin = await adminCache.isAdmin(ctx.telegram, config.getMainGroupId(), ctx.from.id);
      if (!isExistingAdmin) {
        return ephemeralReply(ctx, ERRORS.MAIN_GROUP_REASSIGN);
      }
    }

    if (config.isMainGroupFromEnv()) {
      return ephemeralReply(ctx, ERRORS.MAIN_GROUP_ENV);
    }

    const chatId = ctx.chat.id;
    db.setSetting('MAIN_GROUP_ID', chatId);
    config.setMainGroupId(chatId);
    ephemeralReply(ctx, SUCCESS.MAIN_GROUP_SET);
  });

  bot.command('setintro', async (ctx) => {
    if (ctx.chat.type === 'private') return ephemeralReply(ctx, ERRORS.PRIVATE_CHAT_SETINTRO);
    if (!(await isAdmin(ctx))) return;

    // If an intro channel is already set, require admin of the main group to reassign
    if (config.getIntroChannelId() && config.getIntroChannelId() !== ctx.chat.id) {
      if (!config.getMainGroupId()) {
        return ephemeralReply(ctx, ERRORS.INTRO_CHANNEL_NO_MAIN);
      }
      const isGroupAdmin = await adminCache.isAdmin(ctx.telegram, config.getMainGroupId(), ctx.from.id);
      if (!isGroupAdmin) {
        return ephemeralReply(ctx, ERRORS.INTRO_CHANNEL_REASSIGN);
      }
    }

    const chatId = ctx.chat.id;
    const topicId = ctx.message?.message_thread_id ?? null;

    if (chatId === config.getMainGroupId() && !topicId) {
      return ephemeralReply(ctx, ERRORS.INTRO_SAME_AS_MAIN);
    }
    if (config.isIntroChannelFromEnv()) {
      return ephemeralReply(ctx, ERRORS.INTRO_CHANNEL_ENV);
    }

    db.setSetting('INTRO_CHANNEL_ID', chatId);
    config.setIntroChannelId(chatId);
    db.setSetting('INTRO_TOPIC_ID', topicId ? String(topicId) : '0');
    config.setIntroTopicId(topicId);

    const message = topicId ? SUCCESS.INTRO_TOPIC_SET : SUCCESS.INTRO_CHANNEL_SET;
    ephemeralReply(ctx, message);
  });

  // ---- Management commands (main group only, main group admins) ----

  bot.command('approve', requireMainGroupAdmin((ctx) => {
    const target = resolveTarget(ctx);
    if (!target) return ephemeralReply(ctx, ERRORS.USAGE_APPROVE);
    if (target.error) return ephemeralReply(ctx, target.error);

    if (!db.getUser(target.id)) {
      db.upsertUser(target.id, null, null);
    }
    db.markIntroduced(target.id, null);

    ephemeralReply(ctx, `${target.mention} has been manually approved.`);
  }));

  bot.command('reset', requireMainGroupAdmin((ctx) => {
    const target = resolveTarget(ctx);
    if (!target) return ephemeralReply(ctx, ERRORS.USAGE_RESET);
    if (target.error) return ephemeralReply(ctx, target.error);

    const user = db.getUser(target.id);
    if (!user) {
      return ephemeralReply(ctx, ERRORS.USER_NOT_FOUND);
    }

    db.resetUser(target.id);
    ephemeralReply(ctx, `${target.mention} has been reset. They will need to re-introduce themselves.`);
  }));

  bot.command('status', requireMainGroupAdmin((ctx) => {
    const target = resolveTarget(ctx);
    if (!target) return ephemeralReply(ctx, ERRORS.USAGE_STATUS);
    if (target.error) return ephemeralReply(ctx, target.error);

    const user = db.getUser(target.id);
    if (!user) {
      return ephemeralReply(ctx, ERRORS.USER_NOT_FOUND);
    }

    const status = user.introduced ? 'Introduced' : 'Pending';
    const { name, username } = formatUserDisplay(user);
    const lines = [
      `User: ${name} (@${username})`,
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
      return ephemeralReply(ctx, SUCCESS.NO_PENDING);
    }

    const args = (ctx.message.text || '').split(/\s+/).slice(1);
    const pageNum = Math.max(1, Number(args[0]) || 1);
    const start = (pageNum - 1) * config.PENDING_PAGE_SIZE;
    const page = pending.slice(start, start + config.PENDING_PAGE_SIZE);
    const totalPages = Math.ceil(pending.length / config.PENDING_PAGE_SIZE);

    if (page.length === 0) {
      return ephemeralReply(ctx, `No results on page ${pageNum}. Total pages: ${totalPages}.`);
    }

    const userLines = page.map((u) => {
      const { name, username } = formatUserDisplay(u);
      return `- ${name} (@${username}) -- ID: ${u.user_id}`;
    });

    const header = `Pending introductions (${pending.length}) — page ${pageNum}/${totalPages}:\n\n`;
    const footer = pageNum < totalPages ? `\n\nUse /pending ${pageNum + 1} for next page.` : '';

    // Build output line-by-line to stay within Telegram's 4096-char message limit.
    const LIMIT = 3900 - header.length - footer.length;
    const safeLines = [];
    let length = 0;
    for (const line of userLines) {
      if (length + line.length + 1 > LIMIT) break;
      safeLines.push(line);
      length += line.length + 1;
    }
    const truncated = safeLines.length < userLines.length
      ? `\n(${userLines.length - safeLines.length} entries omitted — use /pending ${pageNum + 1})` : '';
    const text = header + safeLines.join('\n') + truncated + footer;

    ephemeralReply(ctx, text);
  }));
}

module.exports = { register };
