import { useEffect, useState } from 'react';

// Who is signed in (tutors only; students never need an account), shared by every component
// that asks, and refreshed after signing in or out.
let current = null;
const listeners = new Set();

let pending = null;
let requestVersion = 0;

function load({ fresh = false } = {}) {
  if (pending && !fresh) return pending;
  const version = ++requestVersion;
  // Publish only the latest request. An initial anonymous lookup must not overwrite
  // a newer sign-in or sign-out response that completed first.
  const request = Promise.resolve().then(async () => {
    let next;
    try {
      const res = await fetch('/api/me', { cache: 'no-store' });
      next = res.ok ? await res.json() : { tutor: null, signIn: null };
    } catch {
      next = { tutor: null, signIn: null };
    }
    if (version !== requestVersion) return pending || current;
    current = next;
    listeners.forEach((listener) => listener(current));
    return current;
  }).finally(() => {
    if (pending === request) pending = null;
  });
  pending = request;
  return request;
}

export const refreshAccount = () => load({ fresh: true });

export async function signOut() {
  await fetch('/auth/logout', { method: 'POST' }).catch(() => {});
  return refreshAccount();
}

export function useAccount() {
  const [state, setState] = useState(current);
  useEffect(() => {
    listeners.add(setState);
    // A shared refresh may finish between render and subscribing. Catch up to it.
    if (current) setState(current);
    else load();
    return () => listeners.delete(setState);
  }, []);
  return {
    loading: !state,
    tutor: state?.tutor || null,
    googleClientId: state?.signIn?.google || null,
    trialDays: state?.billing?.trialDays || null, // null when billing isn't switched on
    lesson: state?.lesson || { ok: true }, // may this person start a lesson now? { ok, reason }
  };
}

// The tutor plan: whether it lets a tutor teach, and how to describe it.
export const planActive = (plan) => ['trialing', 'active', 'past_due'].includes(plan?.status);

export function planLabel(plan, now = Date.now()) {
  if (!plan) return 'No plan yet';
  const daysLeft = (time) => Math.max(0, Math.ceil((time - now) / 86400000));
  const day = (n) => `${n} day${n === 1 ? '' : 's'}`;
  if (plan.status === 'trialing') return `Free trial · ${day(daysLeft(plan.trialEnd))} left`;
  if (plan.status === 'active') {
    return plan.cancelAtPeriodEnd ? `Tutor plan · ends ${new Date(plan.periodEnd).toLocaleDateString()}` : 'Tutor plan · active';
  }
  if (plan.status === 'past_due') return 'Payment due · update your card';
  return 'Plan ended';
}

// Whether a tutor may teach (the owner, free access, or a current plan), and how to say so.
export const hasAccess = (tutor) => Boolean(tutor?.access?.ok);
export function accessLabel(tutor, now = Date.now()) {
  const access = tutor?.access;
  if (access?.kind === 'owner') return 'Owner · free access';
  if (access?.kind === 'comp') return access.until ? `Free access until ${new Date(access.until).toLocaleDateString()}` : 'Free access';
  return planLabel(tutor?.plan, now);
}

// Stripe's pages: Checkout (the free trial, or the plan) and the billing page. Returns an
// error message, or navigates away.
async function openStripe(path) {
  const res = await fetch(path, { method: 'POST' }).catch(() => null);
  const data = await res?.json().catch(() => null);
  if (res?.ok && data?.url) {
    window.location.assign(data.url);
    return null;
  }
  return data?.error || 'Billing is not available right now. Please try again.';
}
export const startCheckout = () => openStripe('/api/billing/checkout');
export const openBilling = () => openStripe('/api/billing/portal');
