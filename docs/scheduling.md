# Teacher calendar

Implemented November 24, 2026. This document describes the working feature, not a production-release claim.

## Workflow and design decisions

- Calendar sits beside Your lessons and Invoices in the teacher workspace. Scheduling controls never enter the student's board.
- Teachers enter a student name, local date/time and duration. Preparation is optional; a blank whiteboard is the default.
- A lesson can happen once or repeat every week, with an optional last date. Weekly lessons retain their wall-clock time in the saved IANA time zone.
- Wide screens show seven weekday columns. Tablets and phones show the same week as an agenda with empty days omitted. This keeps names and actions readable rather than shrinking a desktop calendar.
- Start lesson is available on each entry and in its details. It carries the stable occurrence ID, optional preparation ID and a per-opening start token. Root teaching integration uses that token to create a fresh room once while retaining its credentials on reload. Scheduling itself never creates a live room.
- Details show the full local date/time, time zone and preparation, with explicit Edit details, Create invoice and Cancel lesson actions.
- Editing or cancelling a weekly lesson defaults to only that occurrence. A labelled choice changes the whole series. Cancelling a calendar entry retains the saved preparation.
- Whole-series changes to the first date or repeat pattern clear now-obsolete individual exceptions; the form warns before saving. Changes to the ordinary time, name, preparation or duration retain valid exceptions.
- A failed save retains the form and its client-generated ID for retry. Revision conflicts ask the teacher to close and reload before overwriting newer data.
- Scheduling does not send invitations, emails or SMS. Reminder delivery remains separate follow-up work.

## Time zones and clock changes

Dates and times are stored as local civil values plus an IANA time zone, not as a fixed UTC offset. Occurrences are expanded into UTC instants for the displayed range.

- A nonexistent time explicitly entered for the first lesson or an individual reschedule is rejected with a useful explanation.
- If a later weekly occurrence falls inside a spring-forward gap, it moves forward by that gap and shows a clock-change warning. For example, a Chicago 02:30 Sunday lesson becomes 03:30 on the spring transition only.
- A repeated fall-back time uses its first occurrence and explicitly says so in the lesson details.
- The display zone can differ from the appointment zone. Editing continues to use the appointment's original zone.
- A moved occurrence keeps its identity based on its original date, even if moved to another week. Invoice references therefore do not change just because the time changes.

## Storage and API

`scheduledLessons` contains private owner-scoped documents. The repository accepts a collection and a saved-lesson repository, plus `ownerExists` and `now` overrides for isolated tests.

An appointment contains `id`, `studentName`, `localDate`, `localTime`, `timeZone`, `durationMinutes`, `repeat` (`none` or `weekly`), optional `untilDate`, optional `lessonId`, a numeric `revision`, exceptions and timestamps. Owner IDs remain server-side.

An occurrence ID is `seriesId~originalDate`. Each expanded occurrence includes its UTC start/end, local and display dates/times, preparation ID, recurrence type, current revision, rescheduled flag and any clock-change warning.

Occurrence references require exactly those two segments. Trailing separators, empty extra segments and aliases are rejected by calendar routes and invoice input; invoice lookup and persistence use the verified owned occurrence ID. Rescheduling retains that original identity, so a different textual alias cannot create a second invoice for the same lesson.

Routes are mounted at `/api/schedule`:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `?from=YYYY-MM-DD&to=YYYY-MM-DD&timeZone=IANA` | Owned appointments and occurrences for a bounded range |
| POST | `/` | Idempotently create an appointment using its client-generated ID |
| GET | `/:id` | Get an owned appointment |
| PUT | `/:id` | Update a whole appointment/series with its revision |
| PATCH | `/:id/occurrences/:date` | Reschedule, cancel or reset one occurrence with its revision |
| DELETE | `/:id` | Cancel a whole appointment/series with its revision |
| GET | `/occurrences/:id` | Get a single owned non-cancelled occurrence, including for invoice snapshots |

All routes require the signed-in teacher. Every mutation checks the request origin. Another owner's IDs return 404, attached preparation ownership is validated, and updates use a single-document compare-and-swap revision. Account deletion calls `deleteOwner` to remove schedule data.

Limits: 500 active appointment series per account, 256 individual changes per series, 92 displayed days per request and durations from five minutes to eight hours. Cancelled documents are excluded from the active calendar. Monetary records use their own immutable snapshots; cancelling a calendar entry does not rewrite invoices.

## Verification

Nineteen domain, repository and HTTP tests cover:

- Weekly clock changes, ambiguous times, half-hour offsets and half-hour DST gaps.
- Different display zones, moved occurrences outside their original week and inclusive end dates.
- Cross-owner privacy, preparation ownership, repeated create requests and stale revisions across separate repository instances.
- One-occurrence changes versus whole-series changes, cancellation and owner-deletion cleanup.
- Authentication, mutation origin checks, no-store responses and invalid request boundaries.

