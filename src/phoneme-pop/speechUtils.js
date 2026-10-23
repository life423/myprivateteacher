// Whole words and feedback phrases use the browser's built-in text-to-speech.
// Single sounds deliberately do not: TTS reads a lone letter by its name
// ('c' comes out as 'see'), which works against phonics. Sound tiles get
// recorded clips instead (not yet recorded).
const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

export function speak(text, { rate = 0.8, pitch = 1.1 } = {}) {
  if (!supported || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = rate;
  utterance.pitch = pitch;
  window.speechSynthesis.speak(utterance);
}
