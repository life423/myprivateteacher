// Upload classification is a small, explicit vocabulary; titles are plain text.
export function cleanPictureMetadata({ material, title } = {}) {
  const name = typeof title === 'string' ? title.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 120) : '';
  return { ...(material === 'worksheet' ? { material: 'worksheet' } : {}), ...(name ? { title: name } : {}) };
}
