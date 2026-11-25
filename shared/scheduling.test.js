import { describe, expect, it } from 'vitest';
import { addScheduleDays, cleanAppointment, cleanScheduleRange, expandAppointments, makeOccurrence, parseOccurrenceId, scheduleInstant, scheduleLocalParts, scheduleWeek } from './scheduling.js';

const lesson = (changes = {}) => ({ id: 'lesson-a', studentName: 'Casey', localDate: '2026-03-01', localTime: '09:00', timeZone: 'America/Chicago', durationMinutes: 45, repeat: 'weekly', untilDate: null, lessonId: null, revision: 1, exceptions: [], cancelled: false, ...changes });
const range = (from = '2026-03-01', to = '2026-03-22', timeZone = 'America/Chicago') => ({ from, to, timeZone });

describe('scheduled lesson local times', () => {
  it('keeps a weekly wall-clock time across daylight saving changes', () => {
    const items = expandAppointments([lesson()], range());
    expect(items.map(item => item.startsAt)).toEqual(['2026-03-01T15:00:00.000Z', '2026-03-08T14:00:00.000Z', '2026-03-15T14:00:00.000Z', '2026-03-22T14:00:00.000Z']);
    expect(items.map(item => item.localTime)).toEqual(['09:00', '09:00', '09:00', '09:00']);
  });
  it('rejects a nonexistent explicitly selected time, and visibly adjusts a later recurring gap', () => {
    expect(() => scheduleInstant('2026-03-08', '02:30', 'America/Chicago')).toThrow(/does not exist/);
    const items = expandAppointments([lesson({ localTime: '02:30' })], range('2026-03-08', '2026-03-08'));
    expect(items).toHaveLength(1); expect(items[0].startsAt).toBe('2026-03-08T08:30:00.000Z');
    expect(items[0].localTime).toBe('03:30'); expect(items[0].warning).toMatch(/Moved forward/);
  });
  it('chooses the first instance of an ambiguous time and describes that choice', () => {
    expect(scheduleInstant('2026-11-01', '01:30', 'America/Chicago')).toMatchObject({ instant: '2026-11-01T06:30:00.000Z', ambiguous: true });
    expect(makeOccurrence(lesson({ localDate: '2026-11-01', localTime: '01:30' }), '2026-11-01').warning).toMatch(/first occurrence/);
  });
  it('handles half-hour offsets, half-hour DST gaps and date-line display changes', () => {
    expect(scheduleInstant('2026-11-24', '09:00', 'Asia/Kolkata').instant).toBe('2026-11-24T03:30:00.000Z');
    expect(scheduleInstant('2026-10-04', '02:15', 'Australia/Lord_Howe', { allowGap: true })).toMatchObject({ instant: '2026-10-03T15:45:00.000Z', adjusted: true });
    const items = expandAppointments([lesson({ localDate: '2026-11-24', localTime: '23:30', timeZone: 'Pacific/Honolulu', repeat: 'none' })], range('2026-11-25', '2026-11-25', 'Pacific/Auckland'));
    expect(items).toHaveLength(1); expect(items[0].displayDate).toBe('2026-11-25'); expect(items[0].displayTime).toBe('22:30');
  });
  it('selects a Monday week across month and year boundaries', () => {
    expect(scheduleWeek('2027-01-01')).toBe('2026-12-28'); expect(addScheduleDays('2026-12-28', 6)).toBe('2027-01-03');
    expect(scheduleLocalParts('2026-11-24T00:00:00Z', 'America/Chicago')).toEqual({ date: '2026-11-23', time: '18:00' });
  });
});

describe('bounded recurrence and stable occurrence identity', () => {
  it('includes a rescheduled occurrence even when its original date is outside the displayed week', () => {
    const items = expandAppointments([lesson({ exceptions: [{ date: '2026-03-01', localDate: '2026-04-07', localTime: '15:00', durationMinutes: 60 }] })], range('2026-04-06', '2026-04-12'));
    const moved = items.find(item => item.rescheduled);
    expect(moved).toMatchObject({ id: 'lesson-a~2026-03-01', occurrenceDate: '2026-03-01', localDate: '2026-04-07', localTime: '15:00', durationMinutes: 60 });
    expect(parseOccurrenceId(moved.id)).toEqual({ seriesId: 'lesson-a', date: '2026-03-01' });
  });
  it('omits only cancelled occurrences and ends recurring lessons inclusively', () => {
    const items = expandAppointments([lesson({ untilDate: '2026-03-15', exceptions: [{ date: '2026-03-08', cancelled: true }] })], range());
    expect(items.map(item => item.occurrenceDate)).toEqual(['2026-03-01', '2026-03-15']);
    expect(expandAppointments([lesson({ cancelled: true })], range())).toEqual([]);
  });
  it('rejects invalid dates, range lengths, time zones, duration and lesson identities', () => {
    for (const change of [{ localDate: '2026-02-30' }, { localTime: '24:00' }, { timeZone: 'made/up' }, { repeat: 'daily' }, { durationMinutes: 0 }, { durationMinutes: 90.5 }, { untilDate: '2026-02-01' }, { lessonId: '../private' }, { studentName: ' ' }]) expect(() => cleanAppointment(lesson(change))).toThrow();
    expect(() => cleanScheduleRange(range('2026-01-01', '2026-12-31'))).toThrow(/92 days/);
    expect(() => cleanScheduleRange(range('2026-04-01', '2026-03-01'))).toThrow();
    for (const id of ['lesson-a~2026-02-30', 'lesson-a~2026-03-01~bad', 'lesson-a~2026-03-01~', 'lesson-a~2026-03-01~~alias', 'lesson-a~2026-03-01~~', '~2026-03-01', 'lesson-a~', '../lesson~2026-03-01']) expect(parseOccurrenceId(id)).toBeNull();
    expect(cleanAppointment(lesson({ studentName: '  Casey  ', repeat: 'none', untilDate: 'garbage' }))).toMatchObject({ studentName: 'Casey', untilDate: null });
  });
});
