// A preparation preview, never a live classroom or a copy of the private plan.
// Match the runner's public tile/box choices without displaying targets or notes.
export default function StartingBoardPreview({ activity }) {
  const tiles = ['review', 'build'].includes(activity.type) ? (activity.letters || '').trim().split(/\s+/).filter(Boolean) : [];
  const boxes = activity.type === 'read' ? 0 : activity.boxes;
  return <section aria-label='Starting board preview' className='rounded-xl border border-slate-200 bg-slate-50 p-4'>
    <h4 className='text-sm font-semibold text-slate-800'>When this activity opens</h4>
    {tiles.length || boxes ? <>
      {boxes > 0 && <div role='img' aria-label={`${boxes} empty sound boxes`} className='mt-3 flex flex-wrap gap-2'>{Array.from({ length: boxes }, (_, index) => <span key={index} className='h-12 w-12 rounded-lg border-2 border-slate-400 bg-white' />)}</div>}
      {tiles.length > 0 && <ul aria-label='Starting tiles' className='mt-3 flex flex-wrap gap-2'>{tiles.map((tile, index) => <li key={index} className='flex min-h-11 min-w-11 max-w-full items-center justify-center break-all rounded-lg border border-slate-300 bg-white px-3 py-1 text-xl font-semibold text-slate-800'>{tile}</li>)}</ul>}
      <p className='mt-3 text-sm leading-6 text-slate-600'>{tiles.length && boxes ? 'These tiles and boxes appear' : tiles.length ? 'These tiles appear' : 'These empty boxes appear'} on the student’s board. You can add more materials while teaching.</p>
    </> : <p className='mt-2 text-sm leading-6 text-slate-600'>{activity.type === 'dictation' ? 'An empty writing area. Read your private words or sentences aloud while your student writes.' : activity.type === 'read' ? 'An empty board. Open a worksheet in the Tutor guide and choose the words or pictures to add.' : 'An empty board. Add starting tiles above, or leave it empty and add materials while teaching.'}</p>}
  </section>;
}
