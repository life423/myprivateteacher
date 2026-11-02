// Both game launchers share one primary action, including its keyboard state.
export default function GameStartButton({ children, ...props }) {
  return <button type='button' {...props} className='min-h-11 rounded-full bg-violet-600 px-5 py-2 text-base font-bold text-white shadow hover:bg-violet-700 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500'>{children}</button>;
}
