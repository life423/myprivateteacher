// The owner's admin panel: tutors and their access, free access (with an end date or none),
// free extensions, invites for people who haven't signed in yet, and a record of every action.
// The server checks the owner role on every request; this page only arranges what it sends.
export const DAY = 86400000;

export const money = (cents) => ((cents || 0) / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });

export const date = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

export function ago(ms) {
  if (!ms) return 'never';
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} day${days === 1 ? '' : 's'} ago` : date(ms);
}

// A tutor's status as one short label, its colour, and the filter it belongs to.
export function status(t) {
  const { access, plan } = t;
  if (access.kind === 'owner') return { label: 'Owner', tone: 'violet', group: 'free' };
  if (access.kind === 'comp') return { label: access.until ? `Free until ${date(access.until)}` : 'Free access', tone: 'emerald', group: 'free' };
  if (plan?.status === 'trialing') {
    const days = Math.max(0, Math.ceil((plan.trialEnd - Date.now()) / DAY));
    return { label: `Trial · ${days} day${days === 1 ? '' : 's'} left`, tone: 'sky', group: 'trial' };
  }
  if (plan?.status === 'active') return { label: plan.cancelAtPeriodEnd ? `Paying · ends ${date(plan.periodEnd)}` : 'Paying', tone: 'emerald', group: 'paying' };
  if (plan?.status === 'past_due') return { label: 'Past due', tone: 'amber', group: 'paying' };
  return { label: plan ? 'Plan ended' : 'No plan', tone: 'slate', group: 'none' };
}
