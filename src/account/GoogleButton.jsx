import { useEffect, useRef, useState } from 'react';
import { refreshAccount } from './account.js';

// Google's own Sign in with Google button. Google hands back a signed credential, which goes
// straight to this site's server to be checked; the page never sees a password.
const SCRIPT = 'https://accounts.google.com/gsi/client';
let loading = null;

function loadGoogle() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  loading ||= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => resolve(window.google);
    script.onerror = () => {
      loading = null;
      reject(new Error('Google sign-in could not load. Check your connection and try again.'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export default function GoogleButton({ clientId, onSignedIn, width = 300 }) {
  const ref = useRef(null);
  const onSignedInRef = useRef(onSignedIn);
  onSignedInRef.current = onSignedIn;
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    loadGoogle()
      .then((google) => {
        if (!live || !ref.current) return;
        google.accounts.id.initialize({
          client_id: clientId,
          ux_mode: 'popup',
          auto_select: false,
          itp_support: true,
          callback: async ({ credential }) => {
            setError(null);
            const res = await fetch('/auth/google', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ credential }),
            }).catch(() => null);
            if (!res?.ok) {
              const data = await res?.json().catch(() => null);
              setError(data?.error || 'Sign-in failed. Please try again.');
              return;
            }
            const account = await refreshAccount();
            onSignedInRef.current?.(account.tutor);
          },
        });
        google.accounts.id.renderButton(ref.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          logo_alignment: 'left',
          width,
        });
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [clientId, width]);

  return (
    <div className='flex flex-col items-center gap-2'>
      <div ref={ref} className='flex min-h-[44px] justify-center' />
      {error && (
        <p role='alert' className='text-sm font-semibold text-rose-700'>
          {error}
        </p>
      )}
    </div>
  );
}
