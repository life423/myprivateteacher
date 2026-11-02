import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import NativePieceContent from './NativePieceContent.jsx';
import PieceImage from './PieceImage.jsx';

const picture = { id: 'source', w: 1600, h: 1700 };
const piece = { id: 'mark', pic: picture.id, crop: { x: 10, y: 20, w: 80, h: 30 }, x: 300, y: 400, w: 64, h: 28 };
describe('native teaching ink rendering', () => {
  it('renders a breve without retaining image pixels, a paper frame or a shadow', () => {
    const html = renderToStaticMarkup(<PieceImage piece={{ ...piece, content: { kind: 'breve' } }} pic={picture} src='/private-sheet.png' overlap={{ above: ['letter'], below: [] }} />);
    expect(html).toContain('data-native-content="breve"');
    expect(html).toContain('<path');
    expect(html).not.toMatch(/<image|<rect|filter|shadow|private-sheet/);
  });
  it('uses the existing board letter style for plain native text and keeps breve characters', () => {
    const html = renderToStaticMarkup(<NativePieceContent content={{ kind: 'text', text: 'măt' }} />);
    expect(html).toContain('măt</text>');
    expect(html).toContain('font-size:64px;font-weight:700');
    expect(html).toContain('fill="#1e293b"');
    expect(html).not.toMatch(/font-family|<image|<rect/);
  });
  it('keeps ordinary photo crops intact and rejects invalid native content', () => {
    const html = renderToStaticMarkup(<PieceImage piece={piece} pic={picture} src='/photo.jpg' />);
    expect(html).toContain('href="/photo.jpg"');
    expect(html).toContain('<rect');
    expect(html).toContain('drop-shadow');
    expect(renderToStaticMarkup(<NativePieceContent content={{ kind: 'text', text: '<img>' }} />)).toBe('');
  });
});
