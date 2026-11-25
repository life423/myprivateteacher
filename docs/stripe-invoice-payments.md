# Stripe lesson invoice payments

## Current account choice

The owner's later instruction on November 24 supersedes sandbox setup: use **My Private Teacher**, and do not connect the CLI or application to a sandbox. The installed CLI is authorized for **My Private Teacher, live** (`acct_1SNLUA42XX31N2dn`). `stripe whoami --format json` and a read-only live account request confirmed that identity. The pending extra sandbox authorization was cancelled; no sandbox was added to the CLI grant. The previous sandbox pricing configuration below is historical and is not the selected application environment.

This CLI version uses its own OAuth session, not a server API key. Do not copy the CLI's opaque token into `STRIPE_INVOICE_SECRET_KEY`. The application still needs a dedicated server credential, signed notification configuration and a verified pricing rule for the selected live account. App live activation remains off. No real charge, payout or invoice was created during CLI verification.

## Approved behavior

The owner selected platform collection on November 24, 2026: families pay My Private Teacher; teachers receive the proceeds after a **5% application fee**. Stripe processing fees come from the platform's share. This is separate from existing tutor subscriptions. The owner said they do not currently collect sales tax, VAT or GST; this implementation leaves automatic tax off and does not assert that services are tax-exempt.

Use Accounts v2 recipient accounts, Express dashboard access, Stripe-hosted onboarding, and application responsibility for processing fees and negative balances. Check the current recipient transfer capability before issuing an online invoice. Initial online availability is U.S. accounts and USD; other supported invoice currencies can use recorded payments.

## Fee configuration

