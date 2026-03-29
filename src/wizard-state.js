// Shared in-memory state for interactive wizards (keyed by `guildId:userId`)
const scheduleState = new Map();
const extraDayState = new Map();

module.exports = { scheduleState, extraDayState };
