export class ScheduleError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'ScheduleError'; this.status = status; }
}
async function request(path, options = {}) {
  let response;
  try { response = await fetch(`/api/schedule${path}`, { credentials: 'same-origin', cache: 'no-store', ...options }); }
  catch (error) { if (error.name === 'AbortError') throw error; throw new ScheduleError('Could not connect. Your details are still here. Please try again.'); }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ScheduleError(data?.error || 'Your calendar could not be updated. Please try again.', response.status);
  if (!data || typeof data !== 'object') throw new ScheduleError('The server returned an incomplete reply. Please try again.');
  return data;
}
const json = (method, body, options) => ({ ...options, method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const listSchedule = (range, options) => request(`?${new URLSearchParams(range)}`, options);
export const createAppointment = async (input, options) => (await request('', json('POST', input, options))).appointment;
export const saveAppointment = async (id, input, options) => (await request(`/${encodeURIComponent(id)}`, json('PUT', input, options))).appointment;
export const changeOccurrence = async (id, date, input, options) => (await request(`/${encodeURIComponent(id)}/occurrences/${encodeURIComponent(date)}`, json('PATCH', input, options))).appointment;
export const cancelAppointment = async (id, revision, options) => (await request(`/${encodeURIComponent(id)}`, json('DELETE', { revision }, options))).appointment;
export const getScheduledOccurrence = async (id, options) => (await request(`/occurrences/${encodeURIComponent(id)}`, options)).occurrence;
