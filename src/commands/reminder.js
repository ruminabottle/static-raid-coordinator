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
      sub.setName('add')
        .setDescription('Add a reminder time before raids (Raid Lead only)')
        .addIntegerOption(opt =>
          opt.setName('minutes')
            .setDescription('How many minutes before raid to send reminder')
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(1440)))
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove a reminder time (Raid Lead only)')
        .addIntegerOption(opt =>
          opt.setName('minutes')
            .setDescription('The reminder time to remove')
            .setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('view')
        .setDescription('View current reminder settings'))
    .addSubcommand(sub =>
      sub.setName('clear')
        .setDescription('Remove all reminders (Raid Lead only)')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId);

    if (!config) {
      return interaction.reply({ content: 'Run `/setup` first.', flags: 64 });
    }

    if (sub === 'add' || sub === 'remove' || sub === 'clear') {
      const hasRole = interaction.member.roles.cache.has(config.raid_lead_role_id);
      if (!hasRole) {
        return interaction.reply({ content: 'Only Raid Leads can change reminder settings.', flags: 64 });
      }
    }

    if (sub === 'add') {
      const minutes = interaction.options.getInteger('minutes');

      const existing = db.prepare('SELECT id FROM reminder_times WHERE guild_id = ? AND minutes = ?').get(guildId, minutes);
      if (existing) {
        return interaction.reply({ content: `A **${formatMinutes(minutes)}** reminder already exists.`, flags: 64 });
      }

      db.prepare('INSERT INTO reminder_times (guild_id, minutes) VALUES (?, ?)').run(guildId, minutes);

      const allReminders = db.prepare('SELECT minutes FROM reminder_times WHERE guild_id = ? ORDER BY minutes DESC').all(guildId);
      const list = allReminders.map(r => `- ${formatMinutes(r.minutes)}`).join('\n');

      const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('Reminder Added')
        .setDescription(`Added **${formatMinutes(minutes)}** before raid.\n\n**Active reminders:**\n${list}`);
      await interaction.reply({ embeds: [embed] });
    } else if (sub === 'remove') {
      const minutes = interaction.options.getInteger('minutes');
      const result = db.prepare('DELETE FROM reminder_times WHERE guild_id = ? AND minutes = ?').run(guildId, minutes);

      if (result.changes === 0) {
        return interaction.reply({ content: `No reminder set for **${formatMinutes(minutes)}**.`, flags: 64 });
      }

      const allReminders = db.prepare('SELECT minutes FROM reminder_times WHERE guild_id = ? ORDER BY minutes DESC').all(guildId);
      const list = allReminders.length > 0
        ? allReminders.map(r => `- ${formatMinutes(r.minutes)}`).join('\n')
        : 'None';

      const embed = new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle('Reminder Removed')
        .setDescription(`Removed **${formatMinutes(minutes)}** reminder.\n\n**Active reminders:**\n${list}`);
      await interaction.reply({ embeds: [embed] });
    } else if (sub === 'view') {
      const channel = config.reminder_channel_id ? `<#${config.reminder_channel_id}>` : 'Not set';
      const allReminders = db.prepare('SELECT minutes FROM reminder_times WHERE guild_id = ? ORDER BY minutes DESC').all(guildId);

      const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('Reminder Settings');

      if (allReminders.length === 0) {
        embed.setDescription(`**Reminders:** None set\n**Channel:** ${channel}\n\nUse \`/reminder add <minutes>\` to add one.`);
      } else {
        const list = allReminders.map(r => `- ${formatMinutes(r.minutes)} before raid`).join('\n');
        embed.setDescription(`**Channel:** ${channel}\n\n**Reminders:**\n${list}`);
      }
      await interaction.reply({ embeds: [embed] });
    } else if (sub === 'clear') {
      db.prepare('DELETE FROM reminder_times WHERE guild_id = ?').run(guildId);

      const embed = new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle('All Reminders Cleared')
        .setDescription('All raid reminders have been removed. Use `/reminder add` to set new ones.');
      await interaction.reply({ embeds: [embed] });
    }
  },
};
