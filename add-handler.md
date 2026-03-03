---
description: Add a new Telegram bot handler following project conventions
model: claude-sonnet-4-6
---

Add a new Telegram bot handler to the Superteammy Guardian bot.

## Handler Request

$ARGUMENTS

## Project Context

This is a Telegraf-based Telegram bot using:
- **Framework**: Telegraf v4 (CommonJS, Node.js)
- **Database**: better-sqlite3 (synchronous, single SQLite table)
- **Structure**: Each handler lives in `src/handlers/<name>.js` and exports a `register(bot)` function
- **Tests**: Jest, located in `tests/handlers/<name>.test.js`
- **Config**: All message templates and constants go in `src/config.js`
- **DB queries**: All database access goes through `src/db.js`

## Handler Pattern

All handlers follow this structure:

```js
// src/handlers/<name>.js
const config = require('../config');

function register(bot) {
  bot.on('<event>', async (ctx) => {
    // Guard: only act in the relevant chat
    if (ctx.chat.id !== config.MAIN_GROUP_ID && ctx.chat.id !== config.INTRO_CHANNEL_ID) return;

    const db = ctx.db;

    try {
      // handler logic
    } catch (err) {
      console.error('[handler-name] error:', err);
    }
  });
}

module.exports = { register };
```

## What to Implement

### 1. Handler file (`src/handlers/<name>.js`)

- Export a single `register(bot)` function
- Guard against wrong chat IDs at the top of each listener
- Use `ctx.db` for all database access — never import `db.js` directly in handlers
- Wrap Telegram API calls in try/catch with a descriptive `console.error` log
- Auto-delete bot reminder messages after 15 seconds where appropriate:
  ```js
  const msg = await ctx.reply('...');
  setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {}), 15000);
  ```
- Check admin status via `ctx.db` or the `adminCache` (never hardcode user IDs)
- Follow the existing chat ID guard pattern: compare `ctx.chat.id` against `config.MAIN_GROUP_ID` / `config.INTRO_CHANNEL_ID`

### 2. Config additions (`src/config.js`)

- Add any new message templates or constants here
- Use backtick template literals for multi-line messages
- Name constants in `SCREAMING_SNAKE_CASE`

### 3. Database additions (`src/db.js`) — only if new queries are needed

- Add plain functions (no class, no ORM)
- Use synchronous `better-sqlite3` API (`db.prepare(...).run(...)`, `.get(...)`, `.all(...)`)
- Keep queries minimal — the schema has a single `users` table

### 4. Wire into bot (`src/bot.js`)

Add the require and register call:
```js
const newHandler = require('./handlers/<name>');
// ... in the handler registration section:
newHandler.register(bot);
```

Ordering matters: gatekeeper must stay before general message handlers.

### 5. Test file (`tests/handlers/<name>.test.js`)

Follow the project's mock pattern:

```js
const { register } = require('../../src/handlers/<name>');

describe('<HandlerName>', () => {
  let bot, ctx;

  beforeEach(() => {
    bot = { on: jest.fn(), command: jest.fn() };
    ctx = {
      chat: { id: -100123456789 },
      from: { id: 111, username: 'testuser', first_name: 'Test' },
      message: { text: '...' },
      reply: jest.fn().mockResolvedValue({ message_id: 1 }),
      deleteMessage: jest.fn().mockResolvedValue(true),
      telegram: {
        deleteMessage: jest.fn().mockResolvedValue(true),
        getChatMember: jest.fn(),
      },
      db: {
        getUser: jest.fn(),
        upsertUser: jest.fn(),
        markIntroduced: jest.fn(),
      },
    };
  });

  test('registers the correct event listener', () => {
    register(bot);
    expect(bot.on).toHaveBeenCalledWith('<event>', expect.any(Function));
  });

  // Add behaviour tests below
});
```

## Output

Provide:
1. The complete `src/handlers/<name>.js` file
2. Any additions needed in `src/config.js`
3. Any additions needed in `src/db.js`
4. The diff for `src/bot.js` (require + register line)
5. The complete `tests/handlers/<name>.test.js` file

Keep the handler focused on a single responsibility. If the logic is complex, split it into small named helper functions inside the same file — do not create a `utils/` directory.
