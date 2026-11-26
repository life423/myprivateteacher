import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import StartingBoardPreview from './StartingBoardPreview.jsx';

describe('preparation preview privacy and starting materials', () => {
  it('shows separate sound-team tiles and boxes, without private prompts or prepared marks', () => {
    const html = renderToStaticMarkup(<StartingBoardPreview activity={{ type: 'build', letters: 'sh  i\np', boxes: 3, targets: 'PRIVATE_WORD', directions: 'PRIVATE_NOTE', marks: ['breve'] }} />);
    expect(html.match(/<li /g)).toHaveLength(3);
    expect(html).toContain('3 empty sound boxes');
    expect(html).toContain('>sh</li>');
    expect(html).not.toMatch(/PRIVATE_|breve/);
  });
  it('keeps stale letter fields out of dictation and read previews, matching live activity behavior', () => {
    for (const type of ['dictation', 'read']) {
      const html = renderToStaticMarkup(<StartingBoardPreview activity={{ type, letters: 'secret', boxes: 0, targets: 'PRIVATE_ANSWER', assetIds: ['PRIVATE_IMAGE'] }} />);
      expect(html).not.toMatch(/secret|PRIVATE_|<li /);
      expect(html).toContain(type === 'dictation' ? 'An empty writing area' : 'An empty board');
    }
  });
});
