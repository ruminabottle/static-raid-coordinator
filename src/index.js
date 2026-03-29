const fs = require('node:fs');
const path = require('node:path');
const {
  Client, Collection, GatewayIntentBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const db = require('./db/database');
const { startReminders } = require('./reminders');
const { startPollMonitor } = require('./poll-monitor');
const { DAY_NAMES, getNextTimestamp } = require('./timeutils');
const { scheduleState, extraDayState } = require('./wizard-state');
const wiz = require('./wizards');

require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// Load commands
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  startReminders(client);
  startPollMonitor(client);
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(error);
      const reply = { content: 'Something went wrong running that command.', flags: 64 };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply);
      } else {
        await interaction.reply(reply);
      }
    }
    return;
  }

  if (interaction.isStringSelectMenu() || interaction.isButton()) {
    try {
      await handleComponent(interaction);
    } catch (error) {
      console.error(error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'Something went wrong.', flags: 64 });
      }
    }
  }
});

async function handleComponent(interaction) {
  const id = interaction.customId;
  const key = `${interaction.guild.id}:${interaction.user.id}`;
  const expired = (wizard) => interaction.update({ content: `Session expired. Run \`/${wizard}\` again.`, components: [] });

  // ════════════════════════════════════════
  // SCHEDULE WIZARD
  // ════════════════════════════════════════

  // Step 1: timezone selected → store, show step 2
  if (id === 'sched_tz') {
    const state = scheduleState.get(key) || {};
    state.timezone = interaction.values[0];
    scheduleState.set(key, state);
    await interaction.update(wiz.scheduleStep2(state));
  }

  // Step 2: days selected → store, show step 3
  else if (id === 'sched_days') {
    const state = scheduleState.get(key);
    if (!state) return expired('schedule set');
    state.days = interaction.values.map(Number);
    await interaction.update(wiz.scheduleStep3(state));
  }

  // Step 3: hour selected → store, show step 4
  else if (id === 'sched_hour') {
    const state = scheduleState.get(key);
    if (!state) return expired('schedule set');
    state.hour = parseInt(interaction.values[0]);
    await interaction.update(wiz.scheduleStep4(state));
  }

  // Step 4a: minute selected → store, redraw step 4 (still need AM/PM)
  else if (id === 'sched_minute') {
    const state = scheduleState.get(key);
    if (!state) return expired('schedule set');
    state.minute = parseInt(interaction.values[0]);
    // Redraw step 4 but without the minute dropdown
    const minLabel = String(state.minute).padStart(2, '0');
    const dayList = state.days.map(d => DAY_NAMES[d]).join(', ');
    const ampmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('sched_am').setLabel('AM').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('sched_pm').setLabel('PM').setStyle(ButtonStyle.Primary),
    );
    const backRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('sched_back_3').setLabel('Back').setStyle(ButtonStyle.Secondary)
    );
    await interaction.update({
      content: `**Schedule Setup (4/4)** — Days: **${dayList}**, Hour: **${state.hour}:${minLabel}**\n\nNow pick AM or PM.`,
      components: [ampmRow, backRow],
    });
  }

  // Step 4b: AM/PM selected → compute hour24, show confirm
  else if (id === 'sched_am' || id === 'sched_pm') {
    const state = scheduleState.get(key);
    if (!state) return expired('schedule set');
    if (state.minute === undefined) state.minute = 0;
    const isPM = id === 'sched_pm';
    let hour24 = state.hour;
    if (isPM && hour24 !== 12) hour24 += 12;
    if (!isPM && hour24 === 12) hour24 = 0;
    state.hour24 = hour24;
    state.ampm = isPM ? 'PM' : 'AM';
    await interaction.update(wiz.scheduleConfirm(state));
  }

  // Back buttons for schedule
  else if (id === 'sched_back_1') {
    await interaction.update(wiz.scheduleStep1());
  }
  else if (id === 'sched_back_2') {
    const state = scheduleState.get(key);
    if (!state) return expired('schedule set');
    await interaction.update(wiz.scheduleStep2(state));
  }
  else if (id === 'sched_back_3') {
    const state = scheduleState.get(key);
    if (!state) return expired('schedule set');
    await interaction.update(wiz.scheduleStep3(state));
  }

  // Schedule confirm → save
  else if (id === 'sched_confirm') {
    const state = scheduleState.get(key);
    if (!state) return expired('schedule set');

    const guildId = interaction.guild.id;
    db.prepare('UPDATE guild_config SET timezone = ? WHERE guild_id = ?').run(state.timezone, guildId);
    db.prepare('DELETE FROM raid_schedule WHERE guild_id = ?').run(guildId);
    const insert = db.prepare('INSERT INTO raid_schedule (guild_id, day_of_week, hour, minute) VALUES (?, ?, ?, ?)');
    for (const day of state.days) {
      insert.run(guildId, day, state.hour24, state.minute);
    }

    const dayList = state.days.map(d => DAY_NAMES[d]).join(', ');
    const sampleTs = getNextTimestamp(state.days[0], state.hour24, state.minute, state.timezone);
    scheduleState.delete(key);

    await interaction.update({
      content:
        `**Schedule saved!**\n\n` +
        `**Days:** ${dayList}\n` +
        `**Time:** <t:${sampleTs}:t> (shown in your local time)\n` +
        `**Timezone:** ${state.timezone}\n\n` +
        `Use \`/schedule view\` to review or \`/schedule set\` to change it.`,
      components: [],
    });
  }

  // Schedule start over
  else if (id === 'sched_restart') {
    scheduleState.set(key, {});
    await interaction.update(wiz.scheduleStep1());
  }

  // ════════════════════════════════════════
  // EXTRA DAY WIZARD
  // ════════════════════════════════════════

  // Step 1: timezone selected
  else if (id === 'extra_tz') {
    const state = extraDayState.get(key) || {};
    state.timezone = interaction.values[0];
    extraDayState.set(key, state);
    await interaction.update(wiz.extraStep2(state));
  }

  // Step 2: date selected
  else if (id === 'extra_date') {
    const state = extraDayState.get(key);
    if (!state) return expired('extraday propose');
    state.date = interaction.values[0];
    await interaction.update(wiz.extraStep3(state));
  }

  // Step 3: hour selected
  else if (id === 'extra_hour') {
    const state = extraDayState.get(key);
    if (!state) return expired('extraday propose');
    state.hour = parseInt(interaction.values[0]);
    await interaction.update(wiz.extraStep4(state));
  }

  // Step 4a: minute selected
  else if (id === 'extra_minute') {
    const state = extraDayState.get(key);
    if (!state) return expired('extraday propose');
    state.minute = parseInt(interaction.values[0]);
    const minLabel = String(state.minute).padStart(2, '0');
    const ampmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('extra_am').setLabel('AM').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('extra_pm').setLabel('PM').setStyle(ButtonStyle.Primary),
    );
    const backRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('extra_back_3').setLabel('Back').setStyle(ButtonStyle.Secondary)
    );
    await interaction.update({
      content: `**Extra Day (4/5)** — Date: **${state.date}**, Time: **${state.hour}:${minLabel}**\n\nNow pick AM or PM.`,
      components: [ampmRow, backRow],
    });
  }

  // Step 4b: AM/PM → show poll toggle (step 5)
  else if (id === 'extra_am' || id === 'extra_pm') {
    const state = extraDayState.get(key);
    if (!state) return expired('extraday propose');
    if (state.minute === undefined) state.minute = 0;
    const isPM = id === 'extra_pm';
    let hour24 = state.hour;
    if (isPM && hour24 !== 12) hour24 += 12;
    if (!isPM && hour24 === 12) hour24 = 0;
    state.hour24 = hour24;
    state.ampm = isPM ? 'PM' : 'AM';
    await interaction.update(wiz.extraStep5(state));
  }

  // Step 5: poll toggle
  else if (id === 'extra_poll_yes' || id === 'extra_poll_no') {
    const state = extraDayState.get(key);
    if (!state) return expired('extraday propose');
    state.poll = id === 'extra_poll_yes';
    await interaction.update(wiz.extraConfirm(state));
  }

  // Extra day back buttons
  else if (id === 'extra_back_1') {
    await interaction.update(wiz.extraStep1());
  }
  else if (id === 'extra_back_2') {
    const state = extraDayState.get(key);
    if (!state) return expired('extraday propose');
    await interaction.update(wiz.extraStep2(state));
  }
  else if (id === 'extra_back_3') {
    const state = extraDayState.get(key);
    if (!state) return expired('extraday propose');
    await interaction.update(wiz.extraStep3(state));
  }
  else if (id === 'extra_back_4') {
    const state = extraDayState.get(key);
    if (!state) return expired('extraday propose');
    await interaction.update(wiz.extraStep4(state));
  }

  // Extra day confirm → save
  else if (id === 'extra_confirm') {
    const state = extraDayState.get(key);
    if (!state) return expired('extraday propose');

    const guildId = interaction.guild.id;
    const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId);
    const dateStr = state.date;
    const dayOfWeek = new Date(dateStr + 'T00:00:00').getUTCDay();
    const ts = getNextTimestamp(dayOfWeek, state.hour24, state.minute, state.timezone);

    if (!state.poll) {
      db.prepare(`
        INSERT INTO extra_day_polls (guild_id, proposed_by, proposed_date, hour, minute, poll_enabled, confirmed)
        VALUES (?, ?, ?, ?, ?, 0, 1)
      `).run(guildId, interaction.user.id, dateStr, state.hour24, state.minute);

      const channel = await interaction.client.channels.fetch(config.reminder_channel_id);
      if (channel) {
        await channel.send(
          `**Extra Raid Day Added**\n` +
          `<@${interaction.user.id}> has added an extra raid on:\n` +
          `**${DAY_NAMES[dayOfWeek]}, ${dateStr}** at <t:${ts}:t>`
        );
      }

      extraDayState.delete(key);
      await interaction.update({
        content: `**Extra day added for ${dateStr}** at <t:${ts}:t>!`,
        components: [],
      });
    } else {
      const now = new Date();
      const closesAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

      const result = db.prepare(`
        INSERT INTO extra_day_polls (guild_id, proposed_by, proposed_date, hour, minute, poll_enabled, closes_at)
        VALUES (?, ?, ?, ?, ?, 1, ?)
      `).run(guildId, interaction.user.id, dateStr, state.hour24, state.minute, closesAt);

      const pollId = result.lastInsertRowid;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`extra_yes_${pollId}`)
          .setLabel('I can make it')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`extra_no_${pollId}`)
          .setLabel("Can't make it")
          .setStyle(ButtonStyle.Danger),
      );

      const staticRoleId = config.static_member_role_id;
      const channel = await interaction.client.channels.fetch(config.reminder_channel_id);
      const msg = await channel.send({
        content:
          `**Extra Raid Day — Vote Required** (Poll #${pollId})\n` +
          `<@${interaction.user.id}> is proposing an extra raid on:\n` +
          `**${DAY_NAMES[dayOfWeek]}, ${dateStr}** at <t:${ts}:t>\n\n` +
          `All 8 <@&${staticRoleId}> members must vote. Need **8 yes** votes to confirm.\n` +
          `Poll closes <t:${Math.floor(new Date(closesAt).getTime() / 1000)}:R>.\n\n` +
          `**Votes: 1/8 yes, 0 no (1/8 voted)**`,
        components: [row],
      });

      db.prepare('UPDATE extra_day_polls SET message_id = ?, channel_id = ? WHERE id = ?')
        .run(msg.id, channel.id, pollId);

      db.prepare(`
        INSERT INTO extra_day_votes (poll_id, user_id, vote) VALUES (?, ?, 'yes')
      `).run(pollId, interaction.user.id);

      extraDayState.delete(key);
      await interaction.update({
        content: `**Extra day poll #${pollId} posted.** Your vote has been counted as yes.`,
        components: [],
      });
    }
  }

  // Extra day start over
  else if (id === 'extra_restart') {
    extraDayState.set(key, {});
    await interaction.update(wiz.extraStep1());
  }

  // ════════════════════════════════════════
  // VOTE HANDLERS
  // ════════════════════════════════════════

  // Extra day poll votes
  else if (id.startsWith('extra_yes_') || id.startsWith('extra_no_')) {
    const vote = id.includes('_yes_') ? 'yes' : 'no';
    const pollId = parseInt(id.split('_').pop());

    const poll = db.prepare('SELECT * FROM extra_day_polls WHERE id = ?').get(pollId);
    if (!poll || poll.closed) {
      return interaction.reply({ content: 'This poll is closed.', flags: 64 });
    }

    const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(interaction.guild.id);
    if (!interaction.member.roles.cache.has(config.static_member_role_id)) {
      return interaction.reply({ content: 'Only Static Members can vote on this poll.', flags: 64 });
    }

    db.prepare(`
      INSERT INTO extra_day_votes (poll_id, user_id, vote) VALUES (?, ?, ?)
      ON CONFLICT(poll_id, user_id) DO UPDATE SET vote = excluded.vote
    `).run(pollId, interaction.user.id, vote);

    const yes = db.prepare("SELECT COUNT(*) as c FROM extra_day_votes WHERE poll_id = ? AND vote = 'yes'").get(pollId).c;
    const no = db.prepare("SELECT COUNT(*) as c FROM extra_day_votes WHERE poll_id = ? AND vote = 'no'").get(pollId).c;
    const total = yes + no;

    // Update poll message tally
    try {
      const channel = await interaction.client.channels.fetch(poll.channel_id);
      const msg = await channel.messages.fetch(poll.message_id);
      const updatedContent = msg.content.replace(/\*\*Votes:.*\*\*/, `**Votes: ${yes}/8 yes, ${no} no (${total}/8 voted)**`);
      await msg.edit({ content: updatedContent, components: msg.components });
    } catch (e) {
      console.error('Failed to update poll message:', e);
    }

    // Close if all 8 voted
    if (total >= 8) {
      const tz = config.timezone || 'America/New_York';
      const ts = getNextTimestamp(new Date(poll.proposed_date + 'T00:00:00').getUTCDay(), poll.hour, poll.minute, tz);

      if (yes >= 8) {
        db.prepare('UPDATE extra_day_polls SET confirmed = 1, closed = 1 WHERE id = ?').run(pollId);
        try {
          const channel = await interaction.client.channels.fetch(poll.channel_id);
          await channel.send(`**Extra Raid Day Confirmed!**\nAll 8 members confirmed. See you on **${poll.proposed_date}** at <t:${ts}:t>!`);
          const msg = await channel.messages.fetch(poll.message_id);
          await msg.edit({ components: [] });
        } catch (e) { console.error(e); }
      } else {
        db.prepare('UPDATE extra_day_polls SET closed = 1 WHERE id = ?').run(pollId);
        try {
          const channel = await interaction.client.channels.fetch(poll.channel_id);
          await channel.send(`**Extra Raid Day Not Confirmed**\nAll 8 voted for **${poll.proposed_date}**: **${yes}** yes / **${no}** no. Needed 8/8 yes.`);
          const msg = await channel.messages.fetch(poll.message_id);
          await msg.edit({ components: [] });
        } catch (e) { console.error(e); }
      }
    }

    await interaction.reply({
      content: `Vote recorded as **${vote}**! Current tally: **${yes}** yes / **${no}** no (${total}/8 voted)`,
      flags: 64,
    });
  }
}

client.login(process.env.DISCORD_TOKEN);
