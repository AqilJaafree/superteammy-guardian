# Superteammy Guardian — User Guide

## Table of Contents

- [Admin Setup](#admin-setup)
- [New Member Experience](#new-member-experience)
- [Intro Channel Guidelines](#intro-channel-guidelines)
- [Admin Commands](#admin-commands)
- [Edge Cases & FAQ](#edge-cases--faq)

---

## Admin Setup

### 1. Create the Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts to name your bot
3. Copy the bot token you receive

### 2. Configure and Start

Create a `.env` file:

```
BOT_TOKEN=your-bot-token-here
```

That's the only config needed. Start the bot:

```bash
npm install
npm run dev
```

Or with Docker:

```bash
docker compose up -d
```

### 3. Add Bot to Your Chats

1. Add the bot to your **main group** as an admin
   - Grant "Delete Messages" permission (required to remove messages from unintroduced users)
2. Add the bot to your **intro channel**
   - Grant "Post Messages" permission (required for confirmation replies)

### 4. Register the Chats

1. Go to your **main group** and send: `/setgroup`
   - Bot replies: "Main group set to this chat."
2. Go to your **intro channel** and send: `/setintro`
   - Bot replies: "Intro channel set to this chat."

The bot is now active. You only need to do this once — the settings persist across restarts.

### Who Can Use Bot Commands?

The bot uses Telegram's built-in group admin roles. Anyone who is an **admin in the Telegram group** can use bot commands — no separate admin list or configuration needed. Promote or demote someone in Telegram's group settings and the bot picks it up automatically.

---

## New Member Experience

### Step 1: Joining the Group

When a new user joins the main group, the bot sends a welcome message:

> Hey Ali! Welcome to Superteam Malaysia!
>
> Before you can chat here, please introduce yourself in our intro channel.
>
> Here's a suggested format:
> - Who are you?
> - What do you do?
> - Where are you based?
> - A fun fact about you
> - How would you like to contribute to Superteam Malaysia?
>
> Example:
> "Hi! I'm Ali, a frontend dev from KL. I've been building on Solana for about a year and I'm excited about DeFi. Fun fact: I once mass-adopted a dozen stray cats. I'd love to help with community tooling and hackathon projects!"
>
> Post your intro here: https://t.me/c/...

### Step 2: Attempting to Chat Before Introducing

If the user tries to send a message in the main group before introducing themselves:

1. The bot **deletes** the message
2. The bot sends a reminder: "You need to introduce yourself in the intro channel before you can post here."
3. The reminder **auto-deletes after 15 seconds** to keep the chat clean
4. Subsequent messages are still deleted, but reminders are throttled (one every 30 seconds per user)

### Step 3: Writing an Introduction

The user goes to the intro channel and writes their introduction. The bot checks the message:

**If the intro is accepted:**

> Thanks for the intro, Ali! You can now chat in the main group. Welcome aboard!

**If the intro is too short or lacks detail:**

> Thanks for posting! Could you tell us a bit more about yourself? Try including who you are, what you do, and how you want to contribute. A few more sentences would help the community get to know you!

The user can post again with more detail.

### Step 4: Chatting Freely

Once introduced, the user can post in the main group without restrictions. Their status is permanent — it persists even if they leave and rejoin.

---

## Intro Channel Guidelines

### What Makes a Valid Introduction

The bot uses a soft heuristic — it doesn't enforce a strict template. An intro is accepted if it meets **any** of these:

- **50+ characters** and mentions at least **2 topics** (who are you, what do you do, where are you based, fun fact, contribute)
- **150+ characters** regardless of topic keywords

### Example of a Good Introduction

> Hi everyone! I'm Sarah, a smart contract developer based in Penang. I've been in the Solana ecosystem for about 6 months, mostly working on DeFi protocols. Fun fact: I'm a competitive rock climber. I'd love to contribute to Superteam Malaysia by helping with technical workshops and hackathon mentoring!

### Example of an Introduction That Gets Nudged

> Hey I'm John

This is too short (under 50 characters). The bot will ask the user to elaborate.

### Intro Limits

- Minimum: **50 characters**
- Maximum: **4000 characters**
- Rate limit: **5 attempts per minute** (to prevent spam)

---

## Admin Commands

Any **Telegram group admin** can use these commands — no separate configuration needed.

### Setup Commands

Run these once to register your chats. Must be sent by a group admin in the target chat.

| Command | Where to Send | What It Does |
|---|---|---|
| `/setgroup` | Main group | Registers this chat as the main group |
| `/setintro` | Intro channel | Registers this chat as the intro channel |

### Management Commands

These only work in the main group. Each command accepts either a **user ID** as an argument or can be used as a **reply** to the target user's message.

#### `/approve` — Manually Approve a User

Marks a user as introduced without requiring an intro post.

```
/approve 123456789
```
Or reply to their message with `/approve`.

**When to use:**
- A user introduced themselves before the bot was installed
- A user is having trouble with the intro flow
- A known community member rejoins and you want to skip the process

**Bot response:**
> User 123456789 has been manually approved.

#### `/reset` — Reset a User's Intro Status

Forces a user to re-introduce themselves. Their messages will be deleted in the main group until they post a new intro.

```
/reset 123456789
```
Or reply to their message with `/reset`.

**When to use:**
- A user's intro was spam or low-effort and slipped through the heuristic
- You want a user to update their introduction

**Bot response:**
> User 123456789 has been reset. They will need to re-introduce themselves.

#### `/status` — Check a User's Status

View a user's current onboarding status.

```
/status 123456789
```
Or reply to their message with `/status`.

**Bot response:**
> User: Ali (@ali_dev)
> ID: 123456789
> Status: Introduced
> Joined: 2025-01-15 08:30:00
> Introduced at: 2025-01-15 09:00:00

#### `/pending` — List Pending Users

View all users who have joined but not yet introduced themselves.

```
/pending
```

**Bot response:**
> Pending introductions (3):
>
> - Ali (@ali_dev) -- ID: 123456789
> - Sarah (N/A) -- ID: 987654321
> - John (@john_crypto) -- ID: 456789123

Shows up to 200 pending users.

---

## Edge Cases & FAQ

### What happens if a user leaves and rejoins?

Their intro status is **preserved**. If they were already introduced, they can continue chatting immediately. If they were pending or reset, they'll see the welcome flow again.

### What about users who joined before the bot was installed?

Users who were already in the group are **not blocked**. The gatekeeper only restricts users who have a record in the database with `introduced = 0`. Existing members who never triggered the join event have no record and are allowed through.

If an existing member posts in the intro channel, the bot creates their record and marks them as introduced automatically.

### What if the bot doesn't have permission to delete messages?

The gatekeeper degrades gracefully — it still sends the reminder, but the user's message stays visible. Make sure the bot has "Delete Messages" admin permission in the main group.

### What if a user deletes their intro message?

Their introduced status is **unchanged**. The bot does not re-validate past intros. If you want them to re-introduce, use `/reset`.

### What if the bot restarts?

All data is stored in SQLite, not in memory. The bot picks up exactly where it left off — no status is lost.

### What if many users join at once?

The bot has flood protection. Welcome messages are throttled to one every 5 seconds, and join events with more than 10 users at once are ignored (likely a bot raid).

### Can admins chat freely without introducing?

Yes. Telegram group admins are always allowed to post in the main group and are never filtered by the gatekeeper.

### How does the bot know who is an admin?

It uses Telegram's built-in group admin roles via the `getChatMember` API. Anyone you promote to admin in the Telegram group settings automatically becomes a bot admin. Admin status is cached for 5 minutes for performance.

### Can I change the intro format or welcome message?

Yes, edit the message templates in `src/config.js`:

- `WELCOME_MESSAGE` — sent when a user joins
- `REMINDER_MESSAGE` — sent when an unintroduced user tries to chat
- `INTRO_ACCEPTED_MESSAGE` — sent when an intro is accepted
- `INTRO_NUDGE_MESSAGE` — sent when an intro needs more detail
- `INTRO_MIN_LENGTH` — minimum character count (default: 50)
- `INTRO_KEYWORDS` — topics the bot looks for in intros
