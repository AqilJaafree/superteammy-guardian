const config = require('../config');
const db = require('../db');
const adminCache = require('../adminCache');
const CooldownMap = require('../CooldownMap');

const welcomeCooldowns = new CooldownMap(config.WELCOME_COOLDOWN_MS, { cleanupMultiplier: 20 });

async function sendWelcomeMessage(ctx, member, existing) {
  // Clean up orphaned welcome message from previous join attempt
  if (existing?.welcome_msg_id) {
    await ctx.telegram.deleteMessage(ctx.chat.id, existing.welcome_msg_id).catch(() => {});
  }

  const text = config.WELCOME_MESSAGE(
    member.first_name,
    config.getIntroChannelId(),
    config.getIntroTopicId()
  );

  try {
    const msg = await ctx.reply(text);
    db.setWelcomeMsgId(member.id, msg.message_id);
  } catch (err) {
    console.error('Failed to send welcome message:', err.message);
  }
}

function register(bot) {
  bot.on('new_chat_members', async (ctx) => {
    if (ctx.chat.id !== config.getMainGroupId()) return;

    const members = ctx.message.new_chat_members;
    const isMassJoin = members.length > config.MAX_NEW_MEMBERS_PER_EVENT;

    if (isMassJoin) {
      console.error(`Mass-join event: ${members.length} members at once — tracking only, no welcome messages`);
    }

    for (const member of members) {
      if (member.is_bot) continue;

      const existing = db.getUser(member.id);

      // Always track users in DB, even during mass-join events
      db.upsertUser(member.id, member.username, member.first_name);

      if (existing?.introduced || isMassJoin) continue;

      // Claim the cooldown slot synchronously — no await between isLimited and touch.
      // JavaScript's single-threaded event loop guarantees these two lines are atomic,
      // preventing two concurrent join events from both seeing isLimited()=false and
      // both sending a welcome to the same chat.
      if (welcomeCooldowns.isLimited(ctx.chat.id)) continue;
      welcomeCooldowns.touch(ctx.chat.id);

      // Async checks happen after the slot is claimed
      if (await adminCache.isAdmin(ctx.telegram, ctx.chat.id, member.id)) continue;

      await sendWelcomeMessage(ctx, member, existing);
    }
  });
}

module.exports = { register };
