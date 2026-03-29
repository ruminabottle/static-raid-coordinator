const { SlashCommandBuilder } = require('discord.js');
const { DateTime } = require('luxon');
const db = require('../db/database');
const { DAY_NAMES, getNextTimestamp, getNextOccurrence } = require('../timeutils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cancel')
    .setDescription('Cancel your attendance for an upcoming raid night')
    .addStringOption(opt =>
      opt.setName('date')
        .setDescription('Raid date (YYYY-MM-DD), or leave blank for next raid')
        .setRequired(false))
    .addStringOption(opt =>
      opt.setName('reason')
        .setDescription('Why you can\'t make it')
        .setRequired(false)),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const userId = interaction.user.id;

    const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId);
    if (!config) {
      return interaction.reply({ content: 'Bot not set up yet. Run `/setup` first.', flags: 64 });
    }

    const tz = config.timezone || 'America/New_York';
    const now = DateTime.now().setZone(tz);
    const schedules = db.prepare('SELECT * FROM raid_schedule WHERE guild_id = ? ORDER BY day_of_week').all(guildId);

    // Get upcoming extra days
    const extraDays = db.prepare(
      'SELECT * FROM extra_day_polls WHERE guild_id = ? AND confirmed = 1'
    ).all(guildId).filter(e => {
      const extraTime = DateTime.fromISO(e.proposed_date, { zone: tz })
        .set({ hour: e.hour, minute: e.minute });
      return extraTime > now;
    });

    if (schedules.length === 0 && extraDays.length === 0) {
      return interaction.reply({ content: 'No raid schedule set.', flags: 64 });
    }

    let dateStr = interaction.options.getString('date');
    const reason = interaction.options.getString('reason');

    if (!dateStr) {
      // Find the nearest upcoming raid (regular or extra)
      let nearestDt = null;

      for (const s of schedules) {
        const dt = getNextOccurrence(s.day_of_week, s.hour, s.minute, tz);
        if (!nearestDt || dt < nearestDt) nearestDt = dt;
      }

      for (const e of extraDays) {
        const dt = DateTime.fromISO(e.proposed_date, { zone: tz })
          .set({ hour: e.hour, minute: e.minute });
        if (dt > now && (!nearestDt || dt < nearestDt)) nearestDt = dt;
      }

      if (!nearestDt) {
        return interaction.reply({ content: 'No upcoming raids found.', flags: 64 });
      }
      dateStr = nearestDt.toFormat('yyyy-MM-dd');
    }

    // Validate date
    const date = new Date(dateStr + 'T00:00:00');
    if (isNaN(date.getTime())) {
      return interaction.reply({ content: 'Invalid date format. Use YYYY-MM-DD.', flags: 64 });
    }

    const dayOfWeek = date.getUTCDay();

    // Check if it's a regular raid day OR an extra day
    const isRegularDay = schedules.some(s => s.day_of_week === dayOfWeek);
    const isExtraDay = extraDays.some(e => e.proposed_date === dateStr);

    if (!isRegularDay && !isExtraDay) {
      return interaction.reply({
        content: `**${DAY_NAMES[dayOfWeek]} (${dateStr})** isn't a scheduled raid day or extra day.`,
        flags: 64,
      });
    }

    // If it's an extra day (and not also a regular day), remove it entirely
    if (isExtraDay && !isRegularDay) {
      const extra = extraDays.find(e => e.proposed_date === dateStr);
      const ts = getNextTimestamp(dayOfWeek, extra.hour, extra.minute, tz);
      const reasonStr = reason ? `\nReason: *${reason}*` : '';

      db.prepare('UPDATE extra_day_polls SET closed = 1, confirmed = 0 WHERE id = ?').run(extra.id);

      const channel = await interaction.client.channels.fetch(config.reminder_channel_id);
      if (channel) {
        await channel.send(
          `**Extra Raid Day Cancelled**\n` +
          `<@${userId}> can't make **${DAY_NAMES[dayOfWeek]} ${dateStr}** (<t:${ts}:t>), so the extra day has been removed.${reasonStr}`
        );
      }

      return interaction.reply({ content: `Extra day **${dateStr}** has been cancelled.`, flags: 64 });
    }

    // Regular raid day — record cancellation
    db.prepare(`
      INSERT INTO cancellations (guild_id, user_id, raid_date, reason)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id, raid_date) DO UPDATE SET reason = excluded.reason
    `).run(guildId, userId, dateStr, reason);

    const schedule = schedules.find(s => s.day_of_week === dayOfWeek);
    const ts = getNextTimestamp(schedule.day_of_week, schedule.hour, schedule.minute, tz);
    const reasonStr = reason ? `\nReason: *${reason}*` : '';

    const channel = await interaction.client.channels.fetch(config.reminder_channel_id);
    if (channel) {
      await channel.send(
        `<@${userId}> has cancelled for **${DAY_NAMES[dayOfWeek]} ${dateStr}** (<t:${ts}:t>).${reasonStr}\n\n` +
        `If the group needs to reschedule, use \`/reschedule\`.`
      );
    }

    await interaction.reply({ content: `You've cancelled for **${dateStr}**.`, flags: 64 });
  },
};
