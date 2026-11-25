import { isLessonId } from './lessons.js';

export const MAX_APPOINTMENTS = 500;
export const MAX_SCHEDULE_DAYS = 92;
export const MAX_OCCURRENCE_CHANGES = 256;
const DAY = 86400000;
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const formatters = new Map();
export const isScheduleDate = value => {
  if (typeof value !== 'string' || !/^20\d\d-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
};
export const isScheduleTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export const addScheduleDays = (date, amount) => new Date(Date.parse(`${date}T00:00:00Z`) + amount * DAY).toISOString().slice(0, 10);
export function scheduleTimeZone(value) {
  if (typeof value !== 'string' || value.length > 100) fail('Choose a valid time zone.');
  try { return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone; }
  catch { fail('Choose a valid time zone.'); }
}
export function scheduleLocalParts(instant, timeZone) {
  if (!formatters.has(timeZone)) {
    if (formatters.size > 64) formatters.clear();
    formatters.set(timeZone, new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  }
  const parts = Object.fromEntries(formatters.get(timeZone).formatToParts(new Date(instant)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
const wallNumber = ({ date, time }) => Date.parse(`${date}T${time}:00Z`);
// Resolve using the zone's offsets on both sides of the requested date. A fold
// chooses its first occurrence; a recurring spring gap moves forward by the gap.
export function scheduleInstant(localDate, localTime, timeZone, { allowGap = false } = {}) {
  if (!isScheduleDate(localDate) || !isScheduleTime(localTime)) fail('Choose a valid lesson date and time.');
  const zone = scheduleTimeZone(timeZone), wanted = wallNumber({ date: localDate, time: localTime }), offsets = new Set();
  for (let hours = -36; hours <= 36; hours += 6) {
    const probe = wanted + hours * 3600000;
    offsets.add(wallNumber(scheduleLocalParts(probe, zone)) - probe);
  }
  const candidates = [...offsets].map(offset => wanted - offset).sort((a, b) => a - b);
  const exact = candidates.filter(time => wallNumber(scheduleLocalParts(time, zone)) === wanted);
  if (exact.length) return { instant: new Date(exact[0]).toISOString(), adjusted: false, ambiguous: exact.length > 1 };
  if (!allowGap) fail('That time does not exist when the clocks change. Choose another time.');
  const later = candidates.map(time => ({ time, difference: wallNumber(scheduleLocalParts(time, zone)) - wanted })).filter(item => item.difference > 0 && item.difference <= DAY).sort((a, b) => a.difference - b.difference)[0];
  if (!later) fail('That lesson time could not be resolved. Choose another time.');
  return { instant: new Date(later.time).toISOString(), adjusted: true, ambiguous: false };
}
export function cleanAppointment(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Enter your lesson details.');
  if (typeof input.studentName !== 'string' || !input.studentName.trim() || input.studentName.trim().length > 100) fail('Enter a student name of up to 100 characters.');
  const timeZone = scheduleTimeZone(input.timeZone);
  scheduleInstant(input.localDate, input.localTime, timeZone);
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 5 || input.durationMinutes > 480) fail('Choose a duration between 5 minutes and 8 hours.');
  if (!['none', 'weekly'].includes(input.repeat)) fail('Choose once or every week.');
  const untilDate = input.repeat === 'weekly' ? input.untilDate || null : null;
  if (untilDate !== null && (!isScheduleDate(untilDate) || untilDate < input.localDate)) fail('The repeat end date must be on or after the first lesson.');
  const lessonId = input.lessonId || null;
  if (lessonId !== null && !isLessonId(lessonId)) fail('Choose one of your saved lessons.');
  return { studentName: input.studentName.trim(), localDate: input.localDate, localTime: input.localTime, timeZone, durationMinutes: input.durationMinutes, repeat: input.repeat, untilDate, lessonId };
}
export function cleanScheduleRange(input) {
  if (!isScheduleDate(input?.from) || !isScheduleDate(input?.to) || input.from > input.to || (Date.parse(input.to) - Date.parse(input.from)) / DAY >= MAX_SCHEDULE_DAYS) fail(`Choose a calendar range of up to ${MAX_SCHEDULE_DAYS} days.`);
  return { from: input.from, to: input.to, timeZone: scheduleTimeZone(input.timeZone) };
}
export const occurrenceId = (seriesId, date) => `${seriesId}~${date}`;
export function parseOccurrenceId(id) {
  if (typeof id !== 'string') return null;
  const parts = id.split('~');
  if (parts.length !== 2) return null;
  const [seriesId, date] = parts;
  return isLessonId(seriesId) && isScheduleDate(date) ? { seriesId, date } : null;
}
export function belongsToAppointment(appointment, date) {
  if (!isScheduleDate(date) || date < appointment.localDate || appointment.untilDate && date > appointment.untilDate) return false;
  const days = (Date.parse(date) - Date.parse(appointment.localDate)) / DAY;
  return appointment.repeat === 'weekly' ? days % 7 === 0 : days === 0;
}
export function makeOccurrence(appointment, originalDate, displayZone = appointment.timeZone) {
  if (appointment.cancelled || !belongsToAppointment(appointment, originalDate)) return null;
  const exception = (appointment.exceptions || []).find(item => item.date === originalDate);
  if (exception?.cancelled) return null;
  const localDate = exception?.localDate || originalDate, localTime = exception?.localTime || appointment.localTime;
  const durationMinutes = exception?.durationMinutes || appointment.durationMinutes;
  const resolved = scheduleInstant(localDate, localTime, appointment.timeZone, { allowGap: true });
  const display = scheduleLocalParts(resolved.instant, displayZone);
  const actual = scheduleLocalParts(resolved.instant, appointment.timeZone);
  return {
    id: occurrenceId(appointment.id || appointment._id, originalDate), seriesId: appointment.id || appointment._id, occurrenceDate: originalDate,
    studentName: appointment.studentName, startsAt: resolved.instant, endsAt: new Date(Date.parse(resolved.instant) + durationMinutes * 60000).toISOString(),
    localDate: actual.date, localTime: actual.time, displayDate: display.date, displayTime: display.time,
    durationMinutes, timeZone: appointment.timeZone, lessonId: appointment.lessonId, repeat: appointment.repeat, revision: appointment.revision,
    rescheduled: Boolean(exception), warning: resolved.adjusted ? 'Moved forward for the daylight saving time change.' : resolved.ambiguous ? 'The clocks repeat this time. This lesson uses the first occurrence.' : null,
  };
}
export function expandAppointments(appointments, query) {
  const range = cleanScheduleRange(query), occurrences = [];
  for (const appointment of appointments) {
    if (appointment.cancelled) continue;
    const dates = new Set((appointment.exceptions || []).map(item => item.date));
    const first = addScheduleDays(range.from, -2), last = addScheduleDays(range.to, 2);
    if (appointment.repeat === 'weekly') {
      const start = Math.max(0, Math.ceil((Date.parse(first) - Date.parse(appointment.localDate)) / (7 * DAY)));
      for (let date = addScheduleDays(appointment.localDate, start * 7); date <= last && (!appointment.untilDate || date <= appointment.untilDate); date = addScheduleDays(date, 7)) dates.add(date);
    } else dates.add(appointment.localDate);
    for (const date of dates) {
      const occurrence = makeOccurrence(appointment, date, range.timeZone);
      if (occurrence && occurrence.displayDate >= range.from && occurrence.displayDate <= range.to) occurrences.push(occurrence);
    }
  }
  return occurrences.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
}
export function scheduleWeek(date) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addScheduleDays(date, -((weekday + 6) % 7));
}
