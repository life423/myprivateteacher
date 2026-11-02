import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ current: null }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal(),
  useState: initial => hooks.current.useState(initial), useRef: initial => hooks.current.useRef(initial),
  useEffect: (setup, deps) => hooks.current.effect(setup, deps), useLayoutEffect: (setup, deps) => hooks.current.effect(setup, deps),
  useContext: () => ({ fill: false, bar: false, align: 'center' }), useMemo: factory => factory(), useCallback: fn => fn,
}));
import Stage from './Stage.jsx';
import ObjectToolbar from './ObjectToolbar.jsx';
import { pieceSize } from '../../shared/pieces.js';

const mounted = [];
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : !node || typeof node !== 'object' ? [] : [node, ...nodes(node.props?.children)];
const find = (tree, predicate) => nodes(tree).find(predicate);
const surface = tree => find(tree, node => node.props?.['data-board-surface'] !== undefined);
const stageSvg = tree => find(tree, node => node.type === 'svg' && node.props.onPointerDown);
const handle = tree => find(tree, node => node.props?.['data-piece-resize']);
const toolbar = tree => find(tree, node => node.type === ObjectToolbar);
const event = fields => ({ button: 0, pointerType: 'mouse', pointerId: 7, buttons: 1, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...fields });
let windowListeners;
function target(registry = new Map()) {
  return {
    addEventListener(name, fn) { if (!registry.has(name)) registry.set(name, new Set()); registry.get(name).add(fn); },
    removeEventListener(name, fn) { registry.get(name)?.delete(fn); },
  };
}
const dispatch = (name, e) => [...(windowListeners.get(name) || [])].forEach(fn => fn(e));

function mount(overrides = {}) {
  const slots = []; let index = 0, effects = [];
  const piece = overrides.pieces?.[0] || { id: 'mark', pic: 'source', crop: { x: 0, y: 0, w: 90, h: 40, r: 0 }, x: 300, y: 300, w: 64, h: 28, z: 1, heldBy: null, content: { kind: 'breve' } };
  const api = { current: null };
  const actions = {
    grab: vi.fn(id => { if (id === piece.id) piece.heldBy = 'tutor'; }),
    move: vi.fn((id, x, y, w) => { if (id === piece.id) Object.assign(piece, { x, y, ...pieceSize(piece.crop, w ?? piece.w, piece.content) }); }),
    drop: vi.fn((id, x, y, w) => { if (id === piece.id) Object.assign(piece, { x, y, ...pieceSize(piece.crop, w ?? piece.w, piece.content), heldBy: null }); }),
  };
  let props = { me: 'tutor', board: {}, pieces: [piece], pictures: [{ id: 'source', w: 200, h: 200 }], pieceActions: actions, canEditPieces: true, stageApi: api, ...overrides };
  const runtime = {
    useState(initial) { const i = index++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }]; },
    useRef(initial) { return slots[index++] ??= { current: initial }; },
    effect(setup, deps) { const i = index++, old = slots[i]; if (!old || deps.some((value, n) => !Object.is(value, old.deps[n]))) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: setup() }; }); },
  };
  const hook = {
    piece, api, actions,
    render(next = {}) { props = { ...props, ...next }; index = 0; hooks.current = runtime; try { return Stage(props); } finally { hooks.current = null; } },
    effects() { const pending = effects; effects = []; pending.forEach(run => run()); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
  mounted.push(hook);
  let tree = hook.render();
  surface(tree).ref.current = { ...target(), clientWidth: 800, clientHeight: 500, getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 500 }), querySelector: () => null };
  stageSvg(tree).ref.current = { getScreenCTM: () => ({ inverse: () => ({ a: 2, d: 2, e: 0, f: 0 }) }), focus: vi.fn() };
  hook.effects(); tree = hook.render(); hook.effects();
  api.current.selectPiece(piece.id, { preserveView: true }); tree = hook.render(); hook.effects();
  return { hook, tree };
}
const pointerElement = () => { const element = { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() }; element.contains = node => node === element; return element; };

beforeEach(() => {
  windowListeners = new Map(); vi.stubGlobal('window', target(windowListeners)); vi.stubGlobal('document', { ...target(), hidden: false, activeElement: null });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('DOMPoint', class { constructor(x, y) { this.x = x; this.y = y; } matrixTransform(m) { return { x: this.x * m.a + m.e, y: this.y * m.d + m.f }; } });
});
afterEach(() => { mounted.splice(0).forEach(hook => hook.unmount()); vi.unstubAllGlobals(); });

