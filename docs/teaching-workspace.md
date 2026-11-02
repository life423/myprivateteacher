# Teaching workspace design decisions

The board is the main working area. Tutors need to see the student, find materials quickly, and change an activity without losing their place. The right side supports those tasks through one stable materials panel, compact call controls and inline game controls.

These decisions record the October 29, 2026 review of 116 substantive public source pages across 20 hostnames. The [source ledger](research/teaching-sidebar-source-ledger.json) preserves every URL, its relevant finding and its proposed application. Source count is not a count of independent experiments. This app still needs task-based feedback from tutors.

## Workspace structure

- Keep Letters, Pictures and Worksheets visible as one category navigation level. Do not add a Materials/Games tab tier above it or hide the primary categories in a dropdown or carousel.
- Use an inline side panel for routine desktop work so the board remains usable. One main content area scrolls while category controls stay reachable. At constrained panel heights, the header and results scroll together in that same panel so a pinned search header cannot leave only an unusable sliver of results. Preserve the saved scroll against whichever element actually scrolls.
- Video starts compact while devices are off. Start video is a direct action. Never request camera or microphone permission merely because a panel opens.
- An active call remains independent of material selection. Minimizing keeps audio and call controls available; it does not hang up. Preserve an explicit minimize choice across ordinary rerenders.
- Games has one visible launcher in a stable location. Its controls open inline with Return to materials. Returning does not end the game, and restores the exact material tab, search, scroll and unfinished tile entry.
- Put the active game first. Keep its level and routine controls near the top. A compact current-game shortcut is available while browsing materials.
- Sound boxes remain in Materials > Letters, with the short Off / 2 / 3 / 4 / 5 choices visible. Keep them out of the board's top edge. Advanced options or nonessential help may use a labeled disclosure.
- Picture library access is available before sharing cards with students. Keep actual card thumbnails, the direct Add face action, clear-space placement, and the larger card/Magic Select editor. Do not recreate a duplicate icon-only catalog.
- Keep Magic Select, manual box selection, completion actions and clear Close/Return controls reachable when inspecting an image. Closing and reopening restores the library's search/filter/scroll state.
- On mobile, offer a native tap/keyboard opener and explicit Close for the nonmodal materials sheet. Expand and Reduce are optional controls. No operation depends on a swipe, hover, modifier key or dragging alone.

## Component and visual rules

Use visible controls for frequent, short choice sets. Use disclosure for optional settings and helper content. Selects and comboboxes choose values; command menus invoke actions. Reserve large focused surfaces for tasks that need space, such as card inspection, cropping and worksheet preview. A carousel is not the main navigation or the only route through the card collection.

Use a consistent spacing rhythm, readable labels, one icon family and restrained purple emphasis. The agreed accent is warm gold, #F4B544, used very sparingly for small highlights or activity cues. Purple remains the primary action color; use dark text on gold where contrast requires it. Prefer quiet borders and grouping over stacked padded cards with competing shadows. Keep destructive actions apart from ordinary teaching actions. Icons supplement labels; they do not replace critical instructions.

For primary touch controls, aim for at least 44 CSS pixels where practical. WCAG 2.2 AA Target Size Minimum is generally 24 by 24 CSS pixels with defined exceptions; 44 is a product design target, not that criterion's minimum. Preserve visible keyboard focus, meaningful headings, selected/expanded state, Escape and focus return. Announce progress and failure without stealing focus, honor reduced motion, and test high zoom.

Jonas Schmedtmann's public curricula reinforce typography, whitespace, visual hierarchy, restrained color and familiar components. They include accordion and carousel exercises; that does not establish their suitability for every application task. The review did not claim to watch paid lectures.

## Color, spacing and subtle motion

Use the same quiet visual language across the toolbar, materials panel and lesson controls. These values are an app-specific starting point, not a universal standard or a quotation from a designer:

