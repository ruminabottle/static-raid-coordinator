const { SlashCommandBuilder } = require('discord.js');
const { DateTime } = require('luxon');
const db = require('../db/database');
const { DAY_NAMES, getNextTimestamp, getNextOccurrence } = require('../timeutils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cancel')
    .setDescription('Cancel an upcoming raid night for the whole group')
    .addStringOption(opt =>
      opt.setName('date')
        .setDescription('Raid date (YYYY-MM-DD), or leave blank for next raid')
        .setRequired(false))
    .addStringOption(opt =>
      opt.setName('reason')
        .setDescription('Reason for cancellation')
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
      // Find the nearest upcoming raid (regular or extra), excluding already cancelled
      let nearestDt = null;

      for (const s of schedules) {
        const dt = getNextOccurrence(s.day_of_week, s.hour, s.minute, tz);
        const dStr = dt.toFormat('yyyy-MM-dd');
        const alreadyCancelled = db.prepare(
          'SELECT id FROM cancellations WHERE guild_id = ? AND raid_date = ?'
        ).get(guildId, dStr);
        if (alreadyCancelled) continue;
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
    const isRegularDay = schedules.some(s => s.day_of_week === dayOfWeek);
    const isExtraDay = extraDays.some(e => e.proposed_date === dateStr);

    if (!isRegularDay && !isExtraDay) {
      return interaction.reply({
        content: `**${DAY_NAMES[dayOfWeek]} (${dateStr})** isn't a scheduled raid day or extra day.`,
        flags: 64,
      });
    }

    // Extra day — remove it entirely
    if (isExtraDay && !isRegularDay) {
      const extra = extraDays.find(e => e.proposed_date === dateStr);
      const ts = getNextTimestamp(dayOfWeek, extra.hour, extra.minute, tz);
      const reasonStr = reason ? `\nReason: *${reason}*` : '';

      db.prepare('UPDATE extra_day_polls SET closed = 1, confirmed = 0 WHERE id = ?').run(extra.id);

      const channel = await interaction.client.channels.fetch(config.reminder_channel_id);
      if (channel) {
        await channel.send(
          `**Extra Raid Day Cancelled**\n` +
          `<@${userId}> has cancelled **${DAY_NAMES[dayOfWeek]} ${dateStr}** (<t:${ts}:t>). The extra day has been removed.${reasonStr}`
        );
      }

      return interaction.reply({ content: `Extra day **${dateStr}** has been cancelled.`, flags: 64 });
    }

    // Regular raid night — cancel the entire night
    const alreadyCancelled = db.prepare(
      'SELECT id FROM cancellations WHERE guild_id = ? AND raid_date = ?'
    ).get(guildId, dateStr);

    if (alreadyCancelled) {
      return interaction.reply({ content: `**${dateStr}** is already cancelled.`, flags: 64 });
    }

    db.prepare(`
      INSERT INTO cancellations (guild_id, user_id, raid_date, reason)
      VALUES (?, ?, ?, ?)
    `).run(guildId, userId, dateStr, reason);

    const schedule = schedules.find(s => s.day_of_week === dayOfWeek);
    const ts = getNextTimestamp(schedule.day_of_week, schedule.hour, schedule.minute, tz);
    const reasonStr = reason ? `\nReason: *${reason}*` : '';

    const rolePing = config.static_member_role_id ? `<@&${config.static_member_role_id}> ` : '';
    const channel = await interaction.client.channels.fetch(config.reminder_channel_id);
    if (channel) {
      await channel.send(
        `${rolePing}**Raid Night Cancelled**\n` +
        `<@${userId}> has cancelled **${DAY_NAMES[dayOfWeek]} ${dateStr}** (<t:${ts}:t>). No raid this night.${reasonStr}\n\n` +
        `Use \`/extraday propose\` to pick a replacement day.`
      );
    }

    await interaction.reply({ content: `**${DAY_NAMES[dayOfWeek]} ${dateStr}** has been cancelled for everyone.`, flags: 64 });
  },
};
