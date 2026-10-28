import { ArticulationCardFrame, photoFor } from './ArticulationCard.jsx';
import { phonemeExampleFit, phonemeExampleText, phonemeInstructionFit } from './phonemeCardLayout.js';
import { phonemeDiagramUrl } from './phonemeDiagrams.js';

// The same frame as the original 16 cards: one photograph, one diagram and two
// text areas. A moving sound shows its starting posture; its instruction and the
// diagram's motion arrow explain the glide without creating a second photo.
export default function PhonemeArticulationCard({ card, className = '' }) {
  const photo = photoFor(card.photoKey);
  const diagram = phonemeDiagramUrl(card);
  return <ArticulationCardFrame
    title={card.title}
    instruction={card.instruction}
    soundText={phonemeExampleText(card)}
    photo={photo}
    diagram={diagram}
    instructionFit={phonemeInstructionFit(card)}
    soundFit={phonemeExampleFit(card)}
    className={className}
    svgProps={{
      'data-phoneme-card': card.id,
      'data-missing-photo': photo ? '' : card.photoKey,
      'data-missing-diagram': diagram ? '' : card.poseKey,
    }}
  />;
}
