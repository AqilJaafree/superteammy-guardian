const config = require('../config');
const db = require('../db');
const CooldownMap = require('../CooldownMap');

const welcomeCooldowns = new CooldownMap(config.WELCOME_COOLDOWN_MS, { cleanupMultiplier: 20 });

function logError(promise, label) {
  promise.catch((err) => console.error(`${label}:`, err.message));
}

function register(bot) {
  bot.on('new_chat_members', (ctx) => {
    if (ctx.chat.id !== config.getMainGroupId()) return;

    const members = ctx.message.new_chat_members;
    const isMassJoin = members.length > config.MAX_NEW_MEMBERS_PER_EVENT;

    if (isMassJoin) {
      console.error(`Mass-join event: ${members.length} members at once — tracking only, no welcome messages`);
    }

    for (const member of members) {
      if (member.is_bot) continue;

      // Always track users in DB, even during mass-join events.
      db.upsertUser(member.id, member.username, member.first_name);

      // Skip welcome messages for mass-join events to prevent amplification.
      if (isMassJoin) continue;

      // Throttle welcome messages to prevent amplification.
      if (welcomeCooldowns.isLimited(ctx.chat.id)) continue;
      welcomeCooldowns.touch(ctx.chat.id);

      const text = config.WELCOME_MESSAGE(member.first_name, config.getIntroChannelId());
      logError(ctx.reply(text), 'Failed to send welcome message');
    }
  });
}

module.exports = { register };
