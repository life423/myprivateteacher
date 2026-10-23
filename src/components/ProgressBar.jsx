export default function ProgressBar({ level, solvedCount, total }) {
  return (
    <div className='flex-1'>
      <div className='mb-1 text-sm text-gray-700'>
        Level {level}: {solvedCount} of {total} words solved
      </div>
      <div
        className='h-2 w-full rounded-full bg-gray-200 md:h-3'
        role='progressbar'
        aria-label={`Level ${level} progress`}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={solvedCount}
      >
        <div
          className='h-full rounded-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500'
          style={{ width: `${total ? (solvedCount / total) * 100 : 0}%` }}
        />
      </div>
    </div>
  );
}
