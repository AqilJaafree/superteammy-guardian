const config = require('../config');
const adminCache = require('../adminCache');
const { logError, getMention } = require('../utils');

// Known URL shorteners — used to hide phishing destinations.
// t.me/+ (invite links) are handled separately via path inspection below.
const SHORTENER_DOMAINS = new Set([
  'bit.ly', 'bitly.com', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly',
  'buff.ly', 'short.link', 'shorturl.at', 'tiny.cc', 'is.gd', 'v.gd',
  'rb.gy', 'cutt.ly', 'lnkd.in', 'dlvr.it',
  // Additional common shorteners
  'rebrand.ly', 'linktr.ee', 'shorte.st', 'bl.ink', 'tr.im',
  'clck.ru', 'u.to', 'po.st',
]);

// IPv6: URL() strips brackets, leaving bare colons
function isIpHost(hostname) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(':');
}

// Detect IDN/homograph hostnames encoded as punycode (e.g. sο1ana.com → xn--...)
function isHomographHost(hostname) {
  return hostname.startsWith('xn--') || hostname.includes('.xn--');
}

// Detect t.me/+xxxx invite links (group join links commonly used in phishing)
function isTelegramInviteLink(urlString) {
  try {
    const parsed = new URL(urlString.startsWith('http') ? urlString : `https://${urlString}`);
    return parsed.hostname === 't.me' && parsed.pathname.startsWith('/+');
  } catch {
    return false;
  }
}

function isSuspiciousUrl(urlString) {
  // tg:// join links are functionally identical to t.me/+ invite links
  if (/^tg:\/\/join\?invite=/i.test(urlString)) return true;

  try {
    const url = new URL(urlString.startsWith('http') ? urlString : `https://${urlString}`);
    const hostname = url.hostname.toLowerCase();
    if (isIpHost(hostname)) return true;
    if (isHomographHost(hostname)) return true;
    if (SHORTENER_DOMAINS.has(hostname)) return true;
    if (isTelegramInviteLink(urlString)) return true;
    return false;
  } catch {
    return false;
  }
}

// Use Telegram's parsed entities — more reliable than regex.
// Validate bounds first: a modified client can send entity offsets that don't
// correspond to the actual text, producing a false-negative bypass.
function extractUrls(message) {
  const text = message.text || message.caption || '';
  const entities = message.entities || message.caption_entities || [];
  const urls = [];

  for (const entity of entities) {
    if (entity.type === 'url') {
      if (entity.offset < 0 || entity.length <= 0 ||
          entity.offset + entity.length > text.length) continue;
      urls.push(text.slice(entity.offset, entity.offset + entity.length));
    } else if (entity.type === 'text_link' && entity.url) {
      urls.push(entity.url);
    }
  }

  return urls;
}

function hasSuspiciousLink(message) {
  return extractUrls(message).some(isSuspiciousUrl);
}

// Scan channel_post updates (e.g. linked-channel posts in the main group) for
// suspicious links. These have no ctx.from, so the message is read from ctx.channelPost.
function registerChannelPost(bot) {
  bot.on('channel_post', async (ctx, next) => {
    const mainGroupId = config.getMainGroupId();
    if (!mainGroupId || ctx.chat?.id !== mainGroupId) return next();

    const post = ctx.channelPost;
    if (!post || !hasSuspiciousLink(post)) return next();

    logError(ctx.deleteMessage(), 'Failed to delete suspicious link in channel post');
    logError(
      ctx.reply('⚠️ A suspicious link was removed from this chat. Please use a full, direct URL.'),
      'Failed to send channel post suspicious link warning'
    );

    return next();
  });
}

function register(bot) {
  bot.on('message', async (ctx, next) => {
    const mainGroupId = config.getMainGroupId();
    if (!mainGroupId || ctx.chat?.id !== mainGroupId) return next();
    if (!ctx.from) return next(); // anonymous admin (Send-as-Group) — trusted, skip scan

    // Admins are trusted — never flag or delete their messages
    if (await adminCache.isAdmin(ctx.telegram, mainGroupId, ctx.from.id)) return next();

    if (hasSuspiciousLink(ctx.message)) {
      const mention = getMention(ctx.from);
      logError(ctx.deleteMessage(), 'Failed to delete suspicious link message');
      logError(
        ctx.reply(
          `⚠️ ${mention}, a suspicious link was removed from this chat. ` +
          `Please use a full, direct URL instead of shortened or obfuscated links.`
        ),
        'Failed to send suspicious link warning'
      );
    }

    return next();
  });

  registerChannelPost(bot);
}

module.exports = { register, isSuspiciousUrl, hasSuspiciousLink, extractUrls };
