const { SlashCommandBuilder } = require('discord.js');
const db = require('../db/database');

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

      let display;
      if (minutes >= 60) {
        const hrs = Math.floor(minutes / 60);
        const mins = minutes % 60;
        display = mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
      } else {
        display = `${minutes}m`;
      }

      await interaction.reply(`Raid reminders set to **${display}** before raid time.`);
    } else if (sub === 'view') {
      const minutes = config.reminder_minutes;
      const channel = config.reminder_channel_id ? `<#${config.reminder_channel_id}>` : 'Not set';

      if (minutes === 0) {
        await interaction.reply(`**Reminders:** Disabled\n**Channel:** ${channel}`);
      } else {
        let display;
        if (minutes >= 60) {
          const hrs = Math.floor(minutes / 60);
          const mins = minutes % 60;
          display = mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
        } else {
          display = `${minutes}m`;
        }
        await interaction.reply(`**Reminders:** ${display} before raid\n**Channel:** ${channel}`);
      }
    } else if (sub === 'disable') {
      db.prepare('UPDATE guild_config SET reminder_minutes = 0 WHERE guild_id = ?').run(guildId);
      await interaction.reply('Raid reminders have been **disabled**. Use `/reminder set` to re-enable.');
    }
  },
};
