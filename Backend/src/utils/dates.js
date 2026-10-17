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
  if (typeof value === 'string' && DATE_ONLY.test(value)) return value;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
};
