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
