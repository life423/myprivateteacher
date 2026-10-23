// Renders display text where [brackets] mark letters that make one sound together.
function parse(text) {
  const parts = [];
  let buffer = '';
  let marked = false;
  for (const ch of text) {
    if (ch === '[' || ch === ']') {
      if (buffer) parts.push({ text: buffer, marked });
      buffer = '';
      marked = ch === '[';
    } else {
      buffer += ch;
    }
  }
  if (buffer) parts.push({ text: buffer, marked });
  return parts;
}

export default function MarkedText({ text = '', markClassName = 'underline decoration-2 underline-offset-4' }) {
  return parse(text).map((part, i) =>
    part.marked ? (
      <span key={i} className={markClassName}>{part.text}</span>
    ) : (
      <span key={i}>{part.text}</span>
    ),
  );
}
