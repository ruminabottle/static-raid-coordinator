const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all available commands'),

  async execute(interaction) {
    const msg =
      `**Static Raid Coordinator — Commands**\n\n` +

      `**Setup**\n` +
      `> \`/setup #channel\` — Initialize the bot, create roles, set announcement channel *(Admin)*\n` +
      `> \`/schedule set\` — Interactive raid schedule setup *(Raid Lead)*\n` +
      `> \`/schedule remove <day>\` — Remove a raid day *(Raid Lead)*\n` +
      `> \`/schedule view\` — View the raid schedule + upcoming extra days\n\n` +

      `**Reminders**\n` +
      `> \`/reminder set <minutes>\` — Set how far in advance reminders fire *(Raid Lead)*\n` +
      `> \`/reminder view\` — View current reminder settings\n` +
      `> \`/reminder disable\` — Turn off reminders *(Raid Lead)*\n\n` +

      `**Attendance**\n` +
      `> \`/cancel [date] [reason]\` — Cancel for a raid night (defaults to next raid)\n` +
      `> \`/status\` — Show who's in/out for the next raid\n\n` +

      `**Extra Days**\n` +
      `> \`/extraday propose\` — Propose an extra raid day (interactive wizard)\n` +
      `> \`/extraday cancel [poll_id]\` — Cancel an active extra day poll *(Raid Lead)*\n` +
      `> \`/extraday list\` — Show active extra day polls\n\n` +

      `**Roles**\n` +
      `> **Raid Lead** — Can manage schedule, reminders, and cancel polls\n` +
      `> **Static Member** — Required to vote on extra day polls (assign to all 8 raiders)`;

    await interaction.reply({ content: msg, flags: 64 });
  },
};
