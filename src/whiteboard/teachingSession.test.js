import { describe, expect, it } from 'vitest';
import { loadTeachingSession, saveTeachingSession, TEACHING_SESSION_KEY } from './teachingSession.js';

const storage = () => { const data = new Map(); return { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) }; };
const room = { code: '1234', key: 'private-room-key' };
describe('scheduled classroom starts', () => {
  it('starts a fresh room for another Calendar start, then reconnects on reload', () => {
    const saved = storage();
    saveTeachingSession(saved, room, '?start=first-start-token-1234');
    expect(loadTeachingSession(saved, '?start=second-start-token-5678')).toEqual({});
    saveTeachingSession(saved, { ...room, code: '5678' }, '?start=second-start-token-5678');
    expect(loadTeachingSession(saved, '?start=second-start-token-5678').code).toBe('5678');
    expect(loadTeachingSession(saved, '?start=first-start-token-1234')).toEqual({});
  });
  it('preserves ordinary refresh and recovers from damaged or blocked storage', () => {
    const saved = storage(); saveTeachingSession(saved, room);
    expect(loadTeachingSession(saved)).toEqual(room);
    saved.setItem(TEACHING_SESSION_KEY, '{'); expect(loadTeachingSession(saved)).toEqual({});
    const blocked = { getItem() { throw new Error(); }, setItem() { throw new Error(); } };
    expect(loadTeachingSession(blocked)).toEqual({});
    expect(saveTeachingSession(blocked, room)).toEqual(room);
  });
});
