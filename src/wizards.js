const {
  ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { DateTime } = require('luxon');
const { DAY_NAMES, getNextTimestamp, formatTime } = require('./timeutils');

const TIMEZONE_OPTIONS = [
  { label: 'Eastern (ET)', value: 'America/New_York' },
  { label: 'Central (CT)', value: 'America/Chicago' },
  { label: 'Mountain (MT)', value: 'America/Denver' },
  { label: 'Pacific (PT)', value: 'America/Los_Angeles' },
  { label: 'Alaska (AKT)', value: 'America/Anchorage' },
  { label: 'Hawaii (HT)', value: 'Pacific/Honolulu' },
  { label: 'UTC', value: 'UTC' },
  { label: 'UK (GMT/BST)', value: 'Europe/London' },
  { label: 'Central Europe (CET)', value: 'Europe/Berlin' },
  { label: 'Japan (JST)', value: 'Asia/Tokyo' },
  { label: 'Australia Eastern (AEST)', value: 'Australia/Sydney' },
];

// ── Shared UI builders ──

function tzSelect(customId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder('Select your timezone')
      .addOptions(TIMEZONE_OPTIONS)
  );
}

function dayMultiSelect(customId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder('Select your raid days')
      .setMinValues(1)
      .setMaxValues(7)
      .addOptions(DAY_NAMES.map((name, i) => ({ label: name, value: String(i) })))
  );
}

function dateSelect(customId, timezone) {
  const now = DateTime.now().setZone(timezone);
  const options = [];
  for (let i = 0; i < 7; i++) {
    const day = now.plus({ days: i });
    options.push({
      label: day.toFormat('EEEE, MMM d'),
      value: day.toFormat('yyyy-MM-dd'),
    });
  }
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder('Pick a date')
      .addOptions(options)
  );
}

function hourSelect(customId) {
  const options = [];
  for (let h = 1; h <= 12; h++) {
    options.push({ label: `${h}`, value: String(h) });
  }
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder('Select the hour')
      .addOptions(options)
  );
}

function minuteSelect(customId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder('Select the minutes')
      .addOptions([
        { label: ':00', value: '0' },
        { label: ':15', value: '15' },
        { label: ':30', value: '30' },
        { label: ':45', value: '45' },
      ])
  );
}

function ampmButtons(prefix) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${prefix}_am`).setLabel('AM').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${prefix}_pm`).setLabel('PM').setStyle(ButtonStyle.Primary),
  );
}

function navButtons(prefix, step, { back = true } = {}) {
  const buttons = [];
  if (back) {
    buttons.push(
      new ButtonBuilder().setCustomId(`${prefix}_back_${step}`).setLabel('Back').setStyle(ButtonStyle.Secondary)
    );
  }
  return buttons;
}

function confirmEditButtons(prefix) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${prefix}_confirm`).setLabel('Confirm').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${prefix}_restart`).setLabel('Start Over').setStyle(ButtonStyle.Danger),
  );
}

function pollToggleButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('extra_poll_yes').setLabel('Yes, poll the static').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('extra_poll_no').setLabel('No, just add it').setStyle(ButtonStyle.Secondary),
  );
}

// ── Schedule wizard step renderers ──

function scheduleStep1() {
  return {
    content: '**Schedule Setup (1/4)** — What timezone is your static in?',
    components: [tzSelect('sched_tz')],
  };
}

function scheduleStep2(state) {
  const components = [dayMultiSelect('sched_days')];
  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sched_back_1').setLabel('Back').setStyle(ButtonStyle.Secondary)
  );
  components.push(backRow);
  return {
    content: `**Schedule Setup (2/4)** — Timezone: **${state.timezone}**\n\nWhich days does your static raid?`,
    components,
  };
}

function scheduleStep3(state) {
  const dayList = state.days.map(d => DAY_NAMES[d]).join(', ');
  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sched_back_2').setLabel('Back').setStyle(ButtonStyle.Secondary)
  );
  return {
    content: `**Schedule Setup (3/4)** — Days: **${dayList}**\n\nWhat time does your raid start? Pick the hour.`,
    components: [hourSelect('sched_hour'), backRow],
  };
}

function scheduleStep4(state) {
  const dayList = state.days.map(d => DAY_NAMES[d]).join(', ');
  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sched_back_3').setLabel('Back').setStyle(ButtonStyle.Secondary)
  );
  return {
    content: `**Schedule Setup (4/4)** — Days: **${dayList}**, Hour: **${state.hour}**\n\nSelect minutes, then AM or PM.`,
    components: [minuteSelect('sched_minute'), ampmButtons('sched'), backRow],
  };
}

function scheduleConfirm(state) {
  const dayList = state.days.map(d => DAY_NAMES[d]).join(', ');
  const timeStr = formatTime(state.hour24, state.minute);
  const sampleTs = getNextTimestamp(state.days[0], state.hour24, state.minute, state.timezone);
  return {
    content:
      `**Schedule Setup — Review**\n\n` +
      `**Timezone:** ${state.timezone}\n` +
      `**Days:** ${dayList}\n` +
      `**Time:** ${timeStr} / <t:${sampleTs}:t> (your local time)\n\n` +
      `Does this look right?`,
    components: [confirmEditButtons('sched')],
  };
}

