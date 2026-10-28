import PhonemeArticulationCard from '../articulation/PhonemeArticulationCard.jsx';
import { photoFor } from '../articulation/ArticulationCard.jsx';
import { phonemeDiagramSvg } from '../articulation/phonemeDiagrams.js';
import { phonemeExportPlan } from '../articulation/phonemeExport.js';
import { ARTICULATION_INVENTORY, PHONEME_ARTICULATION_CARDS, phonemeArticulationById } from '../data/phonemeArticulation.js';

export function PhonemeArticulationPage({ id }) {
  const card = phonemeArticulationById(id);
  if (!card) return <p className='p-8'>Unknown articulation target: {id}.</p>;
  return <div style={{ width: 1200, height: 1200, background: 'white' }}><PhonemeArticulationCard card={card} className='block h-[1200px] w-[1200px]' /></div>;
}

export default function PhonemeArticulationGallery() {
  const allSounds = new URLSearchParams(window.location.search).get('all-sounds') === '1';
  const cards = allSounds ? PHONEME_ARTICULATION_CARDS : phonemeExportPlan().map(({ card }) => card);
  const missing = cards.flatMap((card) => [card.photoKey, card.endPhotoKey].filter((key) => key && !photoFor(key)));
  return <main className='min-h-dvh bg-slate-100 px-4 py-8 sm:px-8'>
    <h1 className='text-2xl font-extrabold text-slate-900'>{allSounds ? 'Developer reference: individual sound targets' : '28-card articulation library'}</h1>
    <p className='mt-2 max-w-4xl text-slate-700'>{allSounds ? ARTICULATION_INVENTORY.scope : '16 existing mouth-position families plus 12 missing vowel cards. The additions below follow the existing cards in library positions 17–28.'}</p>
    <p className='mt-2 max-w-4xl text-sm text-slate-600'>{ARTICULATION_INVENTORY.note}</p>
    <p className='mt-2 max-w-4xl text-sm text-slate-600'>{ARTICULATION_INVENTORY.affiliation}</p>
    <p className={`mt-3 font-semibold ${missing.length ? 'text-red-700' : 'text-emerald-700'}`}>{missing.length ? `Missing photos: ${[...new Set(missing)].join(', ')}` : 'Every target has its required photos.'}</p>
    <ul className='mt-6 grid gap-6 [grid-template-columns:repeat(auto-fill,minmax(19rem,1fr))]'>
      {cards.map((card) => <li key={card.id} data-target={card.id}>
        <PhonemeArticulationCard card={card} className='block h-auto w-full drop-shadow-sm' />
        <p className='mt-2 text-sm font-bold text-slate-800'>/{card.ipa}/ · {card.keyword} · {card.kind}</p>
        <p className='text-sm text-slate-600'>{card.note || card.dialectNote || card.photoNote || ''}</p>
        {!phonemeDiagramSvg(card) && <p className='font-bold text-red-700'>Missing diagram: {card.poseKey}</p>}
      </li>)}
    </ul>
  </main>;
}
