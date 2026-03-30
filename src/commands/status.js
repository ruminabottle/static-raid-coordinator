const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { DateTime } = require('luxon');
const db = require('../db/database');
const { DAY_NAMES, getNextOccurrence } = require('../timeutils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show the status of the next raid'),

  async execute(interaction) {
    const guildId = interaction.guild.id;

    const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId);
    if (!config) {
      return interaction.reply({ content: 'Run `/setup` first.', flags: 64 });
    }

    const tz = config.timezone || 'America/New_York';
    const now = DateTime.now().setZone(tz);
    const schedules = db.prepare('SELECT * FROM raid_schedule WHERE guild_id = ? ORDER BY day_of_week').all(guildId);

    // Find the nearest upcoming raid that isn't cancelled
    let nearest = null;
    let nearestDt = null;

    for (const s of schedules) {
      const dt = getNextOccurrence(s.day_of_week, s.hour, s.minute, tz);
      const dateStr = dt.toFormat('yyyy-MM-dd');
      const cancelled = db.prepare(
        'SELECT id FROM cancellations WHERE guild_id = ? AND raid_date = ?'
      ).get(guildId, dateStr);
      if (cancelled) continue;

      if (!nearestDt || dt < nearestDt) {
        nearestDt = dt;
        nearest = s;
      }
    }

    // Also check extra days
    const extraDays = db.prepare(
      'SELECT * FROM extra_day_polls WHERE guild_id = ? AND confirmed = 1'
    ).all(guildId);

    for (const e of extraDays) {
      const dt = DateTime.fromISO(e.proposed_date, { zone: tz })
        .set({ hour: e.hour, minute: e.minute });
      if (dt > now && (!nearestDt || dt < nearestDt)) {
        nearestDt = dt;
        nearest = { day_of_week: new Date(e.proposed_date + 'T00:00:00').getUTCDay(), extra: true };
      }
    }

    if (!nearestDt) {
      return interaction.reply('No upcoming raids found (all cancelled or none scheduled).');
    }

    const nextDate = nearestDt.toFormat('yyyy-MM-dd');
    const ts = Math.floor(nearestDt.toSeconds());
    const label = nearest.extra ? ' *(extra)* ' : ' ';

    const embed = new EmbedBuilder()
      .setColor(0x3498DB)
      .setTitle(`Next Raid: ${DAY_NAMES[nearest.day_of_week]}, ${nextDate}${label}`)
      .setDescription(`At <t:${ts}:t> (<t:${ts}:R>)\n\nRaid is on! Use \`/cancel\` to cancel the night if needed.`);

    await interaction.reply({ embeds: [embed] });
  },
};
