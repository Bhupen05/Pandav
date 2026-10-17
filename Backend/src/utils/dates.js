// Attendance days follow one timezone for the whole team (APP_TIMEZONE), not
// the server's clock: Render runs in UTC, where "midnight" is 5:30 AM in India.
const DEFAULT_TIMEZONE = 'Asia/Kolkata';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// Read lazily: dotenv loads after ES module imports are evaluated
const timezone = () => process.env.APP_TIMEZONE || DEFAULT_TIMEZONE;

// 'YYYY-MM-DD' for the calendar day `value` falls on in the app timezone.
// Date-only strings from <input type="date"> are already a day and pass through.
// Returns null for anything that isn't a valid date.
export const toDayKey = (value = new Date()) => {
  if (typeof value === 'string' && DATE_ONLY.test(value)) {
    // A day that exists in the calendar (not 2026-02-31)
    const day = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(day.getTime()) && day.toISOString().startsWith(value) ? value : null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
};

// A filter on `day` between two dates, both inclusive (either may be left
// out), or { error } naming the parameter that isn't a date
export const dayRange = (startDate, endDate) => {
  const range = {};
  for (const [name, value, operator] of [['startDate', startDate, '$gte'], ['endDate', endDate, '$lte']]) {
    if (!value) continue;
    const day = toDayKey(value);
    if (!day) return { error: `Invalid ${name}` };
    range[operator] = day;
  }
  return { range };
};
