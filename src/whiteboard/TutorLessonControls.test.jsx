import { describe, expect, it, vi } from 'vitest';
import { TutorLessonControls } from './TutorRoom.jsx';
import { HandsSwitch, LinesButton, Switch } from './Toolbar.jsx';
import { FocusButton } from './ui.jsx';

const nodes = (node) => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const find = (tree, predicate) => nodes(tree).find(predicate);
const text = (node) => typeof node === 'string' || typeof node === 'number' ? String(node) : !node || typeof node !== 'object' ? '' : [node.props?.children].flat(Infinity).map(text).join('');
function controls(patch = {}) {
  const props = {
    studentTools: false, onStudentTools: vi.fn(), hands: { l: { on: false }, r: { on: true } }, onHands: vi.fn(),
    lines: 'medium', onLines: vi.fn(), strip: true, onStrip: vi.fn(), pointing: 'A', activity: null,
    showStudentView: true, onStudentView: vi.fn(), studentHere: false, onShareView: vi.fn(), onFocus: vi.fn(),
    ...patch,
  };
  return { tree: TutorLessonControls(props), props };
}

describe('the tutor lesson-control groups', () => {
  it('shows Student tools first without another disclosure', () => {
    const { tree, props } = controls();
    expect(nodes(tree).filter((node) => node.type === 'section').map((node) => node.props['aria-label'])).toEqual([
      'Student participation', 'Board appearance', 'View together',
    ]);
    const switches = nodes(tree).filter((node) => node.type === Switch);
    expect(switches.map((node) => node.props.label)).toEqual(['Student tools', 'Alphabet strip']);
    expect(switches[0].props.checked).toBe(false);
    switches[0].props.onChange(true);
    expect(props.onStudentTools).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('preserves pointing-hand and line-size actions while keeping choices inside the panel', () => {
    const { tree, props } = controls();
    const hands = find(tree, (node) => node.type === HandsSwitch);
    hands.props.onToggle('l', true);
    expect(props.onHands).toHaveBeenCalledExactlyOnceWith('l', true);
    const lines = find(tree, (node) => node.type === LinesButton);
    expect(lines.props.inline).toBe(true);
    expect(lines.props.size).toBe('medium');
    lines.props.onChoose('big');
    expect(props.onLines).toHaveBeenCalledExactlyOnceWith('big');
    const status = find(tree, (node) => node.props?.role === 'status');
    expect(text(status)).toBe('Pointing at A');
    expect(status.props['aria-live']).toBe('off');
  });

  it('explains unavailable view sharing without changing the existing action name', () => {
    const { tree } = controls();
    const share = find(tree, (node) => node.props?.['aria-label'] === 'Show my view to student');
    expect(share.props.disabled).toBe(true);
    const help = find(tree, (node) => node.props?.id === share.props['aria-describedby']);
    expect(text(help)).toBe('Connect a student to share your view');
    expect(text(share)).toBe('Bring student to my view');
  });

  it('keeps connected view sharing, student outline and focus wired to their existing actions', () => {
    const { tree, props } = controls({ studentHere: true, showStudentView: false });
    const share = find(tree, (node) => node.props?.['aria-label'] === 'Show my view to student');
    expect(share.props.disabled).toBe(false);
    expect(share.props['aria-describedby']).toBeUndefined();
    share.props.onClick();
    expect(props.onShareView).toHaveBeenCalledOnce();
    const outline = find(tree, (node) => node.props?.['aria-label'] === 'Outline what the student can see');
    expect(outline.props['aria-pressed']).toBe(false);
    outline.props.onClick();
    expect(props.onStudentView).toHaveBeenCalledOnce();
    find(tree, (node) => node.type === FocusButton).props.onClick();
    expect(props.onFocus).toHaveBeenCalledOnce();
  });
});
