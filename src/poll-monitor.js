const cron = require('node-cron');
const db = require('./db/database');
const { getNextTimestamp } = require('./timeutils');

let monitorTask = null;

function startPollMonitor(client) {
  // Check every minute for polls that need attention
  monitorTask = cron.schedule('* * * * *', () => {
    checkPolls(client);
  });
}

function stopPollMonitor() {
  if (monitorTask) {
    monitorTask.stop();
    monitorTask = null;
  }
}

async function checkPolls(client) {
  const openPolls = db.prepare(
    'SELECT * FROM extra_day_polls WHERE poll_enabled = 1 AND closed = 0'
  ).all();

  const now = new Date();

  for (const poll of openPolls) {
    const closesAt = new Date(poll.closes_at);
    const createdAt = new Date(poll.created_at);
    const ageMs = now.getTime() - createdAt.getTime();
    const ageHours = ageMs / (1000 * 60 * 60);

    // Check if poll has expired (24h)
    if (now >= closesAt) {
      await closePoll(client, poll);
      continue;
    }

    // Check if we need to nag non-voters (after 12h, every 2h)
    if (ageHours >= 12) {
      const lastPing = poll.last_ping_at ? new Date(poll.last_ping_at) : null;
      const hoursSinceLastPing = lastPing
        ? (now.getTime() - lastPing.getTime()) / (1000 * 60 * 60)
        : Infinity;

      if (hoursSinceLastPing >= 2) {
        await pingNonVoters(client, poll);
      }
    }
  }
}

async function closePoll(client, poll) {
  db.prepare('UPDATE extra_day_polls SET closed = 1 WHERE id = ?').run(poll.id);

  const yes = db.prepare("SELECT COUNT(*) as c FROM extra_day_votes WHERE poll_id = ? AND vote = 'yes'").get(poll.id).c;
  const no = db.prepare("SELECT COUNT(*) as c FROM extra_day_votes WHERE poll_id = ? AND vote = 'no'").get(poll.id).c;

  try {
    const channel = await client.channels.fetch(poll.channel_id);

    if (yes >= 8) {
      db.prepare('UPDATE extra_day_polls SET confirmed = 1 WHERE id = ?').run(poll.id);

      const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(poll.guild_id);
      const tz = config?.timezone || 'America/New_York';
      const ts = getNextTimestamp(new Date(poll.proposed_date + 'T00:00:00').getUTCDay(), poll.hour, poll.minute, tz);

      await channel.send(
        `**Extra Raid Day Confirmed!**\n` +
        `All 8 members confirmed. See you on **${poll.proposed_date}** at <t:${ts}:t>!`
      );
    } else {
      await channel.send(
        `**Extra Raid Day Poll Closed**\n` +
        `The poll for **${poll.proposed_date}** has expired.\n` +
        `Result: **${yes}** yes / **${no}** no — needed 8 yes votes. **Not confirmed.**`
      );
    }

    // Remove buttons from poll message
    const msg = await channel.messages.fetch(poll.message_id);
    await msg.edit({ components: [] });
  } catch (e) {
    console.error(`Failed to close poll ${poll.id}:`, e);
  }
}

async function pingNonVoters(client, poll) {
  try {
    const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(poll.guild_id);
    if (!config || !config.static_member_role_id) return;

    const guild = await client.guilds.fetch(poll.guild_id);
    await guild.members.fetch(); // Ensure cache is populated

    // Get all static members
    const staticMembers = guild.members.cache.filter(
      m => m.roles.cache.has(config.static_member_role_id)
    );

    // Get users who have already voted
    const voters = db.prepare('SELECT user_id FROM extra_day_votes WHERE poll_id = ?')
      .all(poll.id)
      .map(v => v.user_id);

    // Find non-voters
    const nonVoters = staticMembers.filter(m => !voters.includes(m.id));

    if (nonVoters.size === 0) return;

    const channel = await client.channels.fetch(poll.channel_id);
    const mentions = nonVoters.map(m => `<@${m.id}>`).join(' ');

    await channel.send(
      `**Reminder:** The extra raid day poll for **${poll.proposed_date}** still needs your vote!\n` +
      `${mentions}\n\n` +
      `Please vote above. Poll closes <t:${Math.floor(new Date(poll.closes_at).getTime() / 1000)}:R>.`
    );

    // Update last ping time
    db.prepare('UPDATE extra_day_polls SET last_ping_at = ? WHERE id = ?')
      .run(new Date().toISOString(), poll.id);
  } catch (e) {
    console.error(`Failed to ping non-voters for poll ${poll.id}:`, e);
  }
}

module.exports = { startPollMonitor, stopPollMonitor };
