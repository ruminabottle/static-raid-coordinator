const Database = require('better-sqlite3');
const path = require('node:path');

const db = new Database(path.join(__dirname, '..', '..', 'data.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS guild_config (
    guild_id TEXT PRIMARY KEY,
    raid_lead_role_id TEXT,
    static_member_role_id TEXT,
    reminder_channel_id TEXT,
    reminder_minutes INTEGER DEFAULT 60,
    timezone TEXT DEFAULT 'America/New_York'
  );

  CREATE TABLE IF NOT EXISTS raid_schedule (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    day_of_week INTEGER NOT NULL,  -- 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
    hour INTEGER NOT NULL,         -- Local time hour
    minute INTEGER NOT NULL,       -- Local time minute
    FOREIGN KEY (guild_id) REFERENCES guild_config(guild_id),
    UNIQUE(guild_id, day_of_week)
  );

  CREATE TABLE IF NOT EXISTS cancellations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    raid_date TEXT NOT NULL,  -- YYYY-MM-DD
    reason TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(guild_id, user_id, raid_date)
  );

  CREATE TABLE IF NOT EXISTS reschedule_proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    original_date TEXT NOT NULL,
    proposed_date TEXT NOT NULL,
    proposed_by TEXT NOT NULL,
    message_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reschedule_votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proposal_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    vote TEXT NOT NULL,  -- 'yes' or 'no'
    FOREIGN KEY (proposal_id) REFERENCES reschedule_proposals(id),
    UNIQUE(proposal_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS optional_days (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    proposed_by TEXT NOT NULL,
    proposed_date TEXT NOT NULL,
    hour INTEGER NOT NULL,
    minute INTEGER NOT NULL,
    message_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS optional_day_votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    optional_day_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    vote TEXT NOT NULL,
    FOREIGN KEY (optional_day_id) REFERENCES optional_days(id),
    UNIQUE(optional_day_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS extra_day_polls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    proposed_by TEXT NOT NULL,
    proposed_date TEXT NOT NULL,
    hour INTEGER NOT NULL,
    minute INTEGER NOT NULL,
    poll_enabled INTEGER NOT NULL DEFAULT 0,
    poll_group TEXT,
    message_id TEXT,
    channel_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    closes_at TEXT,
    confirmed INTEGER NOT NULL DEFAULT 0,
    closed INTEGER NOT NULL DEFAULT 0,
    last_ping_at TEXT
  );

  CREATE TABLE IF NOT EXISTS extra_day_votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    poll_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    vote TEXT NOT NULL,  -- 'yes' or 'no'
    FOREIGN KEY (poll_id) REFERENCES extra_day_polls(id),
    UNIQUE(poll_id, user_id)
  );
`);

module.exports = db;