Use the [Platform Pricing Tool](https://docs.stripe.com/connect/platform-pricing-tools), which supports [native invoice payments and invoice metadata conditions](https://docs.stripe.com/connect/platform-pricing-tools/pricing-schemes). The default scheme must be enabled with this conditional rule:

- Invoice payment is true.
- Invoice metadata `mpt_payment_kind` is `lesson`.
- Variable fee 5%; fixed fee 0; no minimum, maximum, additional fees or modifiers.
- Fallback fee 0%, so unrelated payments do not acquire a new app fee.

The invoice sets `transfer_data.destination` and the matching metadata **before finalization**. Never add `transfer_data.amount` or an explicit application fee: those override the pricing rule and fixed amounts do not preserve 5% after credits or partial settlements. Refunds reverse the transfer and refund the application fee proportionally. Stripe's rounding of proportional refunds can differ by a cent from recomputing a percentage on net totals.

On November 24 the approved marketplace model and this conditional **5.0000%** rule were saved and visibly confirmed **Enabled** in the existing **Clark Company Limited sandbox** (`acct_1SNLUZKqYWXyl0IC`). Stripe directed Connect setup there from My Private Teacher's test-mode dashboard. Its initial assigned-account count was zero. This is sandbox configuration, not proof of an actual captured payment or live readiness. No live pricing rule, real charge or real payout was created.

No stable public pricing-rule CRUD/readback API was found in current Stripe documentation, SDK 23.2 or connector operation search. The setup therefore requires operator verification and [captured sandbox tests](https://docs.stripe.com/connect/platform-pricing-tools/testing). Bind the proof to the specific platform account and mode. A sandbox proof never enables live mode.

## Server configuration

Keep secret values outside Git and logs. Use a dedicated restricted credential with the permissions needed for Connect accounts/links, customers, invoices/items/payments, charges/refunds, application fees and disputes. On Azure, use Key Vault references. Local development can use an ignored environment file. The connected Stripe plugin does not supply a credential to the running Express application.

| Variable | Purpose |
| --- | --- |
| `STRIPE_INVOICE_SECRET_KEY` | Dedicated Stripe server credential; never expose it to the browser. |
| `STRIPE_INVOICE_WEBHOOK_SECRET` | Signing secret for snapshot invoice/payment notifications. |
| `STRIPE_INVOICE_CONNECT_WEBHOOK_SECRET` | Separate signing secret for Accounts v2 thin notifications. |
| `STRIPE_INVOICE_PLATFORM_ACCOUNT` | Verified platform account ID, matching the server key. |
| `STRIPE_INVOICE_PRICING_MODE` | `test` or `live`, matching the verified rule and credential. |
| `STRIPE_INVOICE_PRICING_VERIFIED` | Set `true` only after rule and captured-payment verification below. Defaults off. |
| `STRIPE_INVOICE_LIVE_ENABLED` | Separate explicit live activation switch; defaults off. |
| `STRIPE_INVOICE_TAX_MODE` | `none` for the owner's current choice. Automatic tax is not implemented. |
| `INVOICE_PUBLIC_ORIGIN` | Trusted return origin. Local example `http://localhost:3000`; live requires HTTPS. |

Credential mode, platform account and pricing proof must match. A missing or wrong configuration shows an honest setup state and prevents issuing online invoices. Existing manual invoicing, calendar and teaching continue to work.

### Account setup is separate from collection

A teacher can complete Stripe-hosted onboarding before online collection is activated. Setup still requires both signed notification configurations, the matching account/mode binding, a verified U.S. platform and an HTTPS return origin in live mode. The pricing-verification and live-activation switches are not prerequisites for onboarding or opening an existing account's Stripe dashboard. Those actions do not create a family customer, invoice, payment or transfer.

Payment settings distinguish `available` (verified account setup can open), `connected` (the server's mapped recipient account was retrieved), `onboardingComplete` (its Accounts v2 transfer capability is active), and `ready` (online invoices can be issued). A connected account can therefore show its setup progress or dashboard while explaining that online payments are not active yet.

Issuance retains all existing collection checks: matching account and mode, both notification configurations, verified 5% pricing, active recipient transfer capability, no fee-review block, and, in live mode, HTTPS, the owner's current no-tax configuration and explicit `STRIPE_INVOICE_LIVE_ENABLED=true`. Onboarding alone never activates collection. Existing invoice reconciliation and refund handling remain available independently of the new-issuance switch.

The November 25 readiness regression run passed **78 tests in four focused offline files** covering the adapter, credit notes, invoice repository and routes. The new cases complete mocked live-mode onboarding and open its dashboard while pricing or collection activation is off, then confirm that no customer, invoice or invoice item is created and no invoice is finalized. They also cover incomplete recipient capability, successful issuance only with every gate satisfied, and rejected account/mode/country/origin/notification configuration. These are isolated mocks, with no Stripe account or financial operations performed.

## Notifications and payment truth

`POST /api/stripe/invoices/webhook` verifies raw bytes with the invoice signing secret. Subscribe to `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`, `invoice.updated`, `invoice.voided`, `invoice.marked_uncollectible`, `invoice.finalized`, `invoice.overpaid`, `credit_note.created`, `credit_note.updated`, `credit_note.voided`, `charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`, and the handled `charge.dispute.*` lifecycle events. These are platform events for destination charges, not the existing subscription endpoint.

`POST /api/stripe/connect/events` verifies Accounts v2 thin notifications separately, then retrieves the mapped account's current state. Subscribe to relevant `v2.core.account*` recipient capability and requirements changes.

Payment events resolve invoice/charge/PaymentIntent relationships through Stripe, match both the destination teacher account and invoice ID, and reconcile within the repository's owner queue. They never trust a success-page redirect, browser-supplied paid amount or event metadata as an ownership boundary. Payment reads verify stored invoice ID metadata, currency, mode, destination and original total. Refund/dispute notifications retrieve current provider objects rather than replaying stale financial payloads.

The app records actual paid and remaining amounts, credits, confirmed refunds, pending refunds and disputes. A pending refund is not presented as returned money. Fee mismatches preserve the payment ledger, mark the account for review and prevent further online issuance.

The owner-only Admin → Lesson payments panel shows disputes, individual currency amounts, deadlines and links to the platform's Stripe review pages. Viewing a dispute never automatically reverses a teacher's transfer or debits their bank account; the operator must resolve recovery and evidence in Stripe. Monitor fee-review states too. Do not claim a fully automated dispute-recovery process.

## Recovery and account deletion

Issue and refund operations keep durable checkpoints and stable idempotency keys. An unresolved operation older than 23 hours requires a Stripe review before retrying, to avoid repeating a request after Stripe expires its idempotency key. Completed operations do not repeat financial POSTs. Completed issue records scrub duplicate family contact data; account deletion scrubs redundant contact/notes from provider checkpoints while retaining opaque references needed for financial reconciliation.

Online invoices support recording the full remaining balance paid outside the app; manual-only invoices also support partial payment entries and corrections. Online offline-payment reversal is disabled because it cannot safely reopen a closed Stripe invoice. Void/cleanup closes unpaid open and uncollectible links. Account deletion blocks on an online part-paid invoice with a remaining payable balance until that balance is resolved explicitly; it does not silently forgive it or refund a family.

## Verification checkpoint

The final production build passed. The complete suite passed **897 tests in 101 files**. Mocked Stripe adapter/raw notification tests include account/mode proof, fee calculation against captured amounts, credits, pending refunds, retry/crash boundaries, owner isolation, signature bytes and disputes beyond 2,000 ordinary operation records. These tests do **not** claim real Stripe API or bank validation.

Production browser fixtures passed 24 teaching-mark cases, 36 invoice cases and 12 connected teacher-workflow cases across desktop, tablet and phone, with no page errors. Calendar and owner payment-review UI have their own rendered checks documented in their feature notes. Test data and memory adapters are isolated from real families.

The final frozen build also passed all 24 calendar browser cases. The local Node 24 development process is running on ports 3000/8080; the API health and calendar page returned HTTP 200, and the database connected. The user's existing signed-in browser successfully loaded the actual Calendar and Invoices lists without errors. This was a read-only real-account check; no real family invoice or appointment was created.

The initial sandbox capture plan was not run and is superseded by the owner's live-account choice above. Configure and review the selected account's server credentials, signed notifications and 5% invoice pricing rule before activating collection. No synthetic live teacher account or real payment is created automatically for validation. When a payer explicitly makes the first legitimate invoice payment, verify fees per captured charge, actual paid/remaining amounts, credits and refund/transfer records; do not infer successful money movement from mocked tests or a settings screen. Actual provider payment/refund validation has not occurred at this checkpoint. Live activation remains off.
