import { describe, expect, it } from 'vitest';
import { acknowledgeSave, activity, attachAsset, editDraft, isDirty, loadedEditor, moveActivity } from './editor.js';
const make = () => ({ id: 'lesson-a', revision: 1, title: 'Short a', activities: [activity('build', 'build-a'), activity('read', 'read-a')], assets: [] });
describe('private preparation draft lifetime', () => {
  it('keeps typing made during a save and advances its revision for the next save', () => {
    const original = loadedEditor(make());
    const edited = editDraft(original, draft => ({ ...draft, title: 'First edit' }));
    const sent = { version: edited.version, draft: structuredClone(edited.draft) };
    const typed = editDraft(edited, draft => ({ ...draft, title: 'Newer edit', activities: draft.activities.map(item => ({ ...item, directions: 'Private newer directions' })) }));
    const result = acknowledgeSave(typed, sent, { ...make(), ...sent.draft, revision: 2 });
    expect(result.lesson.revision).toBe(2); expect(result.draft.title).toBe('Newer edit'); expect(result.draft.activities[0].directions).toBe('Private newer directions'); expect(isDirty(result)).toBe(true);
    const second = acknowledgeSave(result, { version: result.version, draft: result.draft }, { ...make(), ...result.draft, revision: 3 });
    expect(isDirty(second)).toBe(false); expect(second.lesson.revision).toBe(3);
  });
  it('accepts server normalization only when there are no newer local edits', () => {
    const original = loadedEditor(make()), typed = editDraft(original, draft => ({ ...draft, title: '  Review  ' }));
    const result = acknowledgeSave(typed, { version: typed.version, draft: typed.draft }, { ...make(), title: 'Review', revision: 2 });
    expect(result.draft.title).toBe('Review'); expect(isDirty(result)).toBe(false);
  });
  it('binds a late worksheet upload to its originating activity and preserves it across a concurrent save', () => {
    const original = loadedEditor(make()), asset = { id: 'image-a', w: 600, h: 800, bytes: 1000, type: 'image/png' };
    const uploaded = attachAsset(original, 'read-a', asset);
    expect(uploaded.draft.activities.find(item => item.id === 'read-a').assetIds).toEqual(['image-a']);
    expect(uploaded.draft.activities.find(item => item.id === 'build-a').assetIds).toEqual([]);
    const result = acknowledgeSave(uploaded, { version: original.version, draft: original.draft }, { ...make(), revision: 2 });
    expect(result.lesson.assets).toEqual([asset]); expect(result.draft.activities[1].assetIds).toEqual(['image-a']); expect(isDirty(result)).toBe(true);
  });
  it('does not reattach an upload to a replacement activity after its original was removed', () => {
    const current = loadedEditor({ ...make(), activities: [activity('read', 'replacement')] });
    expect(attachAsset(current, 'read-a', { id: 'image-a' })).toBe(current);
  });
  it('moves ordered activities without losing private directions or review notes', () => {
    const items = make().activities; items[0].directions = 'Private prompt'; items[0].reviewNote = 'Review blending'; items[0].reviewNextTime = true; items[0].marks = ['breve', 'syllable-scoop'];
    const next = moveActivity(items, 'build-a', 1);
    expect(next.map(item => item.id)).toEqual(['read-a', 'build-a']); expect(next[1]).toMatchObject({ directions: 'Private prompt', reviewNote: 'Review blending', reviewNextTime: true, marks: ['breve', 'syllable-scoop'] }); expect(items[0].id).toBe('build-a');
    expect(moveActivity(next, 'build-a', 1)).toBe(next);
  });
  it('starts older preparation without a dirty migration and saves newly chosen marks', () => {
    const legacy = make(); delete legacy.activities[0].marks;
    const initial = loadedEditor(legacy);
    expect(initial.draft.activities[0].marks).toEqual([]); expect(isDirty(initial)).toBe(false);
    const selected = editDraft(initial, draft => ({ ...draft, activities: draft.activities.map(item => ({ ...item, marks: ['breve', 'underline'] })) }));
    expect(isDirty(selected)).toBe(true);
    const saved = acknowledgeSave(selected, { version: selected.version, draft: selected.draft }, { ...legacy, ...selected.draft, revision: 2 });
    expect(isDirty(saved)).toBe(false); expect(saved.draft.activities[0].marks).toEqual(['breve', 'underline']);
    saved.draft.activities[0].marks.push('schwa');
    expect(saved.lesson.activities[0].marks).toEqual(['breve', 'underline']);
  });
  it('retains newer mark selections while an earlier lesson save is in flight', () => {
    const first = editDraft(loadedEditor(make()), draft => ({ ...draft, activities: draft.activities.map(item => ({ ...item, marks: ['breve'] })) }));
    const sent = { version: first.version, draft: structuredClone(first.draft) };
    const newer = editDraft(first, draft => ({ ...draft, activities: draft.activities.map(item => ({ ...item, marks: ['breve', 'macron'] })) }));
    const result = acknowledgeSave(newer, sent, { ...make(), ...sent.draft, revision: 2 });
    expect(result.draft.activities[0].marks).toEqual(['breve', 'macron']); expect(isDirty(result)).toBe(true);
  });
});
