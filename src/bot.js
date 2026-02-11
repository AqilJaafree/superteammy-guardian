const { Telegraf } = require('telegraf');
const config = require('./config');
const db = require('./db');
const adminCache = require('./adminCache');
const welcome = require('./handlers/welcome');
const intro = require('./handlers/intro');
const gatekeeper = require('./handlers/gatekeeper');
const admin = require('./handlers/admin');

const bot = new Telegraf(config.BOT_TOKEN);

// ---- Global error handler ----
// Catch Telegraf middleware errors so they do not crash the process
// and do not leak internal details to end users.
bot.catch((err, ctx) => {
  const updateId = ctx?.update?.update_id ?? 'unknown';
  const errMsg = err instanceof Error ? err.message : String(err ?? 'unknown');
  console.error(`Bot error for update ${updateId}:`, errMsg);
});

// Register handlers -- order matters:
// 1. Admin commands first (so admins are not blocked)
// 2. Welcome handler for new members
// 3. Intro channel listener
// 4. Gatekeeper last (filters messages in main group)
admin.register(bot);
welcome.register(bot);
intro.register(bot);
gatekeeper.register(bot);

db.initialize();

// Load saved chat IDs from DB (set via /setgroup and /setintro).
// Env vars take precedence — DB values are the fallback.
if (!config.getMainGroupId()) {
  const saved = db.getSetting('MAIN_GROUP_ID');
  const parsed = Number(saved);
  if (saved && Number.isFinite(parsed) && Number.isInteger(parsed)) {
    config.setMainGroupId(parsed);
  }
}
if (!config.getIntroChannelId()) {
  const saved = db.getSetting('INTRO_CHANNEL_ID');
  const parsed = Number(saved);
  if (saved && Number.isFinite(parsed) && Number.isInteger(parsed)) {
    config.setIntroChannelId(parsed);
  }
}

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
