const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../db/database');

function formatMinutes(minutes) {
  if (minutes >= 60) {
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  }
  return `${minutes}m`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reminder')
    .setDescription('Manage raid reminders')
    .addSubcommand(sub =>
      sub.setName('set')
        .setDescription('Set reminder time before raids (Raid Lead only)')
        .addIntegerOption(opt =>
          opt.setName('minutes')
            .setDescription('How many minutes before raid to send reminder')
            .setRequired(true)
            .setMinValue(5)
            .setMaxValue(1440)))
    .addSubcommand(sub =>
      sub.setName('view')
        .setDescription('View current reminder settings'))
    .addSubcommand(sub =>
      sub.setName('disable')
        .setDescription('Disable raid reminders (Raid Lead only)')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId);

    if (!config) {
      return interaction.reply({ content: 'Run `/setup` first.', flags: 64 });
    }

    if (sub === 'set' || sub === 'disable') {
      const hasRole = interaction.member.roles.cache.has(config.raid_lead_role_id);
      if (!hasRole) {
        return interaction.reply({ content: 'Only Raid Leads can change reminder settings.', flags: 64 });
      }
    }

    if (sub === 'set') {
      const minutes = interaction.options.getInteger('minutes');
      db.prepare('UPDATE guild_config SET reminder_minutes = ? WHERE guild_id = ?').run(minutes, guildId);

      const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('Reminder Updated')
        .setDescription(`Raid reminders set to **${formatMinutes(minutes)}** before raid time.`);
      await interaction.reply({ embeds: [embed] });
    } else if (sub === 'view') {
      const minutes = config.reminder_minutes;
      const channel = config.reminder_channel_id ? `<#${config.reminder_channel_id}>` : 'Not set';

      const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('Reminder Settings');

      if (minutes === 0) {
        embed.setDescription(`**Status:** Disabled\n**Channel:** ${channel}`);
      } else {
        embed.setDescription(`**Timing:** ${formatMinutes(minutes)} before raid\n**Channel:** ${channel}`);
      }
      await interaction.reply({ embeds: [embed] });
    } else if (sub === 'disable') {
      db.prepare('UPDATE guild_config SET reminder_minutes = 0 WHERE guild_id = ?').run(guildId);

      const embed = new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle('Reminders Disabled')
        .setDescription('Raid reminders have been turned off. Use `/reminder set` to re-enable.');
      await interaction.reply({ embeds: [embed] });
    }
  },
};
