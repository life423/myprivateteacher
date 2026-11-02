import { afterEach, describe, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ current: null, guards: [] }));
vi.mock('react', () => ({ useState: value => hooks.current.useState(value), useRef: value => hooks.current.useRef(value), useEffect: setup => hooks.current.useEffect(setup) }));
vi.mock('../router.jsx', () => ({ Link: () => null, useNavigationGuard: enabled => hooks.guards.push(enabled) }));
import LessonPanel, { directionBlocks } from './LessonPanel.jsx';
import LessonMaterials, { teachingMaterials } from './LessonMaterials.jsx';
function mount(Component, initialProps) {
  const slots = []; let index = 0, props = initialProps;
  const runtime = {
    useState(initial) { const i = index++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }]; },
    useRef(initial) { const i = index++; slots[i] ??= { current: initial }; return slots[i]; },
    useEffect() { index++; },
  };
  return { render(next = props) { props = next; index = 0; hooks.current = runtime; try { return Component(props); } finally { hooks.current = null; } } };
}
function elements(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(child => elements(child, predicate));
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...elements(node.props?.children, predicate)];
}
const find = (tree, type) => elements(tree, node => node.type === type)[0];
const activity = { id: 'activity-a', type: 'review', title: 'Review', directions: '', targets: '', letters: '', cardIds: [], assetIds: [], boxes: 0, reviewNextTime: false, reviewNote: '' };
const runner = overrides => ({ lesson: { id: 'lesson-a', title: 'Plan', activities: [activity] }, index: -1, ready: true, busy: false, loading: false, choices: [], ...overrides });
afterEach(() => { hooks.current = null; hooks.guards.length = 0; });
describe('prepared lesson private review controls', () => {
  it('retains newer typing and its dirty guard when an older note save completes', async () => {
    let resolve; const pending = new Promise(done => { resolve = done; }); const saveReview = vi.fn(() => pending);
    const panel = mount(LessonPanel, { runner: runner({ saveReview }), onClose: vi.fn() });
    const node = elements(panel.render(), item => item.type?.name === 'ReviewNote')[0];
    const review = mount(node.type, node.props);
    find(review.render(), 'textarea').props.onChange({ target: { value: 'First note' } });
    const saving = find(review.render(), 'button').props.onClick();
    expect(saveReview).toHaveBeenCalledWith('activity-a', false, 'First note');
    find(review.render(), 'textarea').props.onChange({ target: { value: 'Newer unsaved note' } });
    resolve(true); await saving;
    const updatedProps = { ...node.props, activity: { ...activity, reviewNote: 'First note' } };
    const rendered = review.render(updatedProps);
    expect(find(rendered, 'textarea').props.value).toBe('Newer unsaved note'); expect(hooks.guards.at(-1)).toBe(true);
    expect(elements(rendered, item => item.props?.role === 'status')).toHaveLength(0);
  });
  it('does not overwrite a newer review flag when its earlier save resolves', async () => {
    let resolve; const saveReview = vi.fn(() => new Promise(done => { resolve = done; }));
    const node = elements(mount(LessonPanel, { runner: runner({ saveReview }), onClose: vi.fn() }).render(), item => item.type?.name === 'ReviewNote')[0];
    const review = mount(node.type, node.props);
    find(review.render(), 'input').props.onChange({ target: { checked: true } });
    const saving = find(review.render(), 'button').props.onClick();
    find(review.render(), 'input').props.onChange({ target: { checked: false } });
    resolve(true); await saving;
    const rendered = review.render({ ...node.props, activity: { ...activity, reviewNextTime: true } });
    expect(find(rendered, 'input').props.checked).toBe(false); expect(hooks.guards.at(-1)).toBe(true);
  });
  it('disables automatic activity switching while material imports are busy or disconnected', () => {
    for (const state of [{ busy: true }, { loading: true }, { ready: false }]) {
      const tree = mount(LessonPanel, { runner: runner(state), onClose: vi.fn() }).render();
      expect(find(tree, 'select').props.disabled).toBe(true);
    }
    expect(find(mount(LessonPanel, { runner: runner(), onClose: vi.fn() }).render(), 'select').props.disabled).toBe(false);
  });
});

