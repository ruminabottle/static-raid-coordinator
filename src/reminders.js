const cron = require('node-cron');
const { DateTime } = require('luxon');
const { EmbedBuilder } = require('discord.js');
const db = require('./db/database');
const { DAY_NAMES, getNextOccurrence } = require('./timeutils');

let reminderTask = null;

function startReminders(client) {
  // Check every minute for upcoming raids
  reminderTask = cron.schedule('* * * * *', () => {
    checkReminders(client);
  });
}

function stopReminders() {
  if (reminderTask) {
    reminderTask.stop();
    reminderTask = null;
  }
}

function checkReminders(client) {
  const guilds = db.prepare('SELECT * FROM guild_config WHERE reminder_channel_id IS NOT NULL').all();

  for (const config of guilds) {
    const reminderTimes = db.prepare('SELECT minutes FROM reminder_times WHERE guild_id = ?').all(config.guild_id);
    if (reminderTimes.length === 0) continue;

    const tz = config.timezone || 'America/New_York';
    const now = DateTime.now().setZone(tz);

    // Check regular raid schedule
    const schedules = db.prepare('SELECT * FROM raid_schedule WHERE guild_id = ?').all(config.guild_id);
    for (const schedule of schedules) {
      const raidTime = getNextOccurrence(schedule.day_of_week, schedule.hour, schedule.minute, tz);
      const raidDate = raidTime.toFormat('yyyy-MM-dd');

      const cancelled = db.prepare(
        'SELECT id FROM cancellations WHERE guild_id = ? AND raid_date = ?'
      ).get(config.guild_id, raidDate);
      if (cancelled) continue;

      const diffMinutes = raidTime.diff(now, 'minutes').minutes;

      for (const rt of reminderTimes) {
        if (diffMinutes >= rt.minutes - 0.5 && diffMinutes < rt.minutes + 0.5) {
          sendReminder(client, config, raidTime, rt.minutes);
        }
      }
    }

    // Check confirmed extra days
    const extraDays = db.prepare(
      'SELECT * FROM extra_day_polls WHERE guild_id = ? AND confirmed = 1'
    ).all(config.guild_id);

    for (const extra of extraDays) {
      const extraDate = DateTime.fromISO(extra.proposed_date, { zone: tz })
        .set({ hour: extra.hour, minute: extra.minute, second: 0 });

      if (extraDate <= now) continue;

      const diffMinutes = extraDate.diff(now, 'minutes').minutes;

      for (const rt of reminderTimes) {
        if (diffMinutes >= rt.minutes - 0.5 && diffMinutes < rt.minutes + 0.5) {
          sendReminder(client, config, extraDate, rt.minutes, true);
        }
      }
    }
  }
}

function formatMinutes(minutes) {
  if (minutes >= 60) {
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  }
  return `${minutes}m`;
}

async function sendReminder(client, config, raidTime, minutesBefore, isExtra = false) {
  try {
    const channel = await client.channels.fetch(config.reminder_channel_id);
    if (!channel) return;

    const ts = Math.floor(raidTime.toSeconds());
    const label = isExtra ? 'Extra Raid Reminder' : 'Raid Reminder';

    const rolePing = config.static_member_role_id ? `<@&${config.static_member_role_id}>` : '';

    const embed = new EmbedBuilder()
      .setColor(0xF39C12)
      .setTitle(label)
      .setDescription(minutesBefore === 0
        ? `Raid is starting now at <t:${ts}:t>!`
        : `Raid starts <t:${ts}:R> at <t:${ts}:t>!\n\nIf the group needs to cancel, use \`/cancel\`.`)
      .setFooter({ text: minutesBefore === 0 ? 'Raid starting now!' : `${formatMinutes(minutesBefore)} reminder` });

    await channel.send({
      content: rolePing || undefined,
      embeds: [embed],
    });
  } catch (error) {
    console.error(`Failed to send reminder for guild ${config.guild_id}:`, error);
  }
}

module.exports = { startReminders, stopReminders };
