import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ArticulationCard from './ArticulationCard.jsx';
import PhonemeArticulationCard from './PhonemeArticulationCard.jsx';
import { ARTICULATION_CARDS } from '../data/articulationCards.js';
import { phonemeExportPlan } from './phonemeExport.js';
import { BANNER, CARD, DIAGRAM, MOUTH_REGION, PALETTE } from './cardLayout.js';

const tags = (markup, tag) => [...markup.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'g'))].map((match) =>
  Object.fromEntries([...match[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((attribute) => [attribute[1], attribute[2]])));
const geometry = (attributes) => Object.fromEntries(['x', 'y', 'width', 'height'].map((name) => [name, Number(attributes[name])]));
const family = ARTICULATION_CARDS.map((card) => ({ card, Component: ArticulationCard }));
const additions = phonemeExportPlan().map(({ card }) => ({ card, Component: PhonemeArticulationCard }));

describe('the complete 28-card teaching library', () => {
  it('renders one full-height photo and one anatomy diagram in the same frame on every card', () => {
    expect(family.length + additions.length).toBe(28);
    for (const { card, Component } of [...family, ...additions]) {
      const markup = renderToStaticMarkup(<Component card={card} />);
      expect(tags(markup, 'svg')[0].viewBox, card.id).toBe(`0 0 ${CARD.width} ${CARD.height}`);
      const images = tags(markup, 'image');
      expect(images, card.id).toHaveLength(2);
      const photos = images.filter((image) => image['data-card-part'] === 'photo');
      const diagrams = images.filter((image) => image['data-card-part'] === 'diagram');
      expect(photos, card.id).toHaveLength(1);
      expect(diagrams, card.id).toHaveLength(1);
      expect(photos[0].href, card.id).toBeTruthy();
      expect(diagrams[0].href, card.id).toBeTruthy();
      expect(geometry(photos[0]), card.id).toEqual({ x: MOUTH_REGION.x, y: MOUTH_REGION.y, width: MOUTH_REGION.w, height: MOUTH_REGION.h });
      expect(geometry(diagrams[0]), card.id).toEqual({ x: DIAGRAM.x, y: DIAGRAM.y, width: DIAGRAM.size, height: DIAGRAM.size });
      const banner = tags(markup, 'rect').find((rect) => rect['data-card-part'] === 'banner');
      expect(geometry(banner), card.id).toEqual({ x: BANNER.x, y: BANNER.y, width: BANNER.width, height: BANNER.height });
      expect(banner.fill, card.id).toBe(PALETTE.banner);
      expect(tags(markup, 'text').map((text) => text['data-card-part']), card.id).toEqual(['title', 'instruction', 'sound']);
      expect(markup, card.id).not.toMatch(/Photo coming soon|Missing photo|>Start<|>End<|Voice on<|Air: mouth</);
    }
  });
});
