const { SlashCommandBuilder } = require('discord.js');
const { DateTime } = require('luxon');
const db = require('../db/database');
const { DAY_NAMES, getNextTimestamp } = require('../timeutils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('uncancel')
    .setDescription('Reinstate a previously cancelled raid night')
    .addStringOption(opt =>
      opt.setName('date')
        .setDescription('Raid date to uncancel (YYYY-MM-DD), or leave blank for the most recent cancellation')
        .setRequired(false)),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId);

    if (!config) {
      return interaction.reply({ content: 'Run `/setup` first.', flags: 64 });
    }

    const tz = config.timezone || 'America/New_York';
    let dateStr = interaction.options.getString('date');

    if (!dateStr) {
      // Find the most recent future cancellation
      const now = DateTime.now().setZone(tz).toFormat('yyyy-MM-dd');
      const latest = db.prepare(
        'SELECT * FROM cancellations WHERE guild_id = ? AND raid_date >= ? ORDER BY raid_date ASC LIMIT 1'
      ).get(guildId, now);

      if (!latest) {
        return interaction.reply({ content: 'No upcoming cancelled raid nights found.', flags: 64 });
      }
      dateStr = latest.raid_date;
    }

    const result = db.prepare(
      'DELETE FROM cancellations WHERE guild_id = ? AND raid_date = ?'
    ).run(guildId, dateStr);

    if (result.changes === 0) {
      return interaction.reply({ content: `**${dateStr}** wasn't cancelled.`, flags: 64 });
    }

    const dayOfWeek = new Date(dateStr + 'T00:00:00').getUTCDay();
    const schedule = db.prepare(
      'SELECT * FROM raid_schedule WHERE guild_id = ? AND day_of_week = ?'
    ).get(guildId, dayOfWeek);

    let timeInfo = '';
    if (schedule) {
      const ts = getNextTimestamp(dayOfWeek, schedule.hour, schedule.minute, tz);
      timeInfo = ` at <t:${ts}:t>`;
    }

    const rolePing = config.static_member_role_id ? `<@&${config.static_member_role_id}> ` : '';
    const channel = await interaction.client.channels.fetch(config.reminder_channel_id);
    if (channel) {
      await channel.send(
        `${rolePing}**Raid Night Back On!**\n` +
        `<@${interaction.user.id}> has reinstated **${DAY_NAMES[dayOfWeek]} ${dateStr}**${timeInfo}. Raid is happening!`
      );
    }

    await interaction.reply({ content: `**${DAY_NAMES[dayOfWeek]} ${dateStr}** is back on!`, flags: 64 });
  },
};
