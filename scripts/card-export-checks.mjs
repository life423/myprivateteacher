import { BANNER, CARD, DIAGRAM, MOUTH_REGION } from '../src/articulation/cardLayout.js';

// Validate the browser's actual SVG DOM before exporting a library image. This
// catches missing assets, split-photo regressions and geometry drift in either deck.
export async function assertCompleteCard(svg, title) {
  const rendered = await svg.evaluate((node) => {
    const frame = (part) => {
      const element = node.querySelector(`[data-card-part="${part}"]`);
      return element ? Object.fromEntries(['x', 'y', 'width', 'height'].map((name) => [name, Number(element.getAttribute(name))])) : null;
    };
    return {
      viewBox: node.getAttribute('viewBox'),
      title: node.querySelector('[data-card-part="title"]')?.textContent,
      imageCount: node.querySelectorAll('image').length,
      photoCount: node.querySelectorAll('image[data-card-part="photo"]').length,
      diagramCount: node.querySelectorAll('image[data-card-part="diagram"]').length,
      photo: frame('photo'), diagram: frame('diagram'), banner: frame('banner'),
    };
  });
  const same = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
  const valid = rendered.viewBox === `0 0 ${CARD.width} ${CARD.height}` && rendered.title === title &&
    rendered.imageCount === 2 && rendered.photoCount === 1 && rendered.diagramCount === 1 &&
    same(rendered.photo, { x: MOUTH_REGION.x, y: MOUTH_REGION.y, width: MOUTH_REGION.w, height: MOUTH_REGION.h }) &&
    same(rendered.diagram, { x: DIAGRAM.x, y: DIAGRAM.y, width: DIAGRAM.size, height: DIAGRAM.size }) &&
    same(rendered.banner, { x: BANNER.x, y: BANNER.y, width: BANNER.width, height: BANNER.height });
  if (!valid) throw new Error(`Refusing to export ${title}: expected one photo and one diagram in the shared card layout`);
  await svg.locator('image').evaluateAll(async (images) => {
    await Promise.all(images.map(async (element) => {
      const image = new Image();
      image.src = element.getAttribute('href') || '';
      await image.decode();
      if (!image.naturalWidth || !image.naturalHeight) throw new Error('The card contains an empty image');
    }));
  });
}