// ── Extra day wizard step renderers ──

function extraStep1() {
  return {
    content: '**Extra Day (1/6)** — What timezone are you in?',
    components: [tzSelect('extra_tz')],
  };
}

function extraStepMode(state) {
  const modeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('extra_mode_multi').setLabel('Propose multiple days').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('extra_mode_single').setLabel('Propose a specific day').setStyle(ButtonStyle.Secondary),
  );
  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('extra_back_1').setLabel('Back').setStyle(ButtonStyle.Secondary)
  );
  return {
    content: `**Extra Day (2/6)** — Timezone: **${state.timezone}**\n\nHow would you like to propose?\n\n**Multiple days** — propose several options, group votes on which day works best. First to 8/8 wins.\n**Specific day** — propose a single date, optionally poll the group.`,
    components: [modeRow, backRow],
  };
}

function extraStepDateSingle(state) {
  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('extra_back_mode').setLabel('Back').setStyle(ButtonStyle.Secondary)
  );
  return {
    content: `**Extra Day (3/6)** — Pick a date.`,
    components: [dateSelect('extra_date', state.timezone), backRow],
  };
}

function extraStepDateMulti(state) {
  const now = DateTime.now().setZone(state.timezone);
  const options = [];
  for (let i = 0; i < 7; i++) {
    const day = now.plus({ days: i });
    options.push({
      label: day.toFormat('EEEE, MMM d'),
      value: day.toFormat('yyyy-MM-dd'),
    });
  }
  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('extra_dates_multi')
      .setPlaceholder('Select one or more days')
      .setMinValues(1)
      .setMaxValues(7)
      .addOptions(options)
  );
  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('extra_back_mode').setLabel('Back').setStyle(ButtonStyle.Secondary)
  );
  return {
    content: `**Extra Day (3/6)** — Pick the days you want to propose. The group will vote on each one.`,
    components: [selectRow, backRow],
  };
}

function extraStepHour(state) {
  const dateLabel = state.mode === 'multi'
    ? state.dates.join(', ')
    : state.date;
  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('extra_back_date').setLabel('Back').setStyle(ButtonStyle.Secondary)
  );
  return {
    content: `**Extra Day (4/6)** — Date(s): **${dateLabel}**\n\nWhat time? Pick the hour.`,
    components: [hourSelect('extra_hour'), backRow],
  };
}

function extraStepTime(state) {
  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('extra_back_hour').setLabel('Back').setStyle(ButtonStyle.Secondary)
  );
  return {
    content: `**Extra Day (5/6)** — Hour: **${state.hour}**\n\nSelect minutes, then AM or PM.`,
    components: [minuteSelect('extra_minute'), ampmButtons('extra'), backRow],
  };
}

function extraStepPoll(state) {
  const timeStr = formatTime(state.hour24, state.minute);
  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('extra_back_time').setLabel('Back').setStyle(ButtonStyle.Secondary)
  );
  return {
    content:
      `**Extra Day (6/6)** — Time: **${timeStr}**\n\n` +
      `Should the static be polled? (All 8 must confirm)`,
    components: [pollToggleButtons(), backRow],
  };
}

function extraConfirm(state) {
  const timeStr = formatTime(state.hour24, state.minute);

  if (state.mode === 'multi') {
    const dateLines = state.dates.map(d => {
      const dow = new Date(d + 'T00:00:00').getUTCDay();
      const ts = getNextTimestamp(dow, state.hour24, state.minute, state.timezone);
      return `- **${DAY_NAMES[dow]}, ${d}** at <t:${ts}:t>`;
    }).join('\n');
    return {
      content:
        `**Extra Day — Review**\n\n` +
        `**Timezone:** ${state.timezone}\n` +
        `**Proposed Days:**\n${dateLines}\n` +
        `**Poll:** Yes — first day to reach 8/8 wins, rest auto-cancel\n\n` +
        `Does this look right?`,
      components: [confirmEditButtons('extra')],
    };
  }

  const dayOfWeek = new Date(state.date + 'T00:00:00').getUTCDay();
  const ts = getNextTimestamp(dayOfWeek, state.hour24, state.minute, state.timezone);
  const pollLabel = state.poll ? 'Yes (8/8 required)' : 'No (just add it)';
  return {
    content:
      `**Extra Day — Review**\n\n` +
      `**Timezone:** ${state.timezone}\n` +
      `**Date:** ${state.date} (${DAY_NAMES[dayOfWeek]})\n` +
      `**Time:** ${timeStr} / <t:${ts}:t> (your local time)\n` +
      `**Poll:** ${pollLabel}\n\n` +
      `Does this look right?`,
    components: [confirmEditButtons('extra')],
  };
}

module.exports = {
  TIMEZONE_OPTIONS,
  scheduleStep1, scheduleStep2, scheduleStep3, scheduleStep4, scheduleConfirm,
  extraStep1, extraStepMode, extraStepDateSingle, extraStepDateMulti,
  extraStepHour, extraStepTime, extraStepPoll, extraConfirm,
};
