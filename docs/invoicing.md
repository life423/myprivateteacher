# Teacher invoices

Implementation checkpoint: November 24, 2026. This feature is local work until its branch is reviewed, merged and deployed. An installed Stripe connector is separate from the application's server credentials and webhook configuration.

## Teacher workflow

- Open **Invoices** in the teacher workspace. Create an invoice directly or choose **Create invoice** from a scheduled lesson. The scheduled student's name, date and duration become a draft; an existing invoice for that occurrence is opened instead of creating another one.
- Enter the recipient and lesson fees. The teacher's account name and email provide initial sender details. Optional contacts, addresses and student information are grouped in a disclosure. Amounts use whole quantities and exact integer cents.
- Save/reopen a private draft. **Issue invoice** asks for confirmation and keeps the recipient, amount, currency and items as an issued snapshot. Nothing is emailed automatically.
- When online payments are connected, the issued invoice has a hosted payment link to copy and share. Online invoices use the provider's invoice number in the app and print view so families see the same identifier. The internal annual invoice sequence remains available for reconciliation.
- **Print / save PDF** prints the invoice without application navigation or payment controls. Browser Save as PDF provides the download.
- Offline-only invoices support partial payments, full payments and correction of recorded payments. A correction preserves the original entry, marks it reversed and recalculates the balance; it does not send money.
- Online invoices accept a full remaining balance recorded as received outside the app. Partial offline payments and reversal of a provider-paid invoice are intentionally unavailable in this version; the UI explains the limit. Online and local payment totals are never added together.
- Online refunds distinguish a request, a pending refund and a confirmed refund. The original paid liability does not reopen. A disputed payment pauses refunds. Refunds are separate from correcting a cash/check record.
- Void an unpaid issued invoice to close its payment link while keeping its record. Only drafts can be deleted. Cancelled or rescheduled calendar events do not silently change issued financial records.

## Data and recovery

`shared/invoices.js` validates the allowlisted currencies, actual calendar dates, IANA business timezone, recipient fields, item quantities, prices and money bounds. The new draft captures the browser's timezone, or the attached appointment's timezone. Overdue status follows that saved timezone rather than changing at UTC midnight. Legacy documents without a zone use UTC. There are at most 40 items and a total limit of 100,000,000 minor units per invoice. Supported offline currencies are USD, CAD, GBP, EUR, AUD and NZD; all use two decimal places. Online capability, supported currency, minimum amount and fee are supplied by the server payment adapter.

`server/invoices.js` owns teacher-private invoice documents in `teacherInvoices`. Every document lookup uses both invoice ID and owner ID. Mutation revisions use Mongo single-document compare-and-swap; an owner queue coordinates requests within the app's existing single-replica deployment. An annual counter uses a separate atomic revision to allocate unique local invoice numbers. Numbers may have gaps after a concurrent reservation; a number is never reused to overwrite another issued invoice.

Create requests, payment records and refund operations have stable IDs. Provider operations reserve an immutable pending request before external I/O and reuse its idempotency key on retry. An unknown network failure leaves the pending request available to finish. Only a provider error explicitly proving that no side effect occurred can release its reservation. Reloading a committed payment after a lost HTTP response reconciles the client request ID so the next payment receives a new ID.

Stripe payment totals, remaining balance, credits, confirmed/pending refunds and dispute state are synchronized as authoritative snapshots. The browser cannot submit settlement snapshots or mark an invoice paid. Online balance comes from the provider; an invoice settled by credit displays **Settled** and **Credit applied**, rather than claiming cash was received.

Account deletion closes unpaid open and uncollectible online invoices before removing their ownership mapping. A partially paid invoice with a remaining balance blocks deletion until the balance is resolved; deletion does not silently forgive it. If the provider is unavailable, deletion stops with the records intact. Paid provider financial records remain at the provider and are not automatically refunded. No connected bank account is deleted by this workflow.

The current duplicate-appointment check uses the same owner queue as the rest of the app. If the application later supports multiple active replicas, add an atomic unique occurrence claim across replicas before promising duplicate-prevention under simultaneous cross-replica requests.

## Verification

- Shared model, repository and route tests cover cents/date validation, owner isolation, stale revisions, immutable issuing, annual numbering, payment bounds/correction, issue retry, provider source-of-truth totals, full-only offline recording, provider-account matching, refund pending/retry, hosted-link cleanup and same-site mutations.
- `scripts/check-invoices.mjs` exercises actual invoice pages and the app router against isolated HTTP repositories and a synthetic payment adapter. Its `--production` flag uses the integrated `createApp` and built frontend; the development path uses a focused Vite fixture. It never contacts Stripe, the user's real account, the production database or recipients.
- Browser cases run at 1440×1000, 768×1024 and 393×852. They cover draft save/reopen, explicit issue, offline partial/full payment and reversal, lost HTTP response after commit, confirmation keyboard focus and return, hosted-link copy, provider status refresh, requested/pending/confirmed refund, full-only offline limits, appointment prefill/reuse, connection recovery, currency eligibility, enlarged text, target sizes, owner boundary, same-site protection and print/PDF output.
- The reviewed Vite run passed 30 cases with no page errors before the final credit, test-mode and timezone additions. The final shared/domain/route run passed 39 tests. The production run below verifies the final client changes.
- Development artifacts: `C:/Users/aiand/.codex/visualizations/2026/11/24/mpt-invoices/`. Synthetic names, addresses and invoice amounts are used throughout.