describe('shared Stage resizing integration', () => {
  it('previews native mark width and commits the final undelivered release sample without changing the camera', () => {
    const { hook, tree } = mount(); const originalView = stageSvg(tree).props.viewBox;
    const element = pointerElement(), button = handle(tree);
    const start = { clientX: button.props.style.left + 22, clientY: button.props.style.top + 22, currentTarget: element };
    button.props.onPointerDown(event(start));
    button.props.onPointerMove(event({ ...start, clientX: start.clientX + 30, clientY: start.clientY + 15 }));
    const preview = hook.actions.move.mock.calls.at(-1);
    expect(preview[3]).toBeGreaterThan(64); expect(hook.piece.x).toBe(300); expect(hook.piece.y).toBe(300);
    dispatch('pointerup', event({ ...start, type: 'pointerup', clientX: start.clientX + 45, clientY: start.clientY + 25 }));
    expect(hook.actions.grab).toHaveBeenCalledTimes(1); expect(hook.actions.drop).toHaveBeenCalledTimes(1);
    expect(hook.actions.drop.mock.calls[0][3]).toBeGreaterThan(preview[3]);
    expect(hook.piece.h / hook.piece.w).toBeCloseTo(28 / 64, 2);
    expect(stageSvg(hook.render()).props.viewBox).toBe(originalView);
  });

  it('finishes capture loss once using the last resized geometry', () => {
    const { hook, tree } = mount(); const button = handle(tree), element = pointerElement();
    const start = { clientX: button.props.style.left + 22, clientY: button.props.style.top + 22, currentTarget: element };
    button.props.onPointerDown(event(start)); button.props.onPointerMove(event({ ...start, clientX: start.clientX + 20 }));
    const width = hook.actions.move.mock.calls.at(-1)[3];
    button.props.onLostPointerCapture(event({ pointerId: 7 })); dispatch('pointerup', event({ ...start, type: 'pointerup' }));
    expect(hook.actions.drop).toHaveBeenCalledExactlyOnceWith('mark', 300, 300, width);
  });

  it('uses the same centered live geometry for Size while normal dragging remains movement only', () => {
    const { hook, tree } = mount(); const controls = toolbar(tree).props, originalView = stageSvg(tree).props.viewBox;
    controls.onSizeStart(); controls.onSizeChange(100); controls.onSizeChange(120); controls.onSizeEnd();
    expect(hook.actions.grab).toHaveBeenCalledTimes(1); expect(hook.actions.drop).toHaveBeenCalledTimes(1);
    expect(hook.piece.x + hook.piece.w / 2).toBe(332);
    expect(Math.abs(hook.piece.y + hook.piece.h / 2 - 314)).toBeLessThanOrEqual(0.1);
    let next = hook.render(); hook.effects();
    expect(stageSvg(next).props.viewBox).toBe(originalView);
    hook.actions.drop.mockClear();
    const svg = stageSvg(next).props, element = pointerElement();
    const start = { clientX: (hook.piece.x + 20) / 2, clientY: (hook.piece.y + 10) / 2, currentTarget: element };
    svg.onPointerDown(event(start)); svg.onPointerMove(event({ ...start, clientX: start.clientX + 40, clientY: start.clientY + 10 }));
    dispatch('pointerup', event({ ...start, type: 'pointerup', clientX: start.clientX + 40, clientY: start.clientY + 10 }));
    expect(hook.actions.drop.mock.calls[0][3]).toBeUndefined(); expect(hook.piece.w).toBe(120);
  });

  it('hides resize controls when permissions are off and does not start another participant’s held object', () => {
    const { hook, tree } = mount({ canEditPieces: false });
    expect(handle(tree)).toBeUndefined(); expect(toolbar(tree).props.canResize).toBe(false);
    let next = hook.render({ canEditPieces: true }); hook.effects(); hook.piece.heldBy = 'student'; next = hook.render();
    const button = handle(next); expect(button.props.disabled).toBe(true);
    button.props.onPointerDown(event({ clientX: 300, clientY: 200, currentTarget: pointerElement() }));
    expect(hook.actions.grab).not.toHaveBeenCalled();
  });

  it('keeps a student’s trusted mouth photo movable with size controlled by the tutor', () => {
    const photo = { id: 'face', pic: 'mouth', crop: { x: 0, y: 0, w: 100, h: 100 }, x: 300, y: 300, w: 120, h: 120, z: 1 };
    const { tree } = mount({ me: 'student', pieces: [photo], pictures: [{ id: 'mouth', w: 200, h: 200, library: 'card', regions: [{ id: 'mouth', x: 0, y: 0, w: 200, h: 200 }] }] });
    expect(handle(tree)).toBeUndefined(); expect(toolbar(tree).props.canResize).toBe(false); expect(toolbar(tree).props.resizeLocked).toBe(true);
  });
});
