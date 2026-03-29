const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../db/database');
const { DAY_NAMES, formatTime } = require('../timeutils');

// FFXIV week: Tue reset. Reschedule options: Fri(5), Sat(6), Sun(0), Mon(1)
const RESCHEDULE_DAYS = [5, 6, 0, 1];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reschedule')
    .setDescription('Propose rescheduling a cancelled raid night')
    .addStringOption(opt =>
      opt.setName('date')
        .setDescription('Original raid date to reschedule (YYYY-MM-DD)')
        .setRequired(true))
    .addIntegerOption(opt =>
      opt.setName('proposed_day')
        .setDescription('Day to reschedule to')
        .setRequired(true)
        .addChoices(
          { name: 'Friday', value: 5 },
          { name: 'Saturday', value: 6 },
          { name: 'Sunday', value: 0 },
          { name: 'Monday', value: 1 },
        ))
    .addIntegerOption(opt =>
      opt.setName('hour')
        .setDescription('Hour (0-23, 24h format) — defaults to original raid time')
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(23))
    .addIntegerOption(opt =>
      opt.setName('minute')
        .setDescription('Minute (0-59) — defaults to original raid time')
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(59)),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const originalDate = interaction.options.getString('date');
    const proposedDay = interaction.options.getInteger('proposed_day');

    const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId);
    if (!config) {
      return interaction.reply({ content: 'Run `/setup` first.', flags: 64 });
    }

    // Calculate the proposed date (next occurrence of that day in the same FFXIV week)
    const origDate = new Date(originalDate + 'T00:00:00');
    if (isNaN(origDate.getTime())) {
      return interaction.reply({ content: 'Invalid date. Use YYYY-MM-DD.', flags: 64 });
    }

    const proposedDate = getNextDayInWeek(origDate, proposedDay);
    const proposedDateStr = proposedDate.toISOString().split('T')[0];

    // Check it's not already a scheduled raid day
    const existingSchedule = db.prepare(
      'SELECT * FROM raid_schedule WHERE guild_id = ? AND day_of_week = ?'
    ).get(guildId, proposedDay);

    // Get time — use provided or fall back to original raid time
    const origSchedule = db.prepare(
      'SELECT * FROM raid_schedule WHERE guild_id = ? AND day_of_week = ?'
    ).get(guildId, origDate.getUTCDay());

    const hour = interaction.options.getInteger('hour') ?? origSchedule?.hour ?? 20;
    const minute = interaction.options.getInteger('minute') ?? origSchedule?.minute ?? 0;
    const timeStr = formatTime(hour, minute);

    // Save proposal
    const result = db.prepare(`
      INSERT INTO reschedule_proposals (guild_id, original_date, proposed_date, proposed_by)
      VALUES (?, ?, ?, ?)
    `).run(guildId, originalDate, proposedDateStr, interaction.user.id);

    const proposalId = result.lastInsertRowid;

    // Create vote buttons
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`reschedule_yes_${proposalId}`)
        .setLabel('I can make it')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`reschedule_no_${proposalId}`)
        .setLabel("Can't make it")
        .setStyle(ButtonStyle.Danger),
    );

    const channel = await interaction.client.channels.fetch(config.reminder_channel_id);
    const msg = await channel.send({
      content:
        `**Reschedule Proposal**\n` +
        `<@${interaction.user.id}> wants to move the **${originalDate}** raid to:\n` +
        `**${DAY_NAMES[proposedDay]}, ${proposedDateStr}** at **${timeStr}**\n\n` +
        `Vote below to let the group know if you can make it.`,
      components: [row],
    });

    // Store message ID for tracking
    db.prepare('UPDATE reschedule_proposals SET message_id = ? WHERE id = ?').run(msg.id, proposalId);

    await interaction.reply({ content: `Reschedule proposal posted in ${channel}.`, flags: 64 });
  },
};

function getNextDayInWeek(fromDate, targetDay) {
  const date = new Date(fromDate);
  const currentDay = date.getUTCDay();
  let diff = targetDay - currentDay;
  if (diff <= 0) diff += 7;
  date.setUTCDate(date.getUTCDate() + diff);
  return date;
}