- Purple indicates the primary action or selected destination. Green accompanies enabled toggles and call/connection feedback, with explicit text or icons. A selected tab also has an underline and selected semantics; color alone must not communicate state.
- White surfaces on a soft slate background define the work areas. Use a thin neutral border and a restrained shadow for floating surfaces, rather than saturating each group or button.
- Warm gold #F4B544 is a tiny accent for a meaningful cue such as Playing, accompanied by text. Do not use it on every control or as a second large primary-button color. Computed sRGB contrast is about 1.82:1 against white and 9.81:1 against slate #0F172A; use dark text if gold is ever a text background.
- Use a 4px base spacing rhythm (expressed in relative units): 8px between related controls, 12px inside compact rows, 16px panel padding, and 24px between distinct task groups when space allows. Reduce outer padding before shrinking text or hit targets on short screens. Proximity should communicate which label, action and state belong together.
- Use a modest type hierarchy: approximately 16px section headings, 14px control labels and 12px supporting text, respecting browser text settings. Do not make every label bold, purple or uppercase.
- Hover/focus color feedback can use a roughly 150ms transition; a small popover can use a roughly 160–200ms fade and up to 4px of movement; a larger mobile sheet may take roughly 220–300ms. These are initial design choices to validate, not evidence of one optimal timing.
- Animate only the control or surface that changed. Avoid bounce, continuous pulse, parallax, broad transition-all rules, or moving the board while a menu opens. Preserve immediate action feedback and keyboard focus, and honor prefers-reduced-motion.

