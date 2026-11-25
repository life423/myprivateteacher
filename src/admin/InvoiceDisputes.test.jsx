import { describe, expect, it } from 'vitest';
import { disputeAmount, disputeDashboardUrl } from './InvoiceDisputes.jsx';

describe('owner payment review links and amounts', () => {
  it('permits only secure Stripe Dashboard links, including test-mode payment reviews', () => {
    expect(disputeDashboardUrl('https://dashboard.stripe.com/test/payments/ch_demo')).toBe('https://dashboard.stripe.com/test/payments/ch_demo');
    for (const url of ['javascript:alert(1)', 'https://dashboard.stripe.com.attacker.example/test', 'http://dashboard.stripe.com/payments/ch_demo', 'https://user:password@dashboard.stripe.com/payments/ch_demo', '/payments/ch_demo', undefined]) expect(disputeDashboardUrl(url)).toBeNull();
  });
  it('preserves the currency for each dispute instead of mixing financial amounts', () => {
    expect(disputeAmount({ amountCents: 12500, currency: 'usd' })).toContain('USD');
    expect(disputeAmount({ amountCents: 12500, currency: 'gbp' })).toContain('GBP');
    expect(disputeAmount({ amountCents: 12500, currency: 'usd' })).toContain('125.00');
  });
  it('does not fabricate a zero amount when payment data is incomplete', () => {
    for (const dispute of [{}, { amountCents: null, currency: 'usd' }, { amountCents: 100, currency: 'fake' }, { amountCents: -5, currency: 'usd' }]) expect(disputeAmount(dispute)).toBe('Amount unavailable');
  });
});
