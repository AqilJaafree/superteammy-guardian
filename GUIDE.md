# Superteammy Guardian — User Guide

This guide covers how to use the bot from every angle: initial setup, daily admin work, and what new and existing members experience.

---

## Table of Contents

- [Roles](#roles)
- [Admin Guide](#admin-guide)
  - [Initial Setup](#initial-setup)
  - [Daily Moderation Commands](#daily-moderation-commands)
  - [Command Reference](#command-reference)
  - [Permissions the Bot Needs](#permissions-the-bot-needs)
  - [Troubleshooting](#troubleshooting)
- [New Member Guide](#new-member-guide)
  - [Step 1 — You Join the Group](#step-1--you-join-the-group)
  - [Step 2 — Write Your Introduction](#step-2--write-your-introduction)
  - [Step 3 — You're In](#step-3--youre-in)
- [Existing Member Guide](#existing-member-guide)

---

## Roles

| Role | Who | What the bot does |
|---|---|---|
| **Admin** | Telegram group admin | Full access to all commands; messages never blocked |
| **New member** | Just joined, not yet introduced | Messages deleted until a valid intro is posted |
| **Introduced member** | Has posted an accepted intro | Posts freely, bot is invisible to them |

---

## Admin Guide

### Initial Setup

This is a one-time process. Do it once after adding the bot.

#### Step 1 — Add the bot to your main group

Add the bot as an admin with the following permissions:
- **Delete messages** ← required for the gatekeeper to work
- Read messages (default)

#### Step 2 — Register the main group

Inside the main group, send:

```
/setgroup
```

The bot confirms with an ephemeral reply (visible only briefly, auto-deletes in 30 s).

#### Step 3 — Register the intro channel

You have two options depending on your setup:

**Option A — Separate channel or group**

Add the bot to your intro channel (read messages permission is enough), then inside that channel send:

```
/setintro
```

**Option B — Forum topic inside the main group**

If you prefer to keep everything in one supergroup, open the forum topic you want to use as the intro channel and send:

```
/setintro
```

The bot detects the thread ID automatically and will only treat that specific topic as the intro channel. All other topics in the group remain gated.

> **Note:** You cannot use `/setintro` in the main group's General topic (non-forum). Use a dedicated channel or a forum topic.

#### Reassigning later

- To move the main group to a different chat: run `/setgroup` in the new chat. You must be an admin of the **current** main group to reassign it.
- To move the intro channel: run `/setintro` in the new location. You must be an admin of the **main group** to reassign it.
- If either value was set via an environment variable (`.env`), the command will be blocked — remove the env var first.

---

### Daily Moderation Commands

All commands below only work **inside the main group** and only for **Telegram group admins**. They are silently ignored in private chats or other groups. Replies auto-delete after 30 seconds.

#### Approve a user manually

Use this when a member needs to be let in without posting a formal intro — for example, someone who was in the group before the bot was installed, or a known contributor.

```
/approve 123456789
/approve @username
```

Or reply to any message the user sent, then:

```
/approve
```

#### Reset a user

Forces a member back to "pending" status. Their next message in the group will be deleted until they post a new intro. Use this for moderation (e.g., a member who deleted their intro and needs to re-introduce).

```
/reset 123456789
/reset @username
```

Or reply to one of their messages:

```
/reset
```

#### Check a user's status

Returns their name, ID, intro status, join date, and when they introduced themselves (if applicable).

```
/status 123456789
/status @username
```

Or reply to one of their messages:

```
/status
```

Example output:
```
User: Ali (@ali_dev)
ID: 123456789
Status: Introduced
Joined: 2025-01-15 08:30:00
Introduced at: 2025-01-15 09:00:00
```

#### List pending members

Shows all members who have joined but not yet introduced themselves, sorted by join date (oldest first), paginated at 50 per page.

```
/pending
```

For page 2:

```
/pending 2
```

Example output:
```
Pending introductions (3) — page 1/1:

- Ali (@ali_dev) -- ID: 123456789
- Siti (N/A) -- ID: 987654321
- Raj (@raj_builds) -- ID: 111222333
```

---

### Command Reference

| Command | Where | Who | What it does |
|---|---|---|---|
| `/setgroup` | Main group | Any current group admin | Registers this chat as the main group |
| `/setintro` | Intro channel or forum topic | Any current channel admin | Registers this chat/topic as the intro channel |
| `/approve` | Main group | Group admin | Marks a user as introduced — accepts user ID, `@username`, or reply |
| `/reset` | Main group | Group admin | Resets a user to pending — accepts user ID, `@username`, or reply |
| `/status` | Main group | Group admin | Shows a user's current intro status — accepts user ID, `@username`, or reply |
| `/pending` | Main group | Group admin | Lists all pending members |

---

### Permissions the Bot Needs

| Chat | Required permission |
|---|---|
| Main group | Admin with **Delete Messages** |
| Intro channel (separate) | Read messages (no admin needed) |
| Intro topic (forum) | The bot is already in the group, no extra permission needed |

If the bot lacks delete permission, it will fall back to reminder-only mode — messages from unintroduced users won't be deleted, but a reminder will still be sent.

---

### Troubleshooting

**The bot isn't deleting messages from unintroduced users.**
- Confirm the bot has "Delete Messages" admin permission in the main group.
- Run `/status <user_id>` to verify the user's record shows `Status: Pending`.
- Check that `/setgroup` was run and the bot responded with a confirmation.

**The bot is sending welcome messages to members who are already introduced.**
- This was a known bug fixed in the current version. If you're seeing it, ensure you're running the latest code.

**A member posted a valid intro but the bot didn't accept it.**
- The intro must be at least 50 characters. Short messages are rejected.
- If it's longer than 50 characters but under 80, it needs at least 2 of these phrases: "who are you", "what do you do", "where are you based", "fun fact", "contribute".
- Intros 80 characters or longer are always accepted regardless of keywords.
- Use `/approve` to manually clear them if their intro looks legitimate.

**The bot isn't responding to `/setgroup` or `/setintro`.**
- The bot only responds if you are a Telegram group admin of that chat. Regular members' commands are silently ignored.
- If using environment variables (`MAIN_GROUP_ID` or `INTRO_CHANNEL_ID` in `.env`), those values are locked — the slash commands will tell you to remove the env var first.

**A user is blocked even though they were in the group before the bot was added.**
- Pre-existing members are not automatically tracked. Use `/approve <user_id>` to let them in without an intro, or ask them to post an intro in the intro channel.

**The bot shows "A main group is already configured" when running `/setgroup`.**
- A main group is already registered. To reassign it, you must be an admin of the **current** main group, not just the new one.

---

## New Member Guide

### Step 1 — You Join the Group

When you join, the bot sends a welcome message in the group that looks like this:

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
> Post your intro here: [link to intro channel]

**Until you post an intro, any message you send in the main group will be automatically deleted.** You'll receive a brief reminder pointing you to the intro channel — that reminder disappears after 15 seconds.

---

### Step 2 — Write Your Introduction

Go to the intro channel (linked in the welcome message) and write a text message about yourself.

**Your intro must be a text message.** Photos, stickers, files, and voice messages are not accepted as introductions.

**What makes a valid intro:**

| Condition | Result |
|---|---|
| Less than 50 characters | Rejected — too short |
| 50–79 characters + fewer than 2 intro topics covered | Rejected — needs more content |
| 50–79 characters + at least 2 of the topics below | Accepted |
| 80 characters or more (any content) | Accepted automatically |
| More than 4000 characters | Rejected — too long |

**The 5 intro topics the bot looks for** (you need at least 2 of these if your intro is under 80 characters):

- Who you are
- What you do
- Where you're based
- A fun fact
- How you want to contribute

**Example of a valid intro:**

> Hi! I'm Ali, a frontend developer from Kuala Lumpur. I've been building on Solana for about a year and I'm really excited about DeFi tools. Fun fact: I once hosted a blockchain workshop for 80 people in a café with no projector. I'd love to help with community tooling and hackathon projects!

If your intro is too short or missing key details, the bot will send you a nudge reply asking you to add more. You can edit your message or post a new one. You have up to 5 attempts per minute.

---

### Step 3 — You're In

Once your intro is accepted, the bot replies to your message:

> Thanks for the intro, Ali! You can now chat in the main group. Welcome aboard!

The welcome message in the main group is automatically cleaned up. You can now post freely in the main group — the bot becomes invisible to you.

---

### If You Leave and Come Back

- **Already introduced:** You can post immediately. No welcome message, no re-introduction needed.
- **Still pending (never finished your intro):** You'll receive a fresh welcome message and need to complete your intro before chatting.

---

## Existing Member Guide

Once you're introduced, the bot does nothing to your messages. You post, it passes through — no interaction, no friction.

The only time you might notice the bot again:

- **If an admin runs `/reset` on your account** — you'll be back to pending status and your messages in the main group will be deleted again until you post a new intro in the intro channel.
- **If you leave and rejoin** — your introduced status is preserved. You can post right away.
- **If you post a suspicious link** — your message is **deleted** and the bot sends a warning in the chat. Suspicious links include URL shorteners (bit.ly, tinyurl.com, t.co, rebrand.ly, etc.), bare IP address links, Telegram invite links (t.me/+… or tg://join…), and internationalised domain names that look like legitimate sites. Use a full, direct URL instead. Admins are exempt from this check.
