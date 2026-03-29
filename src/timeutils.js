const { DateTime } = require('luxon');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Luxon uses ISO weekdays (1=Mon, 7=Sun), JS uses 0=Sun, 6=Sat
function jsToLuxonDay(jsDay) {
  return jsDay === 0 ? 7 : jsDay;
}

// Get a luxon DateTime for the next occurrence of a given local day/time in a timezone
function getNextOccurrence(jsDay, hour, minute, timezone) {
  const luxonDay = jsToLuxonDay(jsDay);
  const now = DateTime.now().setZone(timezone);
  let target = now.set({ hour, minute, second: 0, millisecond: 0 });

  // Adjust to the correct weekday
  const diff = luxonDay - now.weekday;
  if (diff > 0) {
    target = target.plus({ days: diff });
  } else if (diff < 0) {
    target = target.plus({ days: 7 + diff });
  } else {
    // Same day — if already past, go to next week
    if (target <= now) {
      target = target.plus({ weeks: 1 });
    }
  }

  return target;
}

// Get a Unix timestamp for Discord's <t:> format
function getNextTimestamp(jsDay, hour, minute, timezone) {
  const dt = getNextOccurrence(jsDay, hour, minute, timezone);
  return Math.floor(dt.toSeconds());
}

function formatTime(hour, minute) {
  const period = hour >= 12 ? 'PM' : 'AM';
  const h = hour % 12 || 12;
  const m = String(minute).padStart(2, '0');
  return `${h}:${m} ${period}`;
}

module.exports = { DAY_NAMES, getNextOccurrence, getNextTimestamp, formatTime };
