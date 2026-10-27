// ─────────────────────────────────────────────────────────────
// Timezone helpers.
//
// Every organization has an IANA timezone. The "service date" of a token
// and the open/closed state are computed in that timezone using the
// built-in Intl API, so no extra dependency is needed.
// ─────────────────────────────────────────────────────────────

const formatterCache = new Map();

function formatterFor(timeZone) {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

// Wall-clock parts of `date` in `timeZone`.
export function zonedParts(date, timeZone) {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAYS[parts.weekday],
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

// "YYYY-MM-DD" service date for `date` in `timeZone`.
export function serviceDateString(date, timeZone) {
  return zonedParts(date, timeZone).date;
}

// Prisma stores @db.Date values as midnight UTC Date objects.
export function dateStringToDb(dateString) {
  return new Date(`${dateString}T00:00:00.000Z`);
}

export function dbDateToString(value) {
  return value.toISOString().slice(0, 10);
}

export function addDays(dateString, days) {
  const d = dateStringToDb(dateString);
  d.setUTCDate(d.getUTCDate() + days);
  return dbDateToString(d);
}

export function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Default weekly hours: Monday–Saturday 09:00–17:00, closed Sunday.
export function defaultWeeklyHours() {
  return Array.from({ length: 7 }, (_, day) => ({
    closed: day === 0,
    open: '09:00',
    close: '17:00',
  }));
}

// Open/closed state of an organization at `now`.
export function openState(weeklyHours, timeZone, now = new Date()) {
  const { weekday, minutes, date } = zonedParts(now, timeZone);
  const today = weeklyHours?.[weekday];
  const base = { serviceDate: date, today: today || null };
  if (!today || today.closed) return { ...base, isOpen: false, reason: 'CLOSED_TODAY' };
  const open = timeToMinutes(today.open);
  const close = timeToMinutes(today.close);
  if (minutes < open) return { ...base, isOpen: false, reason: 'NOT_YET_OPEN' };
  if (minutes >= close) return { ...base, isOpen: false, reason: 'CLOSED_FOR_DAY' };
  return { ...base, isOpen: true, reason: null };
}

// True once the service day `serviceDate` is over for this organization
// (a later date has begun, or today's closing time has passed / today is closed).
export function isServiceDayOver(serviceDate, weeklyHours, timeZone, now = new Date()) {
  const { date, weekday, minutes } = zonedParts(now, timeZone);
  if (serviceDate < date) return true;
  if (serviceDate > date) return false;
  const today = weeklyHours?.[weekday];
  if (!today || today.closed) return true;
  return minutes >= timeToMinutes(today.close);
}
