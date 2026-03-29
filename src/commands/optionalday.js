const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../db/database');
const { DAY_NAMES, formatTime } = require('../reminders');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('optionalday')
    .setDescription('Propose an optional extra raid day for the group to vote on')
    .addStringOption(opt =>
      opt.setName('date')
        .setDescription('Date for the optional day (YYYY-MM-DD)')
        .setRequired(true))
    .addIntegerOption(opt =>
      opt.setName('hour')
        .setDescription('Hour (0-23, 24h format)')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(23))
    .addIntegerOption(opt =>
      opt.setName('minute')
        .setDescription('Minute (0-59)')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(59)),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const dateStr = interaction.options.getString('date');
    const hour = interaction.options.getInteger('hour');
    const minute = interaction.options.getInteger('minute');

    const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId);
    if (!config) {
      return interaction.reply({ content: 'Run `/setup` first.', flags: 64 });
    }

    const date = new Date(dateStr + 'T00:00:00');
    if (isNaN(date.getTime())) {
      return interaction.reply({ content: 'Invalid date. Use YYYY-MM-DD.', flags: 64 });
    }

    const result = db.prepare(`
      INSERT INTO optional_days (guild_id, proposed_by, proposed_date, hour, minute)
      VALUES (?, ?, ?, ?, ?)
    `).run(guildId, interaction.user.id, dateStr, hour, minute);

    const optionalId = result.lastInsertRowid;
    const dayOfWeek = date.getUTCDay();
    const timeStr = formatTime(hour, minute);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`optional_yes_${optionalId}`)
        .setLabel('I\'m in')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`optional_no_${optionalId}`)
        .setLabel('Can\'t make it')
        .setStyle(ButtonStyle.Secondary),
    );

    const channel = await interaction.client.channels.fetch(config.reminder_channel_id);
    const msg = await channel.send({
      content:
        `**Optional Raid Day Proposed**\n` +
        `<@${interaction.user.id}> is proposing an extra raid on:\n` +
        `**${DAY_NAMES[dayOfWeek]}, ${dateStr}** at **${timeStr}**\n\n` +
        `Vote below!`,
      components: [row],
    });

    db.prepare('UPDATE optional_days SET message_id = ? WHERE id = ?').run(msg.id, optionalId);

    await interaction.reply({ content: `Optional day proposal posted in ${channel}.`, flags: 64 });
  },
};
