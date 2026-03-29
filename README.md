# Static Raid Coordinator

A Discord bot for coordinating FFXIV static raid schedules. Manages recurring raid nights, extra day proposals with polls, attendance tracking, reminders, and rescheduling.

## Features

- **Interactive schedule setup** with timezone support and Discord timestamp formatting (everyone sees times in their local timezone)
- **DST-aware scheduling** using [Luxon](https://moment.github.io/luxon/) — "9 PM Eastern" stays 9 PM Eastern year-round
- **Extra day proposals** with optional 8-person polls, auto-closing, and non-voter pinging
- **Raid reminders** that ping the static member role at a configurable interval before each raid
- **Cancellation tracking** for regular nights; cancelling an extra day removes it entirely

## Commands

### Setup

| Command | Role | Description |
|---|---|---|
| `/setup #channel` | Admin | Initialize the bot, create roles, set announcement channel |
| `/schedule set` | Raid Lead | Interactive raid schedule wizard (timezone, days, time) |
| `/schedule remove <day>` | Raid Lead | Remove a day from the schedule |
| `/schedule view` | Anyone | View the raid schedule and upcoming extra days |

### Reminders

| Command | Role | Description |
|---|---|---|
| `/reminder set <minutes>` | Raid Lead | Set how far in advance reminders fire (5–1440 min) |
| `/reminder view` | Anyone | View current reminder settings |
| `/reminder disable` | Raid Lead | Turn off reminders |

### Attendance

| Command | Role | Description |
|---|---|---|
| `/cancel [date] [reason]` | Anyone | Cancel for a raid night (defaults to next raid). Cancelling an extra day removes it entirely. |
| `/status` | Anyone | Show who's in/out for the next raid |

### Extra Days

| Command | Role | Description |
|---|---|---|
| `/extraday propose` | Anyone | Interactive wizard to propose an extra raid day with optional poll |
| `/extraday cancel [poll_id]` | Raid Lead | Cancel an active extra day poll |
| `/extraday list` | Anyone | Show active extra day polls |

### Other

| Command | Role | Description |
|---|---|---|
| `/help` | Anyone | Show all available commands |

## Roles

The bot creates two roles during `/setup`:

- **Raid Lead** — Can manage the schedule, reminders, and cancel polls
- **Static Member** — Assign to all 8 raiders. Required to vote on extra day polls and pinged for reminders.

## Local Setup

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- A Discord bot application ([Discord Developer Portal](https://discord.com/developers/applications))

### 1. Clone the repo

```bash
git clone https://github.com/ruminabottle/static-raid-coordinator.git
cd static-raid-coordinator
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create your Discord application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to the **Bot** tab and copy the token
4. Under **Privileged Gateway Intents**, enable **Server Members Intent**
5. Go to **OAuth2 > URL Generator**, select scopes `bot` and `applications.commands`
6. Under **Bot Permissions**, select: `Manage Roles`, `Send Messages`, `Read Message History`
7. Use the generated URL to invite the bot to your server

### 4. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```
DISCORD_TOKEN=your-bot-token
CLIENT_ID=your-application-id
GUILD_ID=your-server-id
```

To find your **Guild ID**: enable Developer Mode in Discord settings, then right-click your server and select "Copy Server ID".

### 5. Deploy commands and start

```bash
npm run deploy-commands
npm start
```

### 6. First-time setup in Discord

1. Run `/setup #your-channel` to create roles and set the announcement channel
2. Assign the **Static Member** role to all 8 raiders
3. Run `/schedule set` to configure your raid days and time
4. Optionally run `/reminder set <minutes>` to adjust reminder timing (default: 60 min)

## Tech Stack

- [discord.js](https://discord.js.org/) v14
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — Local SQLite database
- [Luxon](https://moment.github.io/luxon/) — Timezone and DST handling
- [node-cron](https://github.com/node-cron/node-cron) — Scheduled reminder checks

## Data

All data is stored locally in `data.db` (SQLite). This file is gitignored. The database is created automatically on first run.