describe('private teaching-piece selection', () => {
  const cards = [
    { id: 'lips', title: 'Lip Popper', sounds: ['p', 'b', 'm'] },
    { id: 'snake', title: 'Snake Sound', sounds: ['s', 'z'] },
    { id: 'ship', title: 'Quiet Sound', sounds: ['sh'] },
  ];
  it('uses public review letters and includes each mouth family once, without using private targets', () => {
    const review = { ...activity, letters: 'm p', targets: 'sh', cardIds: ['snake'] };
    expect(teachingMaterials({ id: 'plan' }, review, cards).map(item => item.cardId)).toEqual(['lips', 'snake']);
    expect(teachingMaterials({ id: 'plan' }, { ...review, cardIds: [] }, [...cards, cards[0]]).map(item => item.cardId)).toEqual(['lips']);
  });
  it('keeps dictation and word-building targets out of picture suggestions', () => {
    const secret = { ...activity, letters: 'm p', targets: 'Private answer', cardIds: ['lips'], assetIds: ['answers'] };
    const plan = { id: 'plan', assets: [{ id: 'answers' }] };
    expect(teachingMaterials(plan, { ...secret, type: 'dictation' }, cards)).toEqual([]);
    expect(teachingMaterials(plan, { ...secret, type: 'build' }, cards)).toEqual([]);
  });
  it('opens only an existing prepared source after an explicit tutor action, without sharing private directions', async () => {
    const onOpenMaterial = vi.fn().mockResolvedValue(undefined);
    const read = { ...activity, type: 'read', title: 'Read about Pat', directions: 'Tutor-only teaching notes', targets: 'Secret target', assetIds: ['reading', 'missing'] };
    const plan = { id: 'plan', assets: [{ id: 'reading' }] };
    const material = teachingMaterials(plan, read, cards);
    expect(material).toHaveLength(1);
    expect(material[0].src).toBe('/api/lessons/plan/assets/reading');
    const view = mount(LessonMaterials, { lesson: plan, activity: read, activityIndex: 2, library: cards, onOpenMaterial });
    const button = find(view.render(), 'button');
    expect(onOpenMaterial).not.toHaveBeenCalled();
    await button.props.onClick();
    expect(onOpenMaterial).toHaveBeenCalledExactlyOnceWith({ kind: 'asset', assetId: 'reading', activityId: read.id, activityIndex: 2, label: 'Read about Pat · 1' });
  });
  it('keeps an unsuccessful open retryable and blocks another open while disconnected', async () => {
    const onOpenMaterial = vi.fn().mockRejectedValueOnce(new Error('Reconnect before opening this material.')).mockResolvedValue(undefined);
    const view = mount(LessonMaterials, { lesson: { id: 'plan' }, activity: { ...activity, letters: 'm' }, activityIndex: 0, library: cards, onOpenMaterial });
    await find(view.render(), 'button').props.onClick();
    const error = elements(view.render(), node => node.props?.role === 'alert')[0];
    expect(error.props.children).toBe('Reconnect before opening this material.');
    await find(view.render(), 'button').props.onClick();
    expect(onOpenMaterial).toHaveBeenCalledTimes(2);
    expect(elements(view.render(), node => node.props?.role === 'alert')).toHaveLength(0);
    const offline = view.render({ lesson: { id: 'plan' }, activity: { ...activity, letters: 'm' }, activityIndex: 0, library: cards, onOpenMaterial, disabled: true });
    expect(find(offline, 'button').props.disabled).toBe(true);
    await find(offline, 'button').props.onClick();
    expect(onOpenMaterial).toHaveBeenCalledTimes(2);
  });
});


describe('readable tutor teaching directions', () => {
  it('separates explicit teaching headings while preserving original unstructured paragraphs', () => {
    expect(directionBlocks('Model: Say /m/ clearly.\nDo not add a vowel.\n\nPractice\nMove m into a box.\nCheck: Ask the learner to read it.')).toEqual([
      { heading: 'Model', text: 'Say /m/ clearly.\nDo not add a vowel.' },
      { heading: 'Practice', text: 'Move m into a box.' },
      { heading: 'Check', text: 'Ask the learner to read it.' },
    ]);
    expect(directionBlocks('A legacy teaching paragraph.\n\nA second instruction.')).toEqual([{ heading: null, text: 'A legacy teaching paragraph.\n\nA second instruction.' }]);
  });
  it('keeps core teaching instructions visible and only background/readiness in optional disclosures', () => {
    const directions = 'Background: Previously taught letters.\nModel: Say the sound.\nPractice: Build the word.\nCheck: Read it.\nReadiness: Confirm known spellings.';
    const state = runner({ lesson: { id: 'lesson-a', title: 'Plan', activities: [{ ...activity, directions, targets: 'mat\npat\nTap, Pat, tap!' }] } });
    const tree = mount(LessonPanel, { runner: state }).render(), component = elements(tree, item => item.type?.name === 'Directions')[0];
    const rendered = component.type(component.props);
    expect(elements(rendered, item => item.type === 'details').map(item => elements(item, node => node.type === 'summary')[0].props.children)).toEqual(['Background', 'Readiness']);
    expect(elements(rendered, item => item.type === 'h4').map(item => item.props.children)).toEqual(['Model', 'Practice', 'Check']);
    expect(elements(rendered, item => item.type === 'p').every(item => item.props.className.includes('text-base'))).toBe(true);
    const targets = elements(tree, item => item.type === 'ul' && item.props['aria-label'] === 'Private practice words or sentences')[0];
    expect(elements(targets, item => item.type === 'li').map(item => item.props.children)).toEqual(['mat', 'pat', 'Tap, Pat, tap!']);
  });
});
