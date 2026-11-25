import { useEffect, useRef, useState } from 'react';
import { BookOpen, CalendarDays, ChevronLeft, ChevronRight, Clock, Plus, X } from 'lucide-react';
import { Link, useNavigationGuard } from '../router.jsx';
import { useAccount } from '../account/account.js';
import TeacherNav from '../account/TeacherNav.jsx';
import GoogleButton from '../account/GoogleButton.jsx';
import { listLessons } from '../lessons/api.js';
import { addScheduleDays, scheduleInstant, scheduleLocalParts, scheduleWeek } from '../../shared/scheduling.js';
import { cancelAppointment, changeOccurrence, createAppointment, listSchedule, saveAppointment } from './api.js';
import './calendar.css';

const button = 'cal-button';
const primary = `${button} cal-primary`;
const secondary = `${button} cal-secondary`;
const dateLabel = (date, options = {}) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric', ...options }).format(new Date(`${date}T12:00:00Z`));
const clockLabel = time => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).format(new Date(`2000-01-01T${time}:00Z`));
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const initialZone = () => { try { const saved = localStorage.getItem('mpt-calendar-zone'); if (saved) { new Intl.DateTimeFormat('en', { timeZone: saved }); return saved; } } catch {} return browserZone(); };
const zones = () => { try { return Intl.supportedValuesOf('timeZone'); } catch { return ['America/Chicago', 'America/New_York', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Australia/Sydney', 'UTC']; } };
const zoneName = value => value.replaceAll('_', ' ').replaceAll('/', ' / ');
const teachingLink = (occurrence, start) => `/whiteboard/teach?${new URLSearchParams({ appointment: occurrence.id, start, ...(occurrence.lessonId ? { lesson: occurrence.lessonId } : {}) })}`;
const errorText = error => error?.message || 'Please try again.';

function Dialog({ title, onClose, children, busy = false }) {
  const element = useRef(null), callback = useRef(onClose), pending = useRef(busy);
  callback.current = onClose; pending.current = busy;
  useEffect(() => {
    const dialog = element.current, previous = document.activeElement;
    dialog.showModal();
    const cancel = event => { event.preventDefault(); if (!pending.current) callback.current(); };
    dialog.addEventListener('cancel', cancel);
    return () => { dialog.removeEventListener('cancel', cancel); dialog.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={element} className='cal-dialog' aria-labelledby='calendar-dialog-title'>
    <div className='cal-dialog-head'><h2 id='calendar-dialog-title'>{title}</h2><button type='button' onClick={onClose} disabled={busy} className='cal-icon' aria-label='Close lesson details'><X size={20} aria-hidden='true' /></button></div>
    {children}
  </dialog>;
}

function TimeZoneField({ id, value, onChange, disabled = false, compact = false }) {
  return <label className={compact ? 'cal-zone-label' : 'cal-field'} htmlFor={id}><span>Time zone</span><input id={id} list={`${id}-choices`} value={value} onChange={event => onChange(event.target.value)} disabled={disabled} className='cal-input' autoComplete='off' spellCheck='false' required /><datalist id={`${id}-choices`}>{[...new Set([value, browserZone(), 'UTC', ...zones()])].map(zone => <option key={zone} value={zone}>{zoneName(zone)}</option>)}</datalist></label>;
}

function AppointmentForm({ appointment, occurrence, date, zone, lessons, onSave, onClose, busy }) {
  const [scope, setScope] = useState(occurrence?.repeat === 'weekly' ? 'one' : 'all');
  const initial = () => appointment ? {
    ...appointment,
    localDate: occurrence && scope === 'one' ? occurrence.localDate : appointment.localDate,
    localTime: occurrence && scope === 'one' ? occurrence.localTime : appointment.localTime,
    durationMinutes: occurrence && scope === 'one' ? occurrence.durationMinutes : appointment.durationMinutes,
  } : { id: crypto.randomUUID(), studentName: '', localDate: date, localTime: '15:00', timeZone: zone, durationMinutes: 45, repeat: 'none', untilDate: '', lessonId: '' };
  const [draft, setDraft] = useState(initial), [error, setError] = useState(null), [changed, setChanged] = useState(false);
  useNavigationGuard(changed, 'Discard these unsaved lesson details?');
  const change = (key, value) => { setChanged(true); setDraft(current => ({ ...current, [key]: value })); };
  const chooseScope = value => {
    setScope(value); setChanged(true);
    setDraft(current => ({ ...current, localDate: value === 'one' ? occurrence.localDate : appointment.localDate, localTime: value === 'one' ? occurrence.localTime : appointment.localTime, durationMinutes: value === 'one' ? occurrence.durationMinutes : appointment.durationMinutes }));
  };
  const close = () => { if (!changed || window.confirm('Discard these unsaved lesson details?')) onClose(); };
  const submit = async event => {
    event.preventDefault(); if (busy) return; setError(null);
    try { await onSave(draft, scope); setChanged(false); }
    catch (failure) { setError(failure); }
  };
  const one = appointment && scope === 'one';
  return <Dialog title={appointment ? 'Edit scheduled lesson' : 'Schedule a lesson'} onClose={close} busy={busy}>
    <form onSubmit={submit} className='cal-form'>
      {occurrence?.repeat === 'weekly' && <fieldset className='cal-scope'><legend>Change</legend><label><input type='radio' name='edit-scope' value='one' checked={scope === 'one'} disabled={busy} onChange={() => chooseScope('one')} />Only this lesson</label><label><input type='radio' name='edit-scope' value='all' checked={scope === 'all'} disabled={busy} onChange={() => chooseScope('all')} />The whole series</label></fieldset>}
      {!one && <label className='cal-field' htmlFor='schedule-student'><span>Student name</span><input autoFocus id='schedule-student' value={draft.studentName} onChange={event => change('studentName', event.target.value)} disabled={busy} maxLength={100} className='cal-input' required autoComplete='off' /></label>}
      {one && <p className='cal-edit-student'>{draft.studentName}<span>Other lessons in this series keep their time.</span></p>}
      <div className='cal-form-row'><label className='cal-field' htmlFor='schedule-date'><span>{appointment && !one && draft.repeat === 'weekly' ? 'First lesson' : 'Date'}</span><input autoFocus={Boolean(one)} id='schedule-date' type='date' min='2000-01-01' max='2099-12-31' value={draft.localDate} onChange={event => change('localDate', event.target.value)} disabled={busy} className='cal-input' required /></label><label className='cal-field' htmlFor='schedule-time'><span>Start time</span><input id='schedule-time' type='time' value={draft.localTime} onChange={event => change('localTime', event.target.value)} disabled={busy} className='cal-input' required /></label></div>
      <label className='cal-field' htmlFor='schedule-duration'><span>Duration <span className='cal-optional'>(minutes)</span></span><input id='schedule-duration' type='number' min='5' max='480' step='1' value={draft.durationMinutes} onChange={event => change('durationMinutes', event.target.value === '' ? '' : Number(event.target.value))} disabled={busy} className='cal-input' required inputMode='numeric' /></label>
      {!one ? <>
        <TimeZoneField id='schedule-time-zone' value={draft.timeZone} onChange={value => change('timeZone', value)} disabled={busy} />
        <label className='cal-field' htmlFor='schedule-repeat'><span>Repeat</span><select id='schedule-repeat' value={draft.repeat} onChange={event => change('repeat', event.target.value)} disabled={busy} className='cal-input'><option value='none'>Once</option><option value='weekly'>Every week</option></select></label>
        {draft.repeat === 'weekly' && <div className='cal-field'><label htmlFor='schedule-until'>Last lesson date <span className='cal-optional'>(optional)</span></label><input id='schedule-until' type='date' min={draft.localDate} max='2099-12-31' value={draft.untilDate || ''} onChange={event => change('untilDate', event.target.value)} disabled={busy} className='cal-input' aria-describedby='schedule-repeat-help' /><p id='schedule-repeat-help' className='cal-help'>Leave blank to keep repeating. Weekly lessons keep this local time when the clocks change.</p></div>}
        <div className='cal-field'><label htmlFor='schedule-preparation'>Lesson preparation <span className='cal-optional'>(optional)</span></label><select id='schedule-preparation' value={draft.lessonId || ''} onChange={event => change('lessonId', event.target.value)} disabled={busy || lessons === null} className='cal-input' aria-describedby='schedule-preparation-help'><option value=''>Blank whiteboard</option>{(lessons || []).filter(item => !item.deletePending).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}{draft.lessonId && !lessons?.some(item => item.id === draft.lessonId) && <option value={draft.lessonId}>Saved lesson unavailable — choose another</option>}</select><p id='schedule-preparation-help' className='cal-help'>A room and joining code are created when you start teaching.</p></div>
        {appointment && appointment.exceptions.length > 0 && (draft.localDate !== appointment.localDate || draft.repeat !== appointment.repeat) && <p className='cal-warning'>Changing the first date or repeat pattern removes the individual changes in this series.</p>}
      </> : <p className='cal-help'>Times are in {zoneName(draft.timeZone)}.</p>}
      {error && <div role='alert' className='cal-error'>{errorText(error)}{error.status === 409 && <p>Close these details and reload the calendar to see the latest version.</p>}</div>}
      <div className='cal-dialog-actions'><button type='button' className={secondary} disabled={busy} onClick={close}>Cancel</button><button type='submit' className={primary} disabled={busy}>{busy ? 'Saving…' : appointment ? 'Save changes' : 'Schedule lesson'}</button></div>
    </form>
  </Dialog>;
}

function LessonDetails({ occurrence, appointment, lessonName, onClose, onEdit, onCancel, busy }) {
  const [cancelling, setCancelling] = useState(false), [scope, setScope] = useState('one'), [error, setError] = useState(null);
  const [start] = useState(() => crypto.randomUUID());
  const cancel = async () => { setError(null); try { await onCancel(scope); } catch (failure) { setError(failure); } };
  return <Dialog title={occurrence.studentName} onClose={onClose} busy={busy}>
    <div className='cal-details'>
      <p className='cal-detail-date'><CalendarDays size={20} aria-hidden='true' />{dateLabel(occurrence.localDate, { weekday: 'long', year: 'numeric' })}</p>
      <p className='cal-detail-time'><Clock size={20} aria-hidden='true' />{clockLabel(occurrence.localTime)} · {occurrence.durationMinutes} minutes</p>
      <p className='cal-help'>{zoneName(occurrence.timeZone)}{occurrence.repeat === 'weekly' ? ' · Repeats weekly' : ''}{occurrence.rescheduled ? ' · Rescheduled' : ''}</p>
      {occurrence.warning && <p className='cal-warning'>{occurrence.warning}</p>}
      <div className='cal-prep-summary'><span>Lesson preparation</span><strong>{occurrence.lessonId ? lessonName || 'Saved lesson unavailable' : 'Blank whiteboard'}</strong>{occurrence.lessonId && lessonName && <Link to={`/lessons/${occurrence.lessonId}`} className='cal-text-link'>Edit preparation</Link>}</div>
      {cancelling ? <div className='cal-cancel-panel'>
        <h3>Cancel this scheduled lesson?</h3><p>The calendar entry will be removed. Your saved preparation stays in your account.</p>
        {appointment.repeat === 'weekly' && <fieldset className='cal-scope'><legend>Cancel</legend><label><input type='radio' name='cancel-scope' checked={scope === 'one'} onChange={() => setScope('one')} disabled={busy} />Only this lesson</label><label><input type='radio' name='cancel-scope' checked={scope === 'all'} onChange={() => setScope('all')} disabled={busy} />The whole series</label></fieldset>}
        {error && <p role='alert' className='cal-error'>{errorText(error)}</p>}
        <div className='cal-dialog-actions'><button type='button' className={secondary} disabled={busy} onClick={() => setCancelling(false)}>Keep lesson</button><button type='button' className={`${button} cal-danger`} disabled={busy} onClick={cancel}>{busy ? 'Cancelling…' : 'Cancel lesson'}</button></div>
      </div> : <>
        <div className='cal-detail-actions'><Link to={teachingLink(occurrence, start)} className={primary}>Start lesson</Link><button type='button' className={secondary} onClick={onEdit}>Edit details</button></div>
        <div className='cal-detail-secondary'><Link to={`/invoices/new?appointment=${encodeURIComponent(occurrence.id)}`} className='cal-text-link'>Create invoice</Link><button type='button' className='cal-cancel-link' onClick={() => setCancelling(true)}>Cancel lesson</button></div>
      </>}
    </div>
  </Dialog>;
}

function ScheduledLessonCard({ occurrence, onSelect }) {
  const [start] = useState(() => crypto.randomUUID());
  return <li className='cal-event'><button type='button' className='cal-event-details' onClick={() => onSelect(occurrence)} aria-label={`Lesson details: ${occurrence.studentName}, ${clockLabel(occurrence.displayTime)}`}><strong>{occurrence.studentName}</strong><span>{clockLabel(occurrence.displayTime)}</span><small>{occurrence.durationMinutes} min{occurrence.repeat === 'weekly' ? ' · Weekly' : ''}</small>{occurrence.warning && <span className='cal-event-warning'>Clock change</span>}{occurrence.rescheduled && <span className='cal-event-note'>Rescheduled</span>}</button><Link to={teachingLink(occurrence, start)} className='cal-event-start' aria-label={`Start lesson with ${occurrence.studentName}`}>Start lesson <span aria-hidden='true'>→</span></Link></li>;
}

export default function CalendarPage() {
  const account = useAccount();
  const [timeZone, setTimeZone] = useState(initialZone), [zoneDraft, setZoneDraft] = useState(initialZone), [zoneError, setZoneError] = useState(null);
  const [week, setWeek] = useState(() => scheduleWeek(scheduleLocalParts(Date.now(), initialZone()).date));
  const [loadedData, setData] = useState(null), [lessons, setLessons] = useState(null), [error, setError] = useState(null), [lessonError, setLessonError] = useState(null), [retry, setRetry] = useState(0), [busy, setBusy] = useState(false), [dialog, setDialog] = useState(null), [notice, setNotice] = useState('');
  const locked = useRef(false), mounted = useRef(false), operation = useRef(null);
  const data = loadedData?.owner === account.tutor?.id ? loadedData : null;
  const to = addScheduleDays(week, 6), today = scheduleLocalParts(Date.now(), timeZone).date;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort(); }; }, []);
  useEffect(() => {
    if (!account.tutor) return;
    const controller = new AbortController(); setData(null); setError(null);
    const owner = account.tutor.id;
    listSchedule({ from: week, to, timeZone }, { signal: controller.signal }).then(reply => { if (!controller.signal.aborted) setData({ ...reply, owner }); }).catch(failure => { if (!controller.signal.aborted) setError(failure); });
    return () => controller.abort();
  }, [account.tutor?.id, week, timeZone, retry]);
  useEffect(() => {
    if (!account.tutor) return;
    const controller = new AbortController(); setLessonError(null);
    listLessons({ signal: controller.signal }).then(reply => { if (!controller.signal.aborted) setLessons(reply); }).catch(failure => { if (!controller.signal.aborted) { setLessonError(failure); setLessons([]); } });
    return () => controller.abort();
  }, [account.tutor?.id, retry]);
  const changeZone = event => {
    try {
      const zone = new Intl.DateTimeFormat('en', { timeZone: zoneDraft }).resolvedOptions().timeZone;
      setTimeZone(zone); setZoneDraft(zone); setZoneError(null);
      try { localStorage.setItem('mpt-calendar-zone', zone); } catch {}
      const settings = event.currentTarget.closest('details');
      settings?.removeAttribute('open');
      settings?.querySelector('summary')?.focus();
    } catch { setZoneError('Choose a time zone from the suggestions.'); }
  };
  const mutate = async action => {
    if (locked.current) return;
    locked.current = true; setBusy(true); const controller = new AbortController(); operation.current = controller;
    try { const result = await action(controller.signal); if (mounted.current) { setDialog(null); setRetry(value => value + 1); } return result; }
    finally { locked.current = false; operation.current = null; if (mounted.current) setBusy(false); }
  };
  const save = (draft, scope) => mutate(async signal => {
    const existing = dialog?.appointment;
    const result = !existing ? await createAppointment(draft, { signal }) : scope === 'one' ? await changeOccurrence(existing.id, dialog.occurrence.occurrenceDate, { revision: existing.revision, localDate: draft.localDate, localTime: draft.localTime, durationMinutes: draft.durationMinutes }, { signal }) : await saveAppointment(existing.id, { ...draft, revision: existing.revision }, { signal });
    if (mounted.current) {
      setNotice(existing ? 'Scheduled lesson updated.' : 'Lesson scheduled.');
      const date = scope === 'one' ? draft.localDate : result.localDate;
      // A one-occurrence save returns the series, whose anchor time is unchanged.
      // Follow the edited occurrence's time when finding its displayed week.
      const occurrenceTime = scope === 'one' ? draft : result;
      const displayDate = scheduleLocalParts(scheduleInstant(date, occurrenceTime.localTime, occurrenceTime.timeZone).instant, timeZone).date;
      if (displayDate < week || displayDate > to) setWeek(scheduleWeek(displayDate));
    }
  });
  const cancel = scope => mutate(async signal => {
    if (dialog.occurrence.repeat === 'weekly' && scope === 'one') await changeOccurrence(dialog.appointment.id, dialog.occurrence.occurrenceDate, { revision: dialog.appointment.revision, cancelled: true }, { signal });
    else await cancelAppointment(dialog.appointment.id, dialog.appointment.revision, { signal });
    if (mounted.current) setNotice(scope === 'all' && dialog.occurrence.repeat === 'weekly' ? 'Lesson series cancelled.' : 'Scheduled lesson cancelled.');
  });
  const select = occurrence => setDialog({ mode: 'details', occurrence, appointment: data.appointments.find(item => item.id === occurrence.seriesId) });
  const title = `${dateLabel(week)} – ${dateLabel(to, { year: 'numeric' })}`;
  return <main className='teacher-calendar'>
    <header className='cal-header'><div className='cal-header-inner'><Link to='/' className='cal-brand'><span><BookOpen size={20} aria-hidden='true' /></span>My Private Teacher</Link><Link to='/account' className={secondary}>My account</Link></div><TeacherNav active='calendar' /></header>
    <div className='cal-main'>
      <div className='cal-page-heading'><div><h1>Your calendar</h1><p>Plan your week. Start each lesson when you’re ready.</p></div>{account.tutor && <button type='button' className={primary} disabled={!data || busy} onClick={() => { setNotice(''); setDialog({ mode: 'new' }); }}><Plus size={18} aria-hidden='true' />Schedule lesson</button>}</div>
      {account.loading ? <p role='status' className='cal-loading'>Loading your account…</p> : !account.tutor ? <section className='cal-sign-in'><h2>Sign in to use your calendar</h2><p>Keep your schedule and lesson preparation together in your private teacher account.</p>{account.googleClientId ? <GoogleButton clientId={account.googleClientId} onSignedIn={() => {}} /> : <Link to='/login' className={primary}>Sign in</Link>}</section> : <>
        <div className='cal-toolbar'><div className='cal-week-controls'><button type='button' className={secondary} onClick={() => setWeek(scheduleWeek(today))}>Today</button><div className='cal-week-arrows'><button type='button' className='cal-icon' aria-label='Previous week' onClick={() => setWeek(value => addScheduleDays(value, -7))}><ChevronLeft size={20} aria-hidden='true' /></button><button type='button' className='cal-icon' aria-label='Next week' onClick={() => setWeek(value => addScheduleDays(value, 7))}><ChevronRight size={20} aria-hidden='true' /></button></div><h2>{title}</h2></div><details className='cal-zone-settings'><summary>{zoneName(timeZone)}<span>Change</span></summary><div className='cal-zone-edit'><TimeZoneField id='calendar-zone' value={zoneDraft} onChange={setZoneDraft} compact /><button type='button' className={secondary} onClick={changeZone}>Apply</button>{zoneError && <p className='cal-error' role='alert'>{zoneError}</p>}</div></details></div>
        {notice && <p role='status' className='cal-notice'>{notice}</p>}
        {error ? <div className='cal-error'><p role='alert'>{errorText(error)}</p><button type='button' onClick={() => setRetry(value => value + 1)} className={secondary}>Reload calendar</button>{error.status === 401 && <Link to='/login' className={secondary}>Sign in again</Link>}</div> : !data ? <p className='cal-loading' role='status'>Loading your week…</p> : <>
          {!data.occurrences.length && <div className='cal-empty'><CalendarDays size={28} aria-hidden='true' /><h2>No lessons this week</h2><p>Schedule a lesson, or move to another week.</p></div>}
          <div className={`cal-week ${!data.occurrences.length ? 'cal-week-empty' : ''}`} aria-label='Scheduled lessons'>
            {Array.from({ length: 7 }, (_, index) => addScheduleDays(week, index)).map(date => {
              const occurrences = data.occurrences.filter(item => item.displayDate === date);
              return <section key={date} className={`cal-day ${date === today ? 'cal-today' : ''} ${!occurrences.length ? 'cal-day-empty' : ''}`} aria-labelledby={`calendar-day-${date}`}><h3 id={`calendar-day-${date}`}><span>{dateLabel(date, { weekday: 'short', month: undefined, day: undefined })}</span><span className='cal-day-number'>{dateLabel(date, { month: undefined })}</span>{date === today && <span className='cal-today-label'>Today</span>}</h3><ul>{occurrences.map(item => <ScheduledLessonCard key={item.id} occurrence={item} onSelect={select} />)}</ul>{!occurrences.length && <p className='cal-day-free'>No lessons</p>}</section>;
            })}
          </div>
        </>}
        {lessonError && <p className='cal-help cal-lessons-error'>Saved preparation could not be loaded. You can still schedule a blank whiteboard lesson. <button type='button' onClick={() => setRetry(value => value + 1)} className='cal-text-link'>Try again</button></p>}
      </>}
    </div>
    {dialog?.mode === 'details' && <LessonDetails key={dialog.occurrence.id} {...dialog} lessonName={lessons?.find(item => item.id === dialog.occurrence.lessonId)?.title} onClose={() => setDialog(null)} onEdit={() => setDialog(current => ({ ...current, mode: 'edit' }))} onCancel={cancel} busy={busy} />}
    {(dialog?.mode === 'new' || dialog?.mode === 'edit') && <AppointmentForm key={`${dialog.mode}-${dialog.occurrence?.id || ''}`} {...dialog} date={today} zone={timeZone} lessons={lessons} onSave={save} onClose={() => setDialog(null)} busy={busy} />}
  </main>;
}
