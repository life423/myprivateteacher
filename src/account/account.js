import { useEffect, useState } from 'react';

// Who is signed in (tutors only; students never need an account), shared by every component
// that asks, and refreshed after signing in or out.
let current = null;
const listeners = new Set();

async function load() {
  try {
    const res = await fetch('/api/me', { cache: 'no-store' });
    current = res.ok ? await res.json() : { tutor: null, signIn: null };
  } catch {
    current = { tutor: null, signIn: null };
  }
  listeners.forEach((listener) => listener(current));
  return current;
}

export const refreshAccount = () => load();

export async function signOut() {
  await fetch('/auth/logout', { method: 'POST' }).catch(() => {});
  return load();
}

export function useAccount() {
  const [state, setState] = useState(current);
  useEffect(() => {
    listeners.add(setState);
    if (!current) load();
    return () => listeners.delete(setState);
  }, []);
  return { loading: !state, tutor: state?.tutor || null, googleClientId: state?.signIn?.google || null };
}
