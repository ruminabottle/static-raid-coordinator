const { SlashCommandBuilder } = require('discord.js');
const { DateTime } = require('luxon');
const db = require('../db/database');
const { DAY_NAMES, getNextTimestamp, getNextOccurrence } = require('../timeutils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show who\'s in/out for the next raid'),

  async execute(interaction) {
    const guildId = interaction.guild.id;

    const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId);
    if (!config) {
      return interaction.reply({ content: 'Run `/setup` first.', flags: 64 });
    }

    const schedules = db.prepare('SELECT * FROM raid_schedule WHERE guild_id = ? ORDER BY day_of_week').all(guildId);
    if (schedules.length === 0) {
      return interaction.reply('No raid schedule set.');
    }

    const tz = config.timezone || 'America/New_York';

    // Find the nearest upcoming raid using luxon
    let nearest = null;
    let nearestDt = null;
    for (const s of schedules) {
      const dt = getNextOccurrence(s.day_of_week, s.hour, s.minute, tz);
      if (!nearestDt || dt < nearestDt) {
        nearestDt = dt;
        nearest = s;
      }
    }

    const nextDate = nearestDt.toFormat('yyyy-MM-dd');
    const ts = Math.floor(nearestDt.toSeconds());

    const cancellations = db.prepare(
      'SELECT user_id, reason FROM cancellations WHERE guild_id = ? AND raid_date = ?'
    ).all(guildId, nextDate);

    let msg = `**Next Raid: ${DAY_NAMES[nearest.day_of_week]}, ${nextDate}** at <t:${ts}:t> (<t:${ts}:R>)\n\n`;

    if (cancellations.length === 0) {
      msg += 'Everyone is in! No cancellations.';
    } else {
      msg += `**Cancellations (${cancellations.length}):**\n`;
      for (const c of cancellations) {
        const reason = c.reason ? ` — *${c.reason}*` : '';
        msg += `- <@${c.user_id}>${reason}\n`;
      }
    }

    // Check for active reschedule proposals
    const proposals = db.prepare(
      'SELECT * FROM reschedule_proposals WHERE guild_id = ? AND original_date = ?'
    ).all(guildId, nextDate);

    if (proposals.length > 0) {
      msg += `\n**Reschedule Proposals:**\n`;
      for (const p of proposals) {
        const yes = db.prepare("SELECT COUNT(*) as c FROM reschedule_votes WHERE proposal_id = ? AND vote = 'yes'").get(p.id).c;
        const no = db.prepare("SELECT COUNT(*) as c FROM reschedule_votes WHERE proposal_id = ? AND vote = 'no'").get(p.id).c;
        msg += `- Move to **${p.proposed_date}**: ${yes} yes / ${no} no\n`;
      }
    }

    await interaction.reply(msg);
  },
};
