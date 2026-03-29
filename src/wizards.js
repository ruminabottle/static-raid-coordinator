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
    content: '**Extra Day (1/5)** — What timezone are you in?',
    components: [tzSelect('extra_tz')],
  };
}

function extraStep2(state) {
  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('extra_back_1').setLabel('Back').setStyle(ButtonStyle.Secondary)
  );
  return {
    content: `**Extra Day (2/5)** — Timezone: **${state.timezone}**\n\nWhich day?`,
    components: [dateSelect('extra_date', state.timezone), backRow],
  };
}

function extraStep3(state) {
  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('extra_back_2').setLabel('Back').setStyle(ButtonStyle.Secondary)
  );
  return {
    content: `**Extra Day (3/5)** — Date: **${state.date}**\n\nWhat time? Pick the hour.`,
    components: [hourSelect('extra_hour'), backRow],
  };
}

function extraStep4(state) {
  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('extra_back_3').setLabel('Back').setStyle(ButtonStyle.Secondary)
  );
  return {
    content: `**Extra Day (4/5)** — Date: **${state.date}**, Hour: **${state.hour}**\n\nSelect minutes, then AM or PM.`,
    components: [minuteSelect('extra_minute'), ampmButtons('extra'), backRow],
  };
}

function extraStep5(state) {
  const timeStr = formatTime(state.hour24, state.minute);
  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('extra_back_4').setLabel('Back').setStyle(ButtonStyle.Secondary)
  );
  return {
    content:
      `**Extra Day (5/5)** — **${state.date}** at **${timeStr}**\n\n` +
      `Should the static be polled? (All 8 must confirm)`,
    components: [pollToggleButtons(), backRow],
  };
}

function extraConfirm(state) {
  const timeStr = formatTime(state.hour24, state.minute);
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
  extraStep1, extraStep2, extraStep3, extraStep4, extraStep5, extraConfirm,
};
