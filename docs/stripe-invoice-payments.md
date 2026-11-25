# Stripe lesson invoice payments

## Current account choice

The owner's later instruction on November 24 supersedes sandbox setup: use **My Private Teacher**, and do not connect the CLI or application to a sandbox. The installed CLI is authorized for **My Private Teacher, live** (`acct_1SNLUA42XX31N2dn`). `stripe whoami --format json` and a read-only live account request confirmed that identity. The pending extra sandbox authorization was cancelled; no sandbox was added to the CLI grant. The previous sandbox pricing configuration below is historical and is not the selected application environment.

This CLI version uses its own OAuth session, not a server API key. Do not copy the CLI's opaque token into `STRIPE_INVOICE_SECRET_KEY`. On November 25 a dedicated restricted live server credential was created and a read-only SDK account request passed against the expected live platform. The owner declined rotation on November 25 and instructed that this existing credential be retained. Both live notification destinations are now enabled and their separate signing secrets are stored in the ignored local environment file. Key Vault import, deployment and explicit live activation are verified in the final checkpoint below. No real charge, payout or invoice was created during verification.

## Approved behavior

The owner selected platform collection on November 24, 2026: families pay My Private Teacher; teachers receive the proceeds after a **5% application fee**. On November 25 the owner explicitly approved completing online payments on My Private Teacher's live account with that fee. Stripe processing fees come from the platform's share. This is separate from existing tutor subscriptions. The owner said they do not currently collect sales tax, VAT or GST; this implementation leaves automatic tax off and does not assert that services are tax-exempt.

Use Accounts v2 recipient accounts, Express dashboard access, Stripe-hosted onboarding, and application responsibility for processing fees and negative balances. Check the current recipient transfer capability before issuing an online invoice. Initial online availability is U.S. accounts and USD; other supported invoice currencies can use recorded payments.

## Fee configuration

