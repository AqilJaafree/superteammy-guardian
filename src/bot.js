const { Telegraf } = require('telegraf');
const config = require('./config');
const db = require('./db');
const adminCache = require('./adminCache');
const welcome = require('./handlers/welcome');
const intro = require('./handlers/intro');
const gatekeeper = require('./handlers/gatekeeper');
const security = require('./handlers/security');
const admin = require('./handlers/admin');

const bot = new Telegraf(config.BOT_TOKEN);

// Telegraf middleware errors are caught here to prevent process crashes.
// Do not surface error internals in any reply — log only.
bot.catch((err, ctx) => {
  const updateId = ctx?.update?.update_id ?? 'unknown';
  const errMsg = err instanceof Error ? err.message : String(err ?? 'unknown');
  console.error(`Bot error for update ${updateId}:`, errMsg);
});

// Register handlers -- order matters:
// 1. Admin commands first (so admins are not blocked)
// 2. Welcome handler for new members
// 3. Intro channel listener
// 4. Gatekeeper (filters messages in main group)
// 5. Security (flags suspicious links from introduced users/admins)
admin.register(bot);
welcome.register(bot);
intro.register(bot);
gatekeeper.register(bot);
security.register(bot);

db.initialize();

// Load saved chat IDs from DB (set via /setgroup and /setintro).
// Env vars take precedence — DB values are the fallback.
function loadIntegerSetting(key, getter, setter) {
  if (getter()) return;
  const saved = db.getSetting(key);
  const parsed = Number(saved);
  if (saved && Number.isInteger(parsed) && parsed !== 0) setter(parsed);
}

loadIntegerSetting('MAIN_GROUP_ID',    config.getMainGroupId,    config.setMainGroupId);
loadIntegerSetting('INTRO_CHANNEL_ID', config.getIntroChannelId, config.setIntroChannelId);
loadIntegerSetting('INTRO_TOPIC_ID',   config.getIntroTopicId,   config.setIntroTopicId);

bot.launch();
console.log('Bot started');

// ---- Graceful shutdown ----
function shutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  bot.stop(signal);
  db.close();
  adminCache.destroy();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

// Prevent unhandled rejections from crashing the process silently.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason instanceof Error ? reason.message : 'unknown');
});
