const config = require('../config');
const db = require('../db');
const CooldownMap = require('../CooldownMap');

const welcomeCooldowns = new CooldownMap(config.WELCOME_COOLDOWN_MS, { cleanupMultiplier: 20 });

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

      // Fetch existing record before upsert so we can detect rejoin scenarios.
      const existing = db.getUser(member.id);

      // Always track users in DB, even during mass-join events.
      db.upsertUser(member.id, member.username, member.first_name);

      // Already-introduced users who rejoin need no welcome — they can post freely.
      if (existing && existing.introduced) continue;

      // Skip welcome messages for mass-join events to prevent amplification.
      if (isMassJoin) continue;

      // Throttle welcome messages to prevent amplification.
      if (welcomeCooldowns.isLimited(ctx.chat.id)) continue;
      welcomeCooldowns.touch(ctx.chat.id);

      // Clean up the orphaned welcome message from their previous join attempt
      // so it doesn't linger in the chat alongside the new one.
      if (existing && existing.welcome_msg_id) {
        ctx.telegram.deleteMessage(ctx.chat.id, existing.welcome_msg_id).catch(() => {});
      }

      const text = config.WELCOME_MESSAGE(member.first_name, config.getIntroChannelId(), config.getIntroTopicId());

      // Post welcome in the group and store the message ID so it can be
      // deleted automatically once the user completes their introduction.
      ctx.reply(text)
        .then((msg) => { db.setWelcomeMsgId(member.id, msg.message_id); })
        .catch((err) => console.error('Failed to send welcome message:', err.message));
    }
  });
}

module.exports = { register };