`node scripts/check-calendar.mjs <output-directory>` runs the actual CalendarPage and HTTP repositories in an isolated Vite fixture with a synthetic teacher and memory storage. It does not use the real account, cloud data, payment services or communications. Its current **27 Chrome cases** passed on November 25 at 1440×1000, 768×1024 and 393×852. Checks include creating one-off lessons, attached preparation, stable Start and invoice links, individual and series editing/cancellation, retained drafts after network failure, keyboard Escape/focus return, 44-pixel primary controls, text enlargement and horizontal overflow. No page errors were collected.

The reviewed screenshots include the desktop week, phone agenda, phone form and tablet details. Artifacts are under the local Codex visualization folder `2026/11/24/mpt-calendar`. The earlier 24-case version also passed through the combined production App and integrated `createApp` routes, with zero page errors; those artifacts are in `2026/11/24/mpt-calendar-production`. Cloud persistence, fresh-room behavior and invoice handoff still require their separate integrated release checks; this focused fixture validates its links.

The November 25 regression edits only the first weekly occurrence from Monday 00:30 to 04:30 in Chicago while displaying Honolulu time. Its original date stays unchanged but its displayed day moves from Sunday into the next Monday/week. The previous UI successfully saved the change yet stayed on the old week, hiding the edited entry; the regression failed while waiting for the actual updated event. The corrected UI follows the edited occurrence rather than the unchanged series time. The same check caught a tablet timezone popover extending beyond the viewport; its tablet container is now bounded, and valid Apply closes the popover and returns focus to its summary. Desktop keyboard activation and tablet/phone trusted touch passed, along with bounds, stable occurrence identity and an unchanged following weekly lesson. Updated screenshots and reports are in `2026/11/25/mpt-calendar-date-line-fixed`.

The final November 25 production run passed **27 calendar cases and 12 cross-feature workflow cases** at desktop, tablet and phone sizes, with zero page errors. The integrated workflow verifies a fresh classroom from Calendar Start, reconnecting to that same room on reload, owned saved preparation, private student payloads, invoice-form prefill and rejection of missing/unauthorized appointments before opening a room. The frozen bundle was `index-BLMV05dl.js`; `dist/index.html` retained SHA-256 `5C616B39AB381DE51DFEB8619900B13A0DB2DF0955A691F0FDA4E0CC3A27E9C6` before and after these runs. Tablet calendar/date-line, desktop scheduled classroom and phone invoice-form screenshots were inspected. Reports are in `2026/11/25/mpt-calendar-final-production` and `2026/11/25/mpt-teacher-workflow-final-production`. These fixtures use isolated memory storage and synthetic accounts; real-account persistence and physical-device checks remain separate validation.

After building, `node scripts/check-calendar.mjs <output-directory> --production` runs the same cases through the production App and integrated `createApp` routes, retaining isolated synthetic account/storage data.

## Internal design critique

A November 25 signed-in owner check also verified cloud persistence: a clearly labelled temporary five-minute appointment was saved, reloaded, and used to open an invoice form with the correct lesson name, date and duration. The form was left unsaved. Cancelling the temporary appointment restored the empty active calendar after another reload. No invitation, reminder or financial record was created; a cancelled calendar record is retained under the documented storage policy.

These are conservative design-review heuristics, not measured user-research scores.

| Dimension | Score | Evidence and follow-up |
| --- | --- | --- |
| Visual hierarchy | 9 | One filled Schedule lesson action; secondary week controls; restrained event cards. |
| Usability | 8.5 | Clear one-occurrence/series choices and retained drafts. P2: add a non-blocking overlap warning before teachers accidentally double-book a time. |
| Aesthetics | 9 | Reviewed desktop, tablet and phone layouts use the existing purple/slate palette, typography hierarchy and consistent spacing. |
| Interaction | 9 | Explicit start/edit/cancel actions, native modal focus, keyboard recovery, busy and retry feedback. |
| Responsiveness | 9 | Actual week-to-agenda layout and phone dialog inspected. Physical device/virtual-keyboard checks are still required. |
| Accessibility | 8.5 | Semantic day sections, labelled forms, radio scope, visible focus and large primary controls. P2: run a screen-reader audit and complete 200% browser-zoom checks across the integrated teacher workspace. |
| Performance | 8 | Calendar is lazy-loaded and date ranges are bounded. P2: measure production LCP, INP and CLS; the development fixture does not establish Core Web Vitals. |
| Product coherence | 9 | Shared teacher navigation; saved preparation and invoice handoffs; no additional student controls. Integrated handoff verification remains part of release QA. |
