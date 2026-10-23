// A landing photo as WebP sized for the screen, with the JPG for browsers without WebP.
// Written as one piece of HTML on purpose: built element by element (as React does), Safari
// starts downloading the JPG before it sees the WebP sources, and so fetches both.
const attr = (value) => String(value).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/</g, '&lt;');

export default function Photo({ name, width, height, alt, className, first = false }) {
  const html =
    `<picture class='block'>` +
    `<source type='image/webp' srcset='/landing/${name}-640.webp 640w, /landing/${name}-1200.webp 1200w' sizes='(min-width: 1024px) 560px, 100vw'>` +
    `<img src='/landing/${name}.jpg' width='${width}' height='${height}' alt='${attr(alt)}' class='${attr(className)}' ` +
    (first ? `fetchpriority='high'` : `loading='lazy'`) +
    `></picture>`;
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
