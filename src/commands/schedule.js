const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { DateTime } = require('luxon');
const db = require('../db/database');
const { DAY_NAMES, getNextTimestamp, getNextOccurrence, formatTime } = require('../timeutils');
const { scheduleStep1 } = require('../wizards');
const { scheduleState } = require('../wizard-state');

const DAY_CHOICES = DAY_NAMES.map((name, i) => ({ name, value: i }));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Manage the raid schedule')
    .addSubcommand(sub =>
      sub.setName('set')
        .setDescription('Interactive schedule setup (Raid Lead only)'))
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove a raid day (Raid Lead only)')
        .addIntegerOption(opt =>
          opt.setName('day')
            .setDescription('Day to remove')
            .setRequired(true)
            .addChoices(...DAY_CHOICES)))
    .addSubcommand(sub =>
      sub.setName('view')
        .setDescription('View the recurring weekly raid pattern'))
    .addSubcommand(sub =>
      sub.setName('week')
        .setDescription('View this week\'s raid lineup with cancellations and extra days')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'set' || sub === 'remove') {
      const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId);
      if (!config) {
        return interaction.reply({ content: 'Run `/setup` first.', flags: 64 });
      }
      const hasRole = interaction.member.roles.cache.has(config.raid_lead_role_id);
      if (!hasRole) {
        return interaction.reply({ content: 'Only Raid Leads can modify the schedule.', flags: 64 });
      }
    }

    if (sub === 'set') {
      const key = `${guildId}:${interaction.user.id}`;
      scheduleState.set(key, {});
      const step = scheduleStep1();
      await interaction.reply({ ...step, flags: 64 });
    } else if (sub === 'remove') {
      const day = interaction.options.getInteger('day');
      const result = db.prepare('DELETE FROM raid_schedule WHERE guild_id = ? AND day_of_week = ?').run(guildId, day);

      if (result.changes === 0) {
        return interaction.reply({ content: `No raid was scheduled on ${DAY_NAMES[day]}.`, flags: 64 });
      }
      const embed = new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle('Raid Day Removed')
        .setDescription(`**${DAY_NAMES[day]}** has been removed from the raid schedule.`);
      await interaction.reply({ embeds: [embed] });
    } else if (sub === 'view') {
      await handleView(interaction, guildId);
    } else if (sub === 'week') {
      await handleWeek(interaction, guildId);
    }
  },
};

// Recurring weekly pattern
async function handleView(interaction, guildId) {
  const schedules = db.prepare('SELECT * FROM raid_schedule WHERE guild_id = ? ORDER BY day_of_week').all(guildId);

  if (schedules.length === 0) {
    return interaction.reply('No raid days scheduled yet. Use `/schedule set` to add days.');
  }

  const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId);
  const tz = config?.timezone || 'America/New_York';

  const lines = schedules.map(s => {
    const timeStr = formatTime(s.hour, s.minute);
    const ts = getNextTimestamp(s.day_of_week, s.hour, s.minute, tz);
    return `- **${DAY_NAMES[s.day_of_week]}** at ${timeStr} (<t:${ts}:t> your time)`;
  });

  const embed = new EmbedBuilder()
    .setColor(0x3498DB)
    .setTitle(`Weekly Raid Schedule`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `Timezone: ${tz}` });
  await interaction.reply({ embeds: [embed] });
}

// This week's actual lineup
async function handleWeek(interaction, guildId) {
  const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId);
  if (!config) {
    return interaction.reply({ content: 'Run `/setup` first.', flags: 64 });
  }

  const tz = config.timezone || 'America/New_York';
  const now = DateTime.now().setZone(tz);
  const schedules = db.prepare('SELECT * FROM raid_schedule WHERE guild_id = ? ORDER BY day_of_week').all(guildId);

  // Build list of upcoming raid nights this week (next 7 days)
  const raidNights = [];

  // Regular nights
  for (const s of schedules) {
    const dt = getNextOccurrence(s.day_of_week, s.hour, s.minute, tz);
    if (dt.diff(now, 'days').days <= 7) {
      const dateStr = dt.toFormat('yyyy-MM-dd');
      const ts = Math.floor(dt.toSeconds());

      // Check if this night is cancelled
      const cancellation = db.prepare(
        'SELECT user_id, reason FROM cancellations WHERE guild_id = ? AND raid_date = ?'
      ).get(guildId, dateStr);

      raidNights.push({
        date: dateStr,
        dt,
        ts,
        dayName: DAY_NAMES[s.day_of_week],
        type: 'regular',
        cancelled: !!cancellation,
        cancelledBy: cancellation?.user_id,
        cancelReason: cancellation?.reason,
      });
    }
  }

  // Extra days
  const extraDays = db.prepare(
    'SELECT * FROM extra_day_polls WHERE guild_id = ? AND confirmed = 1 ORDER BY proposed_date'
  ).all(guildId);

  for (const e of extraDays) {
    const extraTime = DateTime.fromISO(e.proposed_date, { zone: tz })
      .set({ hour: e.hour, minute: e.minute });

    if (extraTime <= now) {
      db.prepare('UPDATE extra_day_polls SET closed = 1 WHERE id = ?').run(e.id);
      continue;
    }

    if (extraTime.diff(now, 'days').days <= 7) {
      const dayOfWeek = new Date(e.proposed_date + 'T00:00:00').getUTCDay();
      const ts = Math.floor(extraTime.toSeconds());

      raidNights.push({
        date: e.proposed_date,
        dt: extraTime,
        ts,
        dayName: DAY_NAMES[dayOfWeek],
        type: 'extra',
        cancellations: [],
      });
    }
  }

  if (raidNights.length === 0) {
    return interaction.reply('No raids scheduled in the next 7 days.');
  }

  // Sort by date
  raidNights.sort((a, b) => a.dt.toMillis() - b.dt.toMillis());

  const lines = raidNights.map(r => {
    if (r.cancelled) {
      const reason = r.cancelReason ? ` — *${r.cancelReason}*` : '';
      return `- ~~**${r.dayName}, ${r.date}**~~ **CANCELLED** by <@${r.cancelledBy}>${reason}`;
    }

    let line = `- **${r.dayName}, ${r.date}** at <t:${r.ts}:t> (<t:${r.ts}:R>)`;
    if (r.type === 'extra') line += ' *(extra)*';

    return line;
  });

  const embed = new EmbedBuilder()
    .setColor(0x3498DB)
    .setTitle("This Week's Raids")
    .setDescription(lines.join('\n'));
  await interaction.reply({ embeds: [embed] });
}
