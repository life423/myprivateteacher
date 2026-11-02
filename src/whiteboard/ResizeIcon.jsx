import { Maximize2 } from 'lucide-react';

export default function ResizeIcon({ corner = 'se' }) {
  return <Maximize2 className={`h-4 w-4 ${corner === 'se' || corner === 'nw' ? 'rotate-90' : ''}`} aria-hidden='true' />;
}