Use the [Platform Pricing Tool](https://docs.stripe.com/connect/platform-pricing-tools), which supports [native invoice payments and invoice metadata conditions](https://docs.stripe.com/connect/platform-pricing-tools/pricing-schemes). The default scheme must be enabled with this conditional rule:

- Invoice payment is true.
- Invoice metadata `mpt_payment_kind` is `lesson`.
- Variable fee 5%; fixed fee 0; no minimum, maximum, additional fees or modifiers.
- Fallback fee 0%, so unrelated payments do not acquire a new app fee.

The invoice sets `transfer_data.destination` and the matching metadata **before finalization**. Never add `transfer_data.amount` or an explicit application fee: those override the pricing rule and fixed amounts do not preserve 5% after credits or partial settlements. Refunds reverse the transfer and refund the application fee proportionally. Stripe's rounding of proportional refunds can differ by a cent from recomputing a percentage on net totals.

On November 25 at **12:09 PM America/Chicago**, the operator saved and visibly verified **Default — Enabled** on **My Private Teacher's live account** (`acct_1SNLUA42XX31N2dn`). Its conditional fee is **5%**, with both invoice payment true and invoice metadata `mpt_payment_kind: lesson`; the fixed fee is zero, minimum zero, maximum absent, no additional fees or modifiers, and fallback **0%**. The initial assigned-account count was zero. This is live configuration proof, not evidence of a captured payment, teacher transfer or refund.

The November 24 configuration in the existing Clark Company Limited sandbox is historical and superseded by the owner's live-account choice. It is not used as live pricing proof, and no sandbox capture test was run.

No stable public pricing-rule CRUD/readback API was found in current Stripe documentation, SDK 23.2 or connector operation search. Bind operator verification of the enabled rule to the specific platform account and mode. `STRIPE_INVOICE_PRICING_VERIFIED` records that configuration verification; it does not certify money movement. After server credentials, signed notifications and the other issuance gates are verified, the owner's explicit approval permits live collection activation. Verification of actual fees, settlement, transfers and refunds remains a separate step following the first legitimate payer transaction. A sandbox proof never enables live mode. Stripe's [pricing test tool](https://docs.stripe.com/connect/platform-pricing-tools/testing) can simulate fees against eligible existing transactions without creating a payment, but is not a substitute for actual settlement evidence.

## Server configuration

Keep secret values outside Git and logs. Use a dedicated restricted credential with the permissions needed for Connect accounts/links, customers, invoices/items/payments, charges/refunds, application fees and disputes. On Azure, use Key Vault references. Local development can use an ignored environment file. The connected Stripe plugin does not supply a credential to the running Express application.

| Variable | Purpose |
| --- | --- |
| `STRIPE_INVOICE_SECRET_KEY` | Dedicated Stripe server credential; never expose it to the browser. |
| `STRIPE_INVOICE_WEBHOOK_SECRET` | Signing secret for snapshot invoice/payment notifications. |
| `STRIPE_INVOICE_CONNECT_WEBHOOK_SECRET` | Separate signing secret for Accounts v2 thin notifications. |
| `STRIPE_INVOICE_PLATFORM_ACCOUNT` | Verified platform account ID, matching the server key. |
| `STRIPE_INVOICE_PRICING_MODE` | `test` or `live`, matching the verified rule and credential. |
| `STRIPE_INVOICE_PRICING_VERIFIED` | Operator verified the enabled 5% rule for this exact platform account and mode. Does not certify a captured payment. Defaults off. |
| `STRIPE_INVOICE_LIVE_ENABLED` | Separate explicit live activation switch; defaults off. |
| `STRIPE_INVOICE_TAX_MODE` | `none` for the owner's current choice. Automatic tax is not implemented. |
| `INVOICE_PUBLIC_ORIGIN` | Trusted return origin. Local example `http://localhost:3000`; live requires HTTPS. |

Credential mode, platform account and pricing proof must match. A missing or wrong configuration shows an honest setup state and prevents issuing online invoices. Existing manual invoicing, calendar and teaching continue to work.

### Account setup is separate from collection

A teacher can complete Stripe-hosted onboarding before online collection is activated. Setup still requires both signed notification configurations, the matching account/mode binding, a verified U.S. platform and an HTTPS return origin in live mode. The pricing-verification and live-activation switches are not prerequisites for onboarding or opening an existing account's Stripe dashboard. Those actions do not create a family customer, invoice, payment or transfer.

Payment settings distinguish `available` (verified account setup can open), `connected` (the server's mapped recipient account was retrieved), `onboardingComplete` (its Accounts v2 transfer capability is active), and `ready` (online invoices can be issued). A connected account can therefore show its setup progress or dashboard while explaining that online payments are not active yet.

Issuance retains all existing collection checks: matching account and mode, both notification configurations, verified 5% pricing, active recipient transfer capability, no fee-review block, and, in live mode, HTTPS, the owner's current no-tax configuration and explicit `STRIPE_INVOICE_LIVE_ENABLED=true`. Onboarding alone never activates collection. Existing invoice reconciliation and refund handling remain available independently of the new-issuance switch.

The November 25 readiness regression run passed **78 tests in four focused offline files** covering the adapter, credit notes, invoice repository and routes. The new cases complete mocked live-mode onboarding and open its dashboard while pricing or collection activation is off, then confirm that no customer, invoice or invoice item is created and no invoice is finalized. They also cover incomplete recipient capability, successful issuance only with every gate satisfied, and rejected account/mode/country/origin/notification configuration. These are isolated mocks, with no Stripe account or financial operations performed.

### Teacher walkthrough after deployment

1. Sign in and open **Invoices** in the teacher workspace (`/invoices`). Choose **Connect payments**, or **Continue setup** if onboarding was started. The teacher completes Stripe's hosted setup and returns to Invoices. A ready account shows **Online payments connected** and **Manage payment account**; incomplete requirements remain visible in the setup state.
2. Choose **New invoice**. Enter **Bill to**, check **Your name or business**, the invoice and due dates, and **Lesson fees**. Keep **Currency** as USD for online payment. Optional recipient email and student details are under **Contact details and student**.
3. Select **Allow online payment** when the payment account is ready. **Save draft** stores a private draft without issuing it or sending an email.
4. For a legitimate invoice that the teacher is ready to send, choose **Issue invoice**, review the recipient and total, and choose **Issue invoice** again in the confirmation. The resulting **Ready to share** panel provides **Copy payment link** and **View payment page**. Nothing is emailed automatically; the teacher shares the link with the intended payer.
5. After the payer completes the payment on Stripe's hosted page, reopen the invoice or choose **Refresh payment status**. Check the provider-confirmed paid amount, balance and status. The operator separately verifies the captured charge's 5% application fee, destination transfer and any legitimate refund in Stripe. These checks establish real payment behavior; saving a draft or viewing a hosted payment page does not.

This workflow uses the selected live account. Do not issue synthetic invoices, create dummy teacher accounts or initiate a payment merely to produce validation evidence.

## Notifications and payment truth

`POST /api/stripe/invoices/webhook` verifies raw bytes with the invoice signing secret. Subscribe to `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`, `invoice.updated`, `invoice.voided`, `invoice.marked_uncollectible`, `invoice.finalized`, `invoice.overpaid`, `credit_note.created`, `credit_note.updated`, `credit_note.voided`, `charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`, and the handled `charge.dispute.*` lifecycle events. These are platform events for destination charges, not the existing subscription endpoint.

`POST /api/stripe/connect/events` verifies Accounts v2 thin notifications separately, then retrieves the mapped account's current state. Subscribe to relevant `v2.core.account*` recipient capability and requirements changes.

On November 25 both live destinations were created and read back as **enabled**, scoped to **Your account (`@self`)** on My Private Teacher. The invoice snapshot destination subscribes to **20 events**: the eight invoice events and seven credit-note/refund events listed above, plus `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn` and `charge.dispute.funds_reinstated`. The thin destination subscribes to **four events**: `v2.core.account[configuration.recipient].capability_status_updated`, `v2.core.account[configuration.recipient].updated`, `v2.core.account[requirements].updated` and `v2.core.account[future_requirements].updated`. Each has its own signing secret, captured directly into the ignored local `.env`; secret values are not part of this document. The existing subscription notification endpoint was preserved unchanged.

The local application accepted correctly SDK-signed unsupported no-op snapshot and thin payloads with **HTTP 200** and rejected invalid signatures with **HTTP 400**. This verifies the local signature parsing and route wiring for both secrets. These locally generated payloads do not prove delivery from Stripe, a completed onboarding API flow or any financial operation. Key Vault import and hosted deployment checks remain pending at this checkpoint.

Payment events resolve invoice/charge/PaymentIntent relationships through Stripe, match both the destination teacher account and invoice ID, and reconcile within the repository's owner queue. They never trust a success-page redirect, browser-supplied paid amount or event metadata as an ownership boundary. Payment reads verify stored invoice ID metadata, currency, mode, destination and original total. Refund/dispute notifications retrieve current provider objects rather than replaying stale financial payloads.

The app records actual paid and remaining amounts, credits, confirmed refunds, pending refunds and disputes. A pending refund is not presented as returned money. Fee mismatches preserve the payment ledger, mark the account for review and prevent further online issuance.

The owner-only Admin → Lesson payments panel shows disputes, individual currency amounts, deadlines and links to the platform's Stripe review pages. Viewing a dispute never automatically reverses a teacher's transfer or debits their bank account; the operator must resolve recovery and evidence in Stripe. Monitor fee-review states too. Do not claim a fully automated dispute-recovery process.

## Recovery and account deletion

Issue and refund operations keep durable checkpoints and stable idempotency keys. An unresolved operation older than 23 hours requires a Stripe review before retrying, to avoid repeating a request after Stripe expires its idempotency key. Completed operations do not repeat financial POSTs. Completed issue records scrub duplicate family contact data; account deletion scrubs redundant contact/notes from provider checkpoints while retaining opaque references needed for financial reconciliation.

Online invoices support recording the full remaining balance paid outside the app; manual-only invoices also support partial payment entries and corrections. Online offline-payment reversal is disabled because it cannot safely reopen a closed Stripe invoice. Void/cleanup closes unpaid open and uncollectible links. Account deletion blocks on an online part-paid invoice with a remaining payable balance until that balance is resolved explicitly; it does not silently forgive it or refund a family.

## Verification checkpoint

The final production build passed. The release candidate suite passed **928 tests in 103 files**. Mocked Stripe adapter/raw notification tests include account/mode proof, fee calculation against captured amounts, credits, pending refunds, retry/crash boundaries, owner isolation, signature bytes and disputes beyond 2,000 ordinary operation records. These tests do **not** claim real Stripe API or bank validation.

Production browser fixtures passed 24 teaching-mark cases, 39 invoice cases and 12 connected teacher-workflow cases across desktop, tablet and phone, with no page errors. Calendar and owner payment-review UI have their own rendered checks documented in their feature notes. Test data and memory adapters are isolated from real families.

The final frozen build also passed all 27 calendar browser cases. The local Node 24 development process is running on ports 3000/8080; the API health and calendar page returned HTTP 200, and the database connected. The user's existing signed-in browser successfully loaded the actual Calendar and Invoices lists without errors. A labelled calendar connection check was subsequently saved, reloaded, opened as an unsaved invoice prefill, and cancelled. No financial record, payment, refund or message was created.

The initial sandbox capture plan was not run and is superseded by the owner's live-account choice above. The retained restricted credential passed a read-only live platform account check, both live signed notification destinations are enabled, the 5% invoice pricing rule has been visibly verified, and the owner has explicitly approved activation. The three Key Vault references and deployed configuration were verified before collection was enabled. No synthetic live teacher account or financial record is created automatically for validation. When a payer explicitly makes the first legitimate invoice payment, verify fees per captured charge, actual paid/remaining amounts, credits and refund/transfer records; do not infer successful money movement from mocked tests or a settings screen. Actual provider payment, fee, transfer and refund validation has not occurred at this checkpoint. App collection activation is enabled for the approved live account; each teacher still needs to complete hosted payout onboarding.

## November 25 live activation checkpoint

PR #72 is merged into main at `b82628a0b378947585e7583535f54b9653f950fb`. Its GitHub test/deploy run passed, including the exact hosted version and whiteboard realtime checks. Azure revision `phoneme-pop--0000079` is ready with the live account/mode binding, verified pricing and `STRIPE_INVOICE_LIVE_ENABLED=true`. Local development has the same collection configuration.

The dedicated restricted server key and the two distinct signing secrets are stored in Azure Key Vault. The app reads only those three secret scopes through its system identity. Temporary operator import roles were removed and their absence verified; the existing subscription credential and event endpoint were preserved.

After activation, both hosted notification routes rejected invalid signatures with HTTP 400 and accepted correctly signed unsupported no-op payloads with HTTP 200. Those locally generated payloads checked configuration and signature wiring only. They did not create financial records, establish Stripe-origin event delivery or test real money movement. The signed-in local owner page shows **Connect payments**; no teacher account was created automatically.

Next, a teacher completes Stripe-hosted onboarding. The first legitimate payer transaction must still establish actual captured fees, destination transfer, paid/remaining totals and any legitimate refund. No real charge, payout, transfer or refund was performed by this setup.
