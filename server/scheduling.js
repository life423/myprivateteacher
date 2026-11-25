import { mongoClient } from './db.js';
import { DATABASE } from './library.js';
import { isLessonId } from '../shared/lessons.js';
import { MAX_APPOINTMENTS, MAX_OCCURRENCE_CHANGES, belongsToAppointment, cleanAppointment, cleanScheduleRange, expandAppointments, isScheduleDate, makeOccurrence, parseOccurrenceId, scheduleInstant, scheduleTimeZone } from '../shared/scheduling.js';

export const SCHEDULE = 'scheduledLessons';
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const view = doc => ({ id: doc._id, studentName: doc.studentName, localDate: doc.localDate, localTime: doc.localTime, timeZone: doc.timeZone, durationMinutes: doc.durationMinutes, repeat: doc.repeat, untilDate: doc.untilDate, lessonId: doc.lessonId, revision: doc.revision, exceptions: structuredClone(doc.exceptions || []), createdAt: +doc.createdAt, updatedAt: +doc.updatedAt, cancelled: doc.cancelled });

export function createSchedulingRepository({ collection, lessons, ownerExists = async () => true, now = () => new Date() }) {
  const queues = new Map();
  const active = async owner => { if (!isLessonId(owner)) fail(401, 'Sign in first.'); if (!await ownerExists(owner)) fail(403, 'This account is unavailable or being deleted.'); };
  const serial = (owner, fn) => {
    const pending = (queues.get(owner) || Promise.resolve()).catch(() => {}).then(fn);
    queues.set(owner, pending);
    return pending.finally(() => { if (queues.get(owner) === pending) queues.delete(owner); });
  };
  const owned = async (owner, id) => {
    if (!isLessonId(id)) fail(404, 'No such scheduled lesson.');
    const doc = await collection.findOne({ _id: id, ownerId: owner });
    if (!doc) fail(404, 'No such scheduled lesson.');
    return doc;
  };
  const checkLesson = async (owner, id) => {
    if (!id) return;
    if (!lessons) fail(503, 'Saved lessons are not available right now.');
    try { await lessons.get(owner, id); } catch (error) { if (error.status === 404) fail(400, 'Choose one of your saved lessons, or use a blank whiteboard.'); throw error; }
  };
  const revision = (doc, value) => { if (!Number.isSafeInteger(value) || value !== doc.revision || doc.cancelled) fail(409, 'This scheduled lesson changed in another tab. Reload the calendar before saving.'); };
  const write = async (owner, doc, fields) => {
    const result = await collection.findOneAndUpdate({ _id: doc._id, ownerId: owner, revision: doc.revision, cancelled: false }, { $set: { ...fields, updatedAt: now() }, $inc: { revision: 1 } }, { returnDocument: 'after' });
    if (!result) fail(409, 'This scheduled lesson changed in another tab. Reload the calendar before saving.');
    await active(owner); return view(result);
  };
  return {
    async list(owner, query) {
      await active(owner); const range = cleanScheduleRange(query);
      const docs = await collection.find({ ownerId: owner, cancelled: false }).limit(MAX_APPOINTMENTS).toArray();
      const appointments = docs.map(view);
      return { appointments, occurrences: expandAppointments(appointments, range), timeZone: range.timeZone };
    },
    async get(owner, id) { await active(owner); return view(await owned(owner, id)); },
    async occurrence(owner, id, timeZone) {
      await active(owner); const parsed = parseOccurrenceId(id);
      if (!parsed) fail(404, 'No such scheduled lesson.');
      const occurrence = makeOccurrence(view(await owned(owner, parsed.seriesId)), parsed.date, timeZone === undefined ? undefined : scheduleTimeZone(timeZone));
      if (!occurrence) fail(404, 'No such scheduled lesson.'); return occurrence;
    },
    create(owner, input) {
      return serial(owner, async () => {
        await active(owner);
        if (!isLessonId(input?.id)) fail(400, 'A scheduled lesson needs a valid ID.');
        const existing = await collection.findOne({ _id: input.id });
        if (existing) { if (existing.ownerId !== owner) fail(404, 'No such scheduled lesson.'); return view(existing); }
        const clean = cleanAppointment(input); await checkLesson(owner, clean.lessonId);
        if (await collection.countDocuments({ ownerId: owner, cancelled: false }) >= MAX_APPOINTMENTS) fail(409, 'Your calendar is full. Cancel an old recurring series before adding another.');
        const doc = { _id: input.id, ownerId: owner, ...clean, revision: 1, exceptions: [], cancelled: false, createdAt: now(), updatedAt: now() };
        try { await collection.insertOne(doc); }
        catch (error) { if (error.code !== 11000) throw error; return view(await owned(owner, doc._id)); }
        if (!await ownerExists(owner)) { await collection.deleteOne({ _id: doc._id, ownerId: owner }); fail(403, 'This account is unavailable or being deleted.'); }
        return view(doc);
      });
    },
    save(owner, id, input) {
      return serial(owner, async () => {
        await active(owner); const doc = await owned(owner, id); revision(doc, input?.revision);
        const clean = cleanAppointment(input); await checkLesson(owner, clean.lessonId);
        // Existing one-off exceptions keep their stable original occurrence date.
        // Changes to the recurrence anchor explicitly clear obsolete exceptions.
        const exceptions = doc.localDate === clean.localDate && doc.repeat === clean.repeat ? (doc.exceptions || []).filter(item => belongsToAppointment(clean, item.date)) : [];
        return write(owner, doc, { ...clean, exceptions });
      });
    },
    changeOccurrence(owner, id, date, input) {
      return serial(owner, async () => {
        await active(owner); const doc = await owned(owner, id); revision(doc, input?.revision);
        if (!isScheduleDate(date) || !belongsToAppointment(doc, date)) fail(404, 'No such scheduled lesson.');
        let exception;
        if (input?.reset === true) exception = null;
        else if (input?.cancelled === true) exception = { date, cancelled: true };
        else {
          const localDate = input?.localDate, localTime = input?.localTime, durationMinutes = input?.durationMinutes;
          scheduleInstant(localDate, localTime, doc.timeZone);
          if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 480) fail(400, 'Choose a duration between 5 minutes and 8 hours.');
          exception = { date, localDate, localTime, durationMinutes, cancelled: false };
        }
        const exceptions = (doc.exceptions || []).filter(item => item.date !== date);
        if (exception) exceptions.push(exception);
        if (exceptions.length > MAX_OCCURRENCE_CHANGES) fail(409, 'This series has many changes. End it and create a new series.');
        return write(owner, doc, { exceptions });
      });
    },
    cancel(owner, id, inputRevision) {
      return serial(owner, async () => {
        await active(owner); const doc = await owned(owner, id);
        if (doc.cancelled && (inputRevision === doc.revision || inputRevision + 1 === doc.revision)) return view(doc);
        revision(doc, inputRevision); return write(owner, doc, { cancelled: true });
      });
    },
    deleteOwner(owner) { return serial(owner, () => collection.deleteMany({ ownerId: owner })); },
  };
}

export function connectScheduling({ uri = process.env.MONGODB_URI, lessons, ownerExists } = {}) {
  if (!uri) return null;
  return createSchedulingRepository({ collection: mongoClient(uri).db(DATABASE).collection(SCHEDULE), lessons, ownerExists });
}