### Final production fixture run

The Node 24 production build passed and its fingerprint remained unchanged through **36/36 invoice browser cases**, with zero page errors. The script used the actual built app/router and integrated `createApp` on a separate ephemeral port with synthetic cookies, memory storage and a fake payment adapter. It did not connect to live Stripe or the user's production account.

The final run also checks leaving an untouched new invoice without a discard prompt, a pending refund that later confirms, provider credits without fictional cash receipts, and the simulated-payment label in the print view. Optional contact disclosure, phone form spacing, desktop empty state and tablet refunded invoice screenshots were visually inspected after the run.

- Frontend bundle: `index-BSBWP0Fw.js`; invoice bundle: `InvoicesPage-CWLTS8Oq.js`.
- Build log: `C:/Users/aiand/.codex/maintenance/mpt-teacher-planning-build.log`.
- Final report, screenshots and synthetic PDF: `C:/Users/aiand/.codex/visualizations/2026/11/24/mpt-invoices-production/`.
- The broader calendar, teaching-mark, cross-workflow and provider suites are separate checks; these 36 cases do not constitute real-bank or live-provider validation.

## Design critique and remaining validation

These are conservative review heuristics, not measured usability scores. The phone draft initially exposed too many optional fields; those were moved behind a labelled disclosure. Inline confirmations now receive keyboard focus and scroll into view, then return focus on cancellation. Payment recovery was strengthened after an independent review found stale client operation IDs following a lost response.

| Dimension | Review | Evidence / next action |
| --- | --- | --- |
| Visual hierarchy | 9 | Invoice action is primary; optional data is disclosed on demand. Empty state has one primary creation action. |
| Usability | 8 | Full-only offline recording on online invoices is explicit but remains a product limit; test the explanation with a teacher before adding mixed partial payments. |
| Aesthetics | 9 | Existing violet, slate, borders, radii and spacing are reused; app navigation matches Calendar. |
| Interaction | 9 | Explicit issue/refund confirmation, durable retries, lost-response recovery and keyboard focus are covered. |
| Responsiveness | 9 | Phone/tablet/desktop render checks, enlarged text and overflow assertions pass; physical-device testing remains. |
| Accessibility | 8 | Semantic labels, visible focus, 44px controls and keyboard confirmation are checked; run a screen-reader and physical-touch review before claiming WCAG conformance. |
| Performance | 8 | Invoice lists return summaries rather than complete financial documents; production Core Web Vitals and large-account timing have not been measured. |
| Product coherence | 9 | Calendar creates a private invoice draft; live teaching and app subscription billing stay separate from teacher invoice controls. |

The owner later selected My Private Teacher's live account and declined a sandbox connection. Before enabling collection, configure and verify that account's application credential, signed notifications and approved 5% pricing rule. A legitimate payer-initiated payment is needed to verify actual money movement; simulated fixture tests do not establish that. Follow with a real teacher/parent walkthrough, screen-reader/physical-device checks, and production performance measurements. Automatic email sending, tax calculation, arbitrary recurring billing and mixed partial offline/online settlement are not implemented.

## November 25 release-candidate review

The candidate now rejects noncanonical appointment references, including trailing separators that could bypass the one-invoice-per-occurrence check. The saved reference must match the occurrence returned by the owned scheduling repository; rescheduling keeps that identity.

Verified payment-account onboarding and account management are available independently of collection activation. The interface distinguishes Connect payments, Continue setup and Manage payment account, and retains provider review reasons. Connected teachers can manage their accounts while online invoicing is paused; issuing online invoices still requires the account, capability, signed notifications, mode, HTTPS, fee and explicit live-activation checks. Offline records remain available while online collection is inactive.

The complete Windows unit suite passed **928 tests in 103 files**. The production invoice fixture passed **39 cases** across desktop, tablet and phone, including the added setup-state/fee-review cases, with no page errors. Calendar and connected teacher workflow fixtures passed **27 and 12 cases** on the same production build. Screenshots, reports and the invoice PDF are retained under the November 25 local `mpt-invoices-final-production`, `mpt-calendar-final-production` and `mpt-teacher-workflow-final-production` artifact directories. These isolated fixtures do not establish real Stripe or bank behavior.

A signed-in owner check saved a clearly labelled temporary calendar entry, reloaded it from cloud storage, and opened the correctly prefilled invoice form without saving or issuing an invoice. The entry was then cancelled and the empty active calendar verified after reload. No financial record, payment, refund or message was created. Live Stripe credentials, signed notification setup, the live 5% rule and legitimate payment/refund verification remain outstanding. The Terms and Privacy changes in this candidate are local disclosure drafts; they do not establish child-data, retention, refund or tax compliance.

After those workflow checks, a separate public legal-page review found and fixed narrow-screen text enlargement overflow in the shared legal header and long body text. The final production build (`index-CFMNP3pg.js`) and all **20 legal-page cases** passed at 320, 393, 768 and 1444 pixels, including 200% text, 44-pixel header controls, keyboard navigation and zero horizontal overflow or page errors. Reports are in `mpt-legal-production`. The invoice, calendar and teaching workflow cases above used the preceding production build; the subsequent change was confined to legal-page layout.
