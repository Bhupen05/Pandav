// Today as YYYY-MM-DD in the browser's local time, the same format as an
// attendance record's `day`. (toISOString() would give the UTC date instead.)
export const todayKey = (): string => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
};
