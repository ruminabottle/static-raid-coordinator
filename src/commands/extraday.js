const { SlashCommandBuilder } = require('discord.js');
const db = require('../db/database');
const { DAY_NAMES, getNextTimestamp } = require('../timeutils');
const { extraStep1 } = require('../wizards');
const { extraDayState } = require('../wizard-state');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('extraday')
    .setDescription('Manage extra raid days')
    .addSubcommand(sub =>
      sub.setName('propose')
        .setDescription('Propose an extra raid day for this week'))
    .addSubcommand(sub =>
      sub.setName('cancel')
        .setDescription('Cancel an active extra day poll (Raid Lead only)')
        .addIntegerOption(opt =>
          opt.setName('poll_id')
            .setDescription('Poll ID to cancel (shown in /extraday list)')
            .setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('Show active extra day polls')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId);

    if (!config) {
      return interaction.reply({ content: 'Run `/setup` first.', flags: 64 });
    }

    if (sub === 'propose') {
      const key = `${guildId}:${interaction.user.id}`;
      extraDayState.set(key, {});
      const step = extraStep1();
      await interaction.reply({ ...step, flags: 64 });
    } else if (sub === 'cancel') {
      await handleCancel(interaction, config);
    } else if (sub === 'list') {
      await handleList(interaction, config);
    }
  },
};

async function handleCancel(interaction, config) {
  const guildId = interaction.guild.id;

  if (!interaction.member.roles.cache.has(config.raid_lead_role_id)) {
    return interaction.reply({ content: 'Only Raid Leads can cancel polls.', flags: 64 });
  }

  const pollId = interaction.options.getInteger('poll_id');

  let poll;
  if (pollId) {
    poll = db.prepare('SELECT * FROM extra_day_polls WHERE id = ? AND guild_id = ? AND closed = 0').get(pollId, guildId);
  } else {
    poll = db.prepare('SELECT * FROM extra_day_polls WHERE guild_id = ? AND closed = 0 ORDER BY id DESC LIMIT 1').get(guildId);
  }

  if (!poll) {
    return interaction.reply({ content: 'No active poll found.', flags: 64 });
  }

  db.prepare('UPDATE extra_day_polls SET closed = 1 WHERE id = ?').run(poll.id);

  try {
    const channel = await interaction.client.channels.fetch(poll.channel_id);
    const msg = await channel.messages.fetch(poll.message_id);
    await msg.edit({ components: [] });
    await channel.send(
      `**Extra Raid Day Poll #${poll.id} Cancelled**\n` +
      `The poll for **${poll.proposed_date}** was cancelled by <@${interaction.user.id}>.`
    );
  } catch (e) {
    console.error('Failed to update cancelled poll message:', e);
  }

  await interaction.reply({ content: `Poll #${poll.id} for **${poll.proposed_date}** has been cancelled.`, flags: 64 });
}

async function handleList(interaction, config) {
  const guildId = interaction.guild.id;
  const polls = db.prepare('SELECT * FROM extra_day_polls WHERE guild_id = ? AND closed = 0').all(guildId);

  if (polls.length === 0) {
    return interaction.reply({ content: 'No active extra day polls.', flags: 64 });
  }

  const lines = polls.map(p => {
    const yes = db.prepare("SELECT COUNT(*) as c FROM extra_day_votes WHERE poll_id = ? AND vote = 'yes'").get(p.id).c;
    const no = db.prepare("SELECT COUNT(*) as c FROM extra_day_votes WHERE poll_id = ? AND vote = 'no'").get(p.id).c;
    const closesTs = Math.floor(new Date(p.closes_at).getTime() / 1000);
    return `- **#${p.id}** — ${p.proposed_date}: ${yes} yes / ${no} no — closes <t:${closesTs}:R>`;
  });

  await interaction.reply(`**Active Extra Day Polls**\n${lines.join('\n')}`);
}
