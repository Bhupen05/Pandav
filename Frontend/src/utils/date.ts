const pad = (value: number) => String(value).padStart(2, '0');

// A Date as YYYY-MM-DD in the browser's local time (toISOString() would give
// the UTC date instead)
export const dayKeyOf = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

// Today as YYYY-MM-DD in the browser's local time, the same format as an
// attendance record's `day`
export const todayKey = (): string => dayKeyOf(new Date());

// A YYYY-MM-DD day as a local Date at midnight (new Date('2026-10-16') would
// be midnight UTC, which is the day before west of Greenwich)
export const parseDay = (day: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || '');
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
};

// The day `days` after (or before) a YYYY-MM-DD day
export const addDays = (day: string, days: number): string => {
  const date = parseDay(day) ?? new Date();
  date.setDate(date.getDate() + days);
  return dayKeyOf(date);
};

// ISO weekday of a YYYY-MM-DD day: 1 is Monday, 7 is Sunday
export const isoWeekday = (day: string): number => {
  const date = parseDay(day);
  if (!date) return 0;
  return date.getDay() === 0 ? 7 : date.getDay();
};

// "Fri, 16 Oct 2026"
export const formatDay = (day?: string | null, { weekday = true, year = true } = {}): string => {
  const date = day ? parseDay(day.slice(0, 10)) : null;
  if (!date) return '—';
  return date.toLocaleDateString(undefined, {
    ...(weekday ? { weekday: 'short' as const } : {}),
    day: 'numeric',
    month: 'short',
    ...(year ? { year: 'numeric' as const } : {}),
  });
};

// "Fri, 16 Oct – Mon, 19 Oct 2026", or one day
export const formatDayRange = (start: string, end?: string | null): string => {
  if (!end || end === start) return formatDay(start);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${formatDay(start, { year: !sameYear })} – ${formatDay(end)}`;
};

// A time of day without seconds, in the browser's time zone: "09:42"
export const formatTime = (iso?: string | null): string => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

// Date and time without seconds: "16 Oct 2026, 09:42"
export const formatDateTime = (iso?: string | null): string => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// "October 2026" for a YYYY-MM month
export const formatMonth = (month: string): string => {
  const date = parseDay(`${month}-01`);
  return date ? date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : month;
};

// An ISO timestamp as the value of an <input type="datetime-local">
export const toDateTimeInput = (iso?: string | null): string => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${dayKeyOf(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

// The value of an <input type="datetime-local"> (local time) as ISO, or null
export const fromDateTimeInput = (value: string): string | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

// Hours as people read them: "8.5 hrs", "1 hr", "0 hrs"
export const formatHours = (hours?: number | null): string => {
  const value = Math.round((hours || 0) * 100) / 100;
  return `${value} ${value === 1 ? 'hr' : 'hrs'}`;
};

// ─── Times in the server's time zone ─────────────────────────────────────────
// The server counts attendance days in APP_TIMEZONE (GET /attendance/settings
// returns it as `timezone`), not in the browser's zone. These helpers read and
// write times as that zone's wall clock, with Intl only.

// The browser's own zone, for when the server's isn't known
export const browserTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

type Clock = { year: number; month: number; day: number; hour: number; minute: number; second: number };

// What the wall clock in `timeZone` shows at a moment
const clockIn = (date: Date, timeZone: string): Clock => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: read('year'), month: read('month'), day: read('day'), hour: read('hour'), minute: read('minute'), second: read('second') };
};

// How far the zone's clock is ahead of UTC at a moment, in milliseconds
const offsetAt = (date: Date, timeZone: string): number => {
  const clock = clockIn(date, timeZone);
  const shown = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second);
  return shown - Math.floor(date.getTime() / 1000) * 1000;
};

// The calendar day (YYYY-MM-DD) it is in `timeZone` at a moment (now by default)
export const dayKeyIn = (timeZone: string, date: Date = new Date()): string => {
  const clock = clockIn(date, timeZone);
  return `${clock.year}-${pad(clock.month)}-${pad(clock.day)}`;
};

// An ISO timestamp as the value of an <input type="datetime-local">, showing
// the wall clock in `timeZone` ("2026-10-16T09:42")
export const toZonedInput = (iso: string | null | undefined, timeZone: string): string => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const clock = clockIn(date, timeZone);
  return `${clock.year}-${pad(clock.month)}-${pad(clock.day)}T${pad(clock.hour)}:${pad(clock.minute)}`;
};

// What an <input type="datetime-local"> holds, read as the wall clock in
// `timeZone`, as a UTC ISO timestamp. null for an empty or invalid value, and
// for a time the clocks skip when they go forward (it never happens that day).
// When the clocks go back and the time happens twice, the first one is used.
export const fromZonedInput = (value: string, timeZone: string): string | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value || '');
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part || 0));
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);

  // Where the zone is a day before and a day after, it has one offset on each
  // side of any clock change that day: the typed time is one of two instants
  const dayMs = 24 * 3600 * 1000;
  const offsets = new Set([offsetAt(new Date(wall - dayMs), timeZone), offsetAt(new Date(wall + dayMs), timeZone)]);
  const instants = [...offsets]
    .map((offset) => wall - offset)
    // Reading an instant back must give the typed time: a skipped time (or 31 February) doesn't
    .filter((instant) => toZonedInput(new Date(instant).toISOString(), timeZone) === value.slice(0, 16))
    .sort((a, b) => a - b);
  return instants.length > 0 ? new Date(instants[0]).toISOString() : null;
};