[W3C use of color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html) requires an additional visible cue when color carries meaning. [NN/g motion guidance](https://www.nngroup.com/articles/animation-purpose-ux/) recommends brief, unobtrusive feedback and state-change animation. [W3C interaction animation guidance](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) describes reduced-motion support under Level AAA SC 2.3.3.

## Lesson-control discoverability follow-up

The original bare top-bar chevron combined permissions, board display, pointing status and view coordination. Its tooltip did not reveal those contents before discovery. The implemented first pass provides a stable Lesson controls button (Controls on narrow phones), a Student tools on/off summary on wide headers, and three visible groups: Student participation, Board appearance and View together. It uses aligned state rows, four visible writing-line choices, a fixed Close header and one scrolling body. Unavailable view sharing explains why. Opening uses a 160ms fade with 4px travel; closing takes 140ms; reduced motion removes those animations. The board never resizes when the controls open.

Student controls retain only their existing permitted Hands and Focus actions; they never inherit tutor permissions or board appearance settings. Inline writing-line choices avoid the old nested portal picker being dismissed by its parent surface. Outside dismissal preserves the clicked target's focus; Close and Escape return focus to the trigger.

The following is a possible later redistribution of frequently used controls; it has not been implemented in this pass:

| Area | Proposed controls | Purpose |
| --- | --- | --- |
| Compact session header | Lesson code, Copy lesson link, connection state, clearly labeled Lesson controls, End session | Session actions and a discoverable entry point without adding another header row. |
| Visible tutor controls | Student tools with its on/off state; student view outline | Permissions and checking the learner's view are teaching tasks, not hidden preferences. Validate final location and frequency with tutors. |
| Existing board tools | Hands/pointing and writing lines alongside relevant board actions | Keep work-on-the-board choices near their effects without duplicating controls. |
| Board viewport controls | Focus and Guide student to my view | Distinguish changing one's own workspace from changing the student's view. |
| Secondary Board view group | Alphabet visibility and other less frequent display settings | A labeled disclosure is appropriate for genuinely secondary preferences. |
| Contextual status | Pointing at the current letter | Status should be visible when relevant, rather than presented as a setting. |

Within a controls surface, prefer aligned label/state rows grouped under short headings, ample separation between tasks, and restrained purple active states. Keep the unavailable guide action understandable with a nearby explanation such as Student not connected. Do not rely on a faded label alone. Keep End session visually separate from routine teaching actions.

The [focused source ledger](research/teaching-controls-followup-sources.json) records 17 public pages from ten established practitioners, ten first-party product examples and three supporting motion/accessibility pages. The ten practitioners are Don Norman, Jakob Nielsen, Steve Krug, Luke Wroblewski, Jared Spool, Brad Frost, Julie Zhuo, Aarron Walter, Jenifer Tidwell and Jonas Schmedtmann. This is a selected study list, not an objective ranking. Jonas's public curriculum was reviewed; paid lessons were not watched.

Relevant product precedents were read in first-party documentation: FigJam, Miro, Zoom Whiteboard, Lessonspace, Explain Everything, Google Meet, Microsoft Teams, Canva, Notion and Linear. These verify described interface patterns, not superiority, tutoring outcomes or a full live usability evaluation of those products. Use their separation of board tools, materials, call controls and settings as references; do not copy their professional-interface density into the student's view.

| Practitioner or educator | Principle applied to this workspace |
| --- | --- |
| [Don Norman](https://jnd.org/signifiers-not-affordances/) | Make the available action apparent before activation. |
| [Jakob Nielsen](https://www.nngroup.com/articles/ten-usability-heuristics/) | Keep important state visible; use recognizable language and clear exits. |
| [Steve Krug](https://sensible.com/you-say-potato-i-say-focus-group/) | Observe tutors performing tasks, rather than judging screenshots alone. |
| [Luke Wroblewski](https://www.lukew.com/ff/1945/obvious-always-wins) | Keep major actions discoverable when simplifying for mobile. |
| [Jared Spool](https://archive.uie.com/brainsparks/2012/12/12/jared-spool-the-secret-lives-of-links/) | Labels should suggest the path to the tutor's goal. |
| [Brad Frost](https://bradfrost.com/blog/post/revisiting-the-priority-pattern/) | Expose priorities, then place the remainder in clearly marked overflow. |
| [Julie Zhuo](https://lg.substack.com/p/the-looking-glass-the-craft-of-creating) | Define the teaching journey and observable success before choosing components. |
| [Aarron Walter](https://alistapart.com/article/personality-in-design/) | Warmth supports a reliable workflow; personality must not interfere. |
| [Jenifer Tidwell](https://www.mit.edu/~jtidwell/common_ground_onefile.html) | Keep frequent actions near the working surface and preserve useful state. |
| [Jonas Schmedtmann](https://www.udemy.com/course/design-and-develop-a-killer-website-with-html5-and-css3/) | Use color, typography, spacing and proximity to build hierarchy. |

| Product reference | Useful documented pattern |
| --- | --- |
| [FigJam](https://help.figma.com/hc/en-us/articles/15300412458647-Explore-FigJam-files) | Separate the board, material/file panels and object tools. |
| [Miro](https://help.miro.com/hc/en-us/articles/360017730553-Toolbars) | Distinguish creation, collaboration and canvas navigation. |
| [Zoom Whiteboard](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0061925) | Make object actions contextual and provide clear Fit/zoom navigation. |
| [Lessonspace](https://help.thelessonspace.com/en/articles/15655189-whiteboard-tools-and-features) | Keep teaching resources accessible alongside relevant selected-object actions. |
| [Explain Everything](https://help.explaineverything.com/hc/en-us/articles/4402410058642-Customize-your-Project-Editor-s-interface-and-workspace-layout) | Simplify toolsets by role while preserving basic navigation and recovery. |
| [Google Meet](https://support.google.com/meet/answer/10550593?hl=en) | Retain essential call controls and separate leaving from media toggles. |
| [Microsoft Teams](https://support.microsoft.com/en-us/teams/meetings/use-meeting-controls-in-microsoft-teams) | Keep core call actions stable while disclosing optional configuration. |
| [Canva](https://www.canva.com/help/tools-tab/) | Reveal related choices inside a small set of labeled tool destinations. |
| [Notion](https://www.notion.com/help/navigate-with-the-sidebar) | Group navigation by purpose with explicit collapse and expand controls. |
| [Linear](https://linear.app/changelog/2024-12-18-personalized-sidebar) | Separate daily work from infrequent configuration. |


## Student joining help — November 1, 2026

Returning tutors must be able to prepare without dismissing instructions. Remove automatic grey notices from the tutor's board, including the joining message and the hand-pointing tip. Keep the lesson code and Copy lesson link visible.

- Show the short joining hint inline below the header, outside the board, only on its first confirmed display in this browser. Remember presentation even without dismissal; a reload or another lesson must not show it again. Withhold it in landscape below 500px high to preserve board space; rotation to portrait may show the still-unseen hint. Storage restrictions limit this memory to the current page.
- Got it dismisses the hint and returns keyboard focus to Copy lesson link. Student arrival also removes it without leaving focus on a removed element.
- Keep How students join as an optional disclosure in Lesson controls until the room's first successful student connection. Then remove it for that room, including through a temporary disconnect or reload. Remember the room identity using its key; End session clears that room's join history.
- Use the current host in the instructions and current origin in the copied link. Local lesson codes must not direct students to the production server.

Validation: production build and 18 focused tests pass. Actual isolated tutor/student WebSockets verified dismissal with Enter, reload both with and without dismissal, a new lesson, first student arrival, disconnect and reload. The hint does not repeat; joining help disappears after connection and stays gone for that room. Removing a focused Got it returns focus to Copy lesson link; removing an open, focused joining disclosure returns focus to Lesson controls. Tested QA pages logged no console errors.

Rendered 1440×900 desktop, 768×1024 tablet, 393×852 phone and narrow 320×640 states have no horizontal overflow. The hint stays outside the board and Got it meets the 44px target. At fresh 740×390 landscape the hint is withheld, leaving 184px of board height instead of 123px; rotating to 320px-wide portrait correctly presents it once. These checks do not establish physical-device touch, screen-reader behavior, 200% text enlargement or measured Core Web Vitals.

The following scores review this change only. They are conservative internal design heuristics, not measured product-quality results.

| Dimension | Score | Evidence or next action |
| --- | --- | --- |
| Visual hierarchy | 9/10 | The working board stays clear; optional joining help is secondary to teaching controls. |
| Usability | 9/10 | Repeat visits, new lessons and the join/disconnect/reload lifecycle avoid repeated instructions while retaining help before the first join. |
| Aesthetics | 9/10 | The inline hint uses existing purple, spacing and typography rather than another floating surface. |
| Interaction design | 9/10 | Enter dismissal and student-arrival removal restore focus to the appropriate stable header control. |
| Responsiveness | 9/10 | Phone, tablet, desktop, narrow portrait and short landscape inspected; landscape deferral preserves board space and rotation retains first-use behavior. |
| Accessibility | 8/10 | Native buttons/disclosure, visible focus and 44px dismissal target; next test screen-reader output and 200% text enlargement. |
| Performance | 8/10 | No new dependency or network request for help; measure LCP, INP and CLS rather than claiming Core Web Vitals compliance. |
| Product coherence | 9/10 | Code/copy stay available, optional help belongs in Lesson controls, and local instructions match the running host. |

Next prioritize screen-reader and 200% text-enlargement checks, then physical-device touch and performance measurement. Browser-sized checks do not replace those validations.

## Tutor-controlled teaching pieces — November 1, 2026

The tutor rejected automatic worksheet deployment and the resulting camera changes. A premade lesson must support teaching with separate words, letters, pictures and reading strips, rather than enlarge a complete worksheet for the student. Opening an activity or using Previous/Next prepares its board page, letter tiles and sound boxes only. It does not import a picture or worksheet, fit a sheet, or send a reading-focus command to the student. Existing page work remains intact.

Teaching pieces sits in the Tutor guide before the directions. Review activities offer relevant existing mouth/sound families, using public letter tiles and explicit card choices rather than private targets. Read activities offer their prepared sources. Dictation never turns private answers into picture suggestions. Choose parts opens a tutor-only preview; it does not upload or place the complete source merely because the preview opens.

- The four existing short-a source images provide 26 named selections, checked against their exact SHA-256 and 1600×1700 dimensions. These include the short-a cue, apple, mouth photograph and diagram, instruction fragments, model and practice words, individual m/a/t letters, three sound boxes, four reading strips, and mat/map pictures and labels. A changed or unrelated image gets no guessed preset coordinates.
- Letter selections create native letter tiles; the sound-box selection uses native shared sound boxes. Words, sentences, photographs and diagrams become individual crop pieces. Magic Select and Draw a box remain available for any other part. Do not describe raster crops as editable native text.
- The tutor explicitly adds each selected piece. Size it to the current visible board area and preserve the camera. Keep the source chooser open for several additions. Prepared-source mode hides whole-page addition.
- An uploaded crop backing is classified as `lesson-source` and excluded from student Pictures and Worksheets lists. The chosen piece still references source image bytes; this classification and crop are presentation controls, not cryptographic privacy or secure redaction.
- The contextual toolbar's X and Escape deselect the current object and dismiss its controls without deleting it. Stop toolbar pointer input from restarting board gestures; return keyboard focus to the board when dismissal removes the focused toolbar.

This work reuses the existing illustrations and library cards. It does not republish a template, overwrite immutable originals, or modify a tutor's saved custom preparation.

Verification: the production build and the full suite of 683 tests in 81 suites pass. Actual browser checks verified an individually selected letter crop, a named marked-word crop, a separate Map illustration and a Pat sat. sentence strip. Native m/a/t tiles and three sound boxes were added from the source chooser; all three tiles were dragged into the boxes and snapped to the expected shared positions. The exact camera viewBox stayed unchanged across activity activation, source preview and part addition on desktop and tablet. Mouse X and Escape dismissed the contextual toolbar while retaining the piece; Escape left the Tutor guide open. After the first part was added, the prepared backing remained absent from both student Pictures and Worksheets lists, while the chosen strip appeared on the student's board. This confirms the rendered student experience, not secure redaction of backing bytes.

Rendered phone 393×852, tablet 768×1024, and desktop 1440×900 and 2560×1215 states were inspected. On the phone, the native preset selector was exercised, all 11 ready-piece buttons met the 44px target, Add remained visible and there was no horizontal overflow. On tablet, adding păt preserved the exact viewBox. These checks do not establish physical-device touch, screen-reader behavior, 200% text enlargement or measured Core Web Vitals.

These scores apply to this teaching-pieces change only. They are conservative internal design-review heuristics, not measured product-quality results.

| Dimension | Score | Evidence or prioritized follow-up |
| --- | --- | --- |
| Visual hierarchy | 9/10 | The guide holds optional source material and the board holds deliberately selected teaching pieces. |
| Usability | 9/10 | Words, sentence strips, pictures, repeated additions and native tile-to-box snapping were exercised under tutor control. |
| Aesthetics | 9/10 | Reuses the established guide, source editor and board-object styling. |
| Interaction design | 9/10 | Activation, private preview and explicit additions preserve the camera; X/Escape retain the object and Escape leaves the guide open. |
| Responsiveness | 9/10 | Phone, tablet and two desktop layouts inspected; phone Add remains visible, named controls meet the 44px target and no horizontal overflow was found. |
| Accessibility | 8/10 | Named preset buttons and native letter/box controls avoid drag-only input; keyboard dismissal/focus checked. Next test screen-reader output and 200% text enlargement. |
| Performance | 8/10 | Sources reuse bounded existing images and build/tests pass; measure loading, LCP, INP and CLS before making performance claims. |
| Product coherence | 9/10 | The tutor controls pacing and revelation; dictation remains private and existing board mechanics do the work. |

Next prioritize screen-reader and text-enlargement verification, then physical-device touch and performance measurement. Cropping does not replace tutor review of what a chosen piece communicates to the learner.

## Keep existing teaching behavior

The alphabet is a shared pointing reference. Alphabet-to-board pickup was removed at the user's request and must stay removed. Materials creates letter tiles; existing board tiles remain movable when permissions allow. Retain sound-box snapping/counters, shared pointing gloves, picture permissions, student face-size restrictions, upload safeguards, worksheets, layers and zoom. Sidebar navigation must not send lesson mutations or reset a game, media stream or board.

## Verification and tutor review

Automated checks should cover retained whiteboard workflows, per-category search and scroll, inline Games navigation and focus return, a direct mobile Close, and compact idle video. Include both idle video and a simulated active-call layout on short screens. Hit-test visible controls, rather than trusting bounding boxes alone, and inspect screenshots for overlaps between Tools, video, Materials and the board footer. A fake-media browser check or fixture does not establish live WebRTC reliability; keep that scope explicit.

Compare the current and revised layout with tutors through this sequence: start a call, find Lip Biter and add its face, add letters, enable three sound boxes, return to the prior picture search, start a game, change its level, return to materials, then use a worksheet and Magic Select. Record wrong turns, assistance, repeated scrolling and lost state. Include novice and repeat tutors, touch and keyboard users, shorter landscape screens and magnification. Verify the video remains large enough to observe articulation.

The next product milestone after workspace verification is tutor-controlled board pages, followed by saved lesson preparation and private tutor prompts. These are separate changes; this sidebar work does not introduce them.

## Key references

- [NN/g Tabs, Used Right](https://www.nngroup.com/articles/tabs-used-right/)
- [NN/g Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
- [GOV.UK Accordion](https://design-system.service.gov.uk/components/accordion/)
- [Microsoft Fluent Drawer](https://fluent2.microsoft.design/components/web/react/core/drawer/usage/)
- [NN/g Carousels on Mobile](https://www.nngroup.com/articles/mobile-carousels/)
- [W3C Keyboard Interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
- [W3C Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- [Jonas Schmedtmann HTML and CSS course](https://www.udemy.com/course/design-and-develop-a-killer-website-with-html5-and-css3/)
