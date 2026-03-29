const { SlashCommandBuilder } = require('discord.js');
const { DateTime } = require('luxon');
const db = require('../db/database');
const { DAY_NAMES, getNextTimestamp } = require('../timeutils');
const { scheduleStep1 } = require('../wizards');
const { scheduleState } = require('../wizard-state');

const DAY_CHOICES = DAY_NAMES.map((name, i) => ({ name, value: i }));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Manage the raid schedule')
    .addSubcommand(sub =>
      sub.setName('set')
        .setDescription('Interactive schedule setup (Raid Lead only)'))
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove a raid day (Raid Lead only)')
        .addIntegerOption(opt =>
          opt.setName('day')
            .setDescription('Day to remove')
            .setRequired(true)
            .addChoices(...DAY_CHOICES)))
    .addSubcommand(sub =>
      sub.setName('view')
        .setDescription('View the current raid schedule')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'set' || sub === 'remove') {
      const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId);
      if (!config) {
        return interaction.reply({ content: 'Run `/setup` first.', flags: 64 });
      }
      const hasRole = interaction.member.roles.cache.has(config.raid_lead_role_id);
      if (!hasRole) {
        return interaction.reply({ content: 'Only Raid Leads can modify the schedule.', flags: 64 });
      }
    }

    if (sub === 'set') {
      const key = `${guildId}:${interaction.user.id}`;
      scheduleState.set(key, {});
      const step = scheduleStep1();
      await interaction.reply({ ...step, flags: 64 });
    } else if (sub === 'remove') {
      const day = interaction.options.getInteger('day');
      const result = db.prepare('DELETE FROM raid_schedule WHERE guild_id = ? AND day_of_week = ?').run(guildId, day);

      if (result.changes === 0) {
        return interaction.reply({ content: `No raid was scheduled on ${DAY_NAMES[day]}.`, flags: 64 });
      }
      await interaction.reply(`Removed **${DAY_NAMES[day]}** from the raid schedule.`);
    } else if (sub === 'view') {
      const schedules = db.prepare('SELECT * FROM raid_schedule WHERE guild_id = ? ORDER BY day_of_week').all(guildId);

      if (schedules.length === 0) {
        return interaction.reply('No raid days scheduled yet. Use `/schedule set` to add days.');
      }

      const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId);
      const tz = config?.timezone || 'America/New_York';
      const now = DateTime.now().setZone(tz);

      const lines = schedules.map(s => {
        const ts = getNextTimestamp(s.day_of_week, s.hour, s.minute, tz);
        return `- **${DAY_NAMES[s.day_of_week]}** at <t:${ts}:t> (<t:${ts}:R>)`;
      });

      let msg = `**Raid Schedule**\n${lines.join('\n')}`;

      const extraDays = db.prepare(
        'SELECT * FROM extra_day_polls WHERE guild_id = ? AND confirmed = 1 ORDER BY proposed_date'
      ).all(guildId);

      const upcomingExtras = extraDays.filter(e => {
        const extraTime = DateTime.fromISO(e.proposed_date, { zone: tz })
          .set({ hour: e.hour, minute: e.minute });
        return extraTime > now;
      });

      const pastExtras = extraDays.filter(e => {
        const extraTime = DateTime.fromISO(e.proposed_date, { zone: tz })
          .set({ hour: e.hour, minute: e.minute });
        return extraTime <= now;
      });
      for (const past of pastExtras) {
        db.prepare('UPDATE extra_day_polls SET closed = 1 WHERE id = ?').run(past.id);
      }

      if (upcomingExtras.length > 0) {
        const extraLines = upcomingExtras.map(e => {
          const dayOfWeek = new Date(e.proposed_date + 'T00:00:00').getUTCDay();
          const ts = getNextTimestamp(dayOfWeek, e.hour, e.minute, tz);
          return `- **${DAY_NAMES[dayOfWeek]}, ${e.proposed_date}** at <t:${ts}:t> (<t:${ts}:R>)`;
        });
        msg += `\n\n**Upcoming Extra Days**\n${extraLines.join('\n')}`;
      }

      await interaction.reply(msg);
    }
  },
};
