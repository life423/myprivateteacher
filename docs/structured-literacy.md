# Structured-literacy teaching requirements

Recorded October 29, 2026. Read this before changing teaching tools, articulation cards, sound boxes, or lesson preparation. This records verified teaching principles, the user's requirements, and inspected source behavior separately. It is not a curriculum manual or a claim that this app has validated intervention outcomes. The [source ledger](research/structured-literacy-sources.json) records what was actually read and its limits; [workspace decisions](teaching-workspace.md) cover interaction design.

## Teaching principles to preserve

Teach concepts directly, model the task, offer guided practice, and give specific feedback. Follow a planned progression, revisit earlier learning, and let the tutor adjust pace and practice from student responses. Structured literacy includes sound awareness and spelling relationships as well as syllable patterns, meaningful word parts, sentence structure, vocabulary and comprehension. An app of mouth cards and games alone is not a complete reading intervention. These are instructional principles; “diagnostic and responsive” teaching does not authorize the app to diagnose a child. [International Dyslexia Association](https://dyslexiaida.org/structured-literacy-effective-instruction-for-students-with-dyslexia-and-related-reading-difficulties/)

Support both reading and spelling, plus connected-text practice. The IES guide gives strong evidence ratings to sound-awareness/letter-linking instruction and decoding/word-writing instruction, and a moderate rating to daily connected-text reading. Its principal scope is kindergarten through grade 3; it does not validate this app or prescribe a proprietary curriculum. [IES/What Works Clearinghouse recommendations](https://ies.ed.gov/ncee/wwc/PracticeGuide/21)

The user's program reference is **Take Flight from Scottish Rite for Children in Dallas**, not Scottish English pronunciation. Scottish Rite describes a two-year intervention involving trained Academic Language Therapists and phonemic awareness, phonics, fluency, vocabulary and comprehension. Our original materials and tools must not be called official Take Flight materials, certified, endorsed, or equivalent to that intervention. The public description is not permission to reconstruct its lesson sequence or assessments. [Scottish Rite program description](https://scottishriteforchildren.org/services/dyslexia/), [program-owner research summary](https://scottishriteforchildren.org/wp-content/uploads/2025/05/Research-at-Glance-rev-2025_Take-Flight.pdf)

## Sounds, print and sound boxes

A **phoneme** is a speech-sound unit; a **grapheme** is its written representation, which can contain several letters. A digraph such as **sh** represents one sound; a blend such as **st** retains separate sounds. Sound boxes have **one box per phoneme**, not one per letter or tile. Counters can represent sounds before print is introduced; later the appropriate letter or letter combination can occupy a box. [UFLI glossary](https://ufli.education.ufl.edu/resources/teaching-resources/glossary/)

Use these as product test examples in the app's stated American English model:

| Word | Sound units, written here with familiar phonics labels | Boxes | Why |
| --- | --- | --- | --- |
| cat | /k/ /a/ /t/ | 3 | Three sounds and three letters. |
| ship | /sh/ /i/ /p/ | 3 | The two letters sh spell one sound. |
| stop | /s/ /t/ /o/ /p/ | 4 | The initial blend contains two sounds. |
| box | /b/ /o/ /k/ /s/ | 4 | The letter x represents two sounds here. |

These examples illustrate the rule; phonics labels in this table are not IPA transcriptions. Keep letter names, phonics labels and IPA distinct in data and interface text. Do not derive the answer from string length, tile count, or the number of characters in an IPA symbol.

A useful tutor-controlled routine is: say a familiar word, have the learner repeat it, segment it with counters, then blend it. Map the sounds to taught spellings as appropriate, and connect that practice to reading and writing. Oral practice and mapping should support one another; do not require mastery of every oral task before allowing print. The IES examples use counters or letter tiles according to familiarity, then written letters. [IES guide, printed pages 17–20](https://ies.ed.gov/ncee/WWC/Docs/PracticeGuide/wwc_foundationalreading_040717.pdf#page=23)

App requirements:

- The tutor chooses the number of boxes and when to reset, reveal print or move on. Current `shared/soundBoxes.js` explicitly avoids inferring count from letters.
- Keep a multiletter grapheme, such as sh, usable as one tile. Allow a letter such as x to be discussed as more than one sound without silently changing the box count.
- Do not split a diphthong into two boxes merely because its mouth position moves. Conversely, the current **Yoo (long U)** reference is explicitly a sequence of IPA /j/ (the y in yes) plus /u/; its card count cannot determine phoneme count. Vowel-r analyses and pronunciations need the tutor's stated model.
- Counters, reset, tile placement and error recovery need tap/keyboard alternatives; dragging is an optional interaction, not a learning prerequisite. Alphabet-to-board dragging was removed at the user's request; do not restore it as part of teaching improvements.

## Articulation cues and audio

Teach what the lips, tongue, airflow and voice are doing, rather than treating a photograph as the sound itself. Related consonants can share visible placement while differing in voicing. Nasals such as /m/, /n/ and /ng/ must remain distinguishable from oral stops, even when a grouped card shares a face photograph. [Reading Universe consonant pairs](https://readinguniverse.org/skill-explainer/articulation-pronunciation/articulation-skill-explainer/how-to-teach-articulation-consonant-pairs), [UC Irvine consonant reference, pages 1–4](https://ocw.uci.edu/upload/files/consonants.pdf)

Model isolated consonants without adding an unintended “uh.” A recording of “buh” must not stand in for isolated /b/ in a blending exercise. Continuous sounds can be sustained; do not elongate a stop by attaching a vowel. This is distinct from teaching **schwa** as an actual unstressed vowel in a word. [IES guide, printed page 31](https://ies.ed.gov/ncee/WWC/Docs/PracticeGuide/wwc_foundationalreading_040717.pdf#page=37), [UFLI blendable-sound definition](https://ufli.education.ufl.edu/resources/teaching-resources/glossary/)

Audio is still a content task, not an assumed completed asset set. Use tutor modeling initially. Any future recorded or synthesized examples need competent review for the intended phoneme, word, stress and accent before being labeled teaching models; fluent text-to-speech does not establish correct isolated phonemes. Store an audio asset's source, target, accent and review status. Do not introduce automatic speech scoring or child diagnostic predictions as a shortcut.

Mouth shape varies between speakers, especially for vowels. A static external photograph cannot establish hidden tongue placement, voicing, airflow, stress or an entire glide. Keep explanations and diagrams accurate, and preserve movement cues without requiring a second photograph. [Reading Universe articulation demonstration](https://readinguniverse.org/resources/interactive/articulation-pronunciation/articulation-interactive), [vowels and diphthongs](https://readinguniverse.org/skill-explainer/articulation-pronunciation/articulation-skill-explainer/how-to-teach-articulation-vowels-diphthongs-vowel-r)

The current data uses General American examples. Label accent-sensitive targets rather than treating a learner's home pronunciation as a deficit. Examples include cot/caught and /aw/, /w/ versus /wh/, and r-colored vowels. The card metadata already records several of these distinctions. Do not demand an exaggerated smile or one fixed visible mouth shape as proof of correct speech. [UC Irvine vowel reference, pages 1–5](https://ocw.uci.edu/upload/files/vowels.pdf), [consonant reference, page 5](https://ocw.uci.edu/upload/files/consonants.pdf), [Reading Universe dialect guidance](https://readinguniverse.org/skill-explainer/articulation-pronunciation/articulation-skill-explainer/articulation-and-students-who-speak-african-american-english)

## The actual card inventory and format

**The normal grouped export is 28 cards: 16 existing families plus 12 additions.** This was confirmed by importing the local data/export functions on October 29, 2026. It is not a fresh count of live Cosmos records or Blob objects.

| Existing family title | Current sound labels |
| --- | --- |
| Lip Popper | p, b, m |
| Lip Biter | f, v |
| Tongue Peeker | th, dh: think / this |
| Tongue Tapper | t, d, n |
| Snake Sound | s, z |
| Tongue Lifter | l |
| Quiet Sound | sh, zh |
| Chomper | ch, j: jump |
| Back Tongue Sound | k, g, ng |
| Breathy Sound | h |
| Lip Rounder | w |
| R Sound | r |
| Y Sound | y: yes |
| Smile Vowel | ee, i, e |
| Open Mouth Vowel | a, ah, o |
| Round Vowel | oh, oo: moon |

| Addition in export order | Example | Data ID |
| --- | --- | --- |
| Short U | cup | short-u |
| Long I | pie | long-i |
| Yoo (long U) | cube | long-u |
| Book OO | book | book-oo |
| Aw | saw | aw |
| Schwa | first a in about | schwa |
| Ar | car | ar |
| Er | bird | r-vowel |
| Or | corn | or |
| Oi / Oy | boy | oy |
| Ow | cow | ow |
| Long A | cake | long-a |

Source of truth: [`articulationCards.js`](../src/data/articulationCards.js), [`phonemeArticulation.js`](../src/data/phonemeArticulation.js), and [`phonemeExport.js`](../src/articulation/phonemeExport.js). The grouped coverage test maps the older phonics labels to the reference IDs: ah and short o share /ɑ/ in this model. A broad family is a placement aid, not a claim that all its vowels have identical articulation. Do not duplicate a target merely to give it another title.

The separate **47-entry developer reference** contains 40 core targets, six teaching sequences and one dialect target. It is not the production library size or a universal phoneme analysis. `--all-sounds` is an explicit reference export and must not be imported alongside the grouped deck. Counts depend on accent and analysis; “about 44 sounds” is not a requirement for 44 different photographs. [UFLI's differently organized sound-wall set](https://ufli.education.ufl.edu/wp-content/uploads/2023/09/UFLI-Sound-Wall-rev.pdf) is a comparison resource, not this app's manifest or the Take Flight chart.

The user's visual contract is the existing common frame: white card, rounded aqua title band, **one** consistently framed face photograph on the left, a concise instruction, **one** anatomical diagram, and sound/example text on the right. All cards use the same hierarchy and proportions. Do not add a second face for a glide. Do not use title separators such as **Long I — pie**; the title is Long I and the example belongs in the sound text. This does **not** prohibit phonics marks such as ā and ă.

Keep real thumbnails throughout the library and a direct **Add face** action. Keep full-card inspection, Magic Select and manual box selection. Magic Select must support meaningful card regions beyond the face; it is a cropping/selection tool, not phoneme recognition. Keep completion actions visible in the viewport. Add items at a manageable size in clear space and expose overlaps/layers. A student may move a face when permitted but must not resize it. Preserve the library's search and scroll position; bulk sharing must never be required to let a tutor open it. These are product requirements from the user, not claimed treatment effects.

### Asset storage and verification

The inspected pipeline is local source photographs plus original diagrams → shared SVG card frame → rendered JPEG and CSV metadata → a picture record in Cosmos DB's Mongo API and image bytes in private Azure Blob Storage. Preserve this arrangement rather than making a second production catalog or putting large image bytes into account records. See [`ArticulationCard.jsx`](../src/articulation/ArticulationCard.jsx), [`PhonemeArticulationCard.jsx`](../src/articulation/PhonemeArticulationCard.jsx), [`server/library.js`](../server/library.js), and [`import-library.mjs`](../scripts/import-library.mjs).

Stable card IDs, image hashes and import preflight protect against duplicate/ambiguous entries; titles alone are insufficient. Shared source photographs are legitimate when external posture is shared, while duplicate complete card entries are not. Existing generation provenance is in [`phoneme-generation.json`](../src/assets/articulation/photos/phoneme-generation.json). AI-generated appearance is not evidence of articulatory correctness: review the photograph, text, diagram, target, accent and example together. Preserve provenance and region metadata when replacing an asset. Do not report a cloud import or duplicate-free live database unless it was actually checked.

## Tutor's handwritten terminology

The user supplied a dyslexia tutor's handwritten note in this conversation. The original temporary image is no longer present on disk. The following legible labels are notes to reconcile with the current families, **not verified official Take Flight terminology**:

| Written sounds | Legible label |
| --- | --- |
| p, b | lip burst |
| k, g | back tongue tap |
| th, th | tongue slider |
| f, v | lip biter |
| m, n, ng | hums (front, middle, back) |
| s, z | teeth stream |
| sh, zh | air pusher |
| ch, j | air burst |
| y, w, h | whispers; annotations include y = riser, w = rounder |
| l, r | tongue shapers; l = raiser, r = bender |
| vowel group headings | smiling; open; round |

Unresolved: the final word in the t/d “tongue …” label, the cramped h annotation, the isolated word “scraper” and its association, and the exact vowel symbols/diacritics and their grouping. Confirm before turning these into card titles, diagrams or sound metadata. Do not infer missing phonemes from faint marks. Current Lip Popper and Tongue Tapper also include nasal sounds; if the vocabulary changes, preserve their different airflow instructions rather than calling every grouped sound a burst or tap.

## Tutor-led preparation and student privacy

Implemented as tutor-controlled board pages plus private saved preparation, **not a curriculum or a claim of demand**: the saved lesson tray supports manual ordering and a tutor-only view. Start with the tutor selecting Review, Build words, Dictation and Read activities; preserve each activity's work when using Previous/Next. Let a private **Review next time** flag carry an optional note into preparation. Do not substitute automatic lesson generation for the tutor's scope, sequence and judgment.

| Activity | Tutor prepares | Student receives on activation |
| --- | --- | --- |
| Review | chosen letters or sound/articulation cards | only the selected review material |
| Build words | target list and intended manipulation | deliberately revealed tiles/materials; no automatic target-answer label |
| Dictation | words/sentences, answers and private directions | the writing area and deliberately shared prompts; answers stay private until revealed |
| Read | chosen passage or worksheet | that selected reading material |

Reuse existing account/storage infrastructure when implemented, but store private lesson data under authenticated tutor ownership, separately from the global card catalog and global word bank. A room code/key is not authorization to read saved tutor data. Current room-picture metadata and board snapshots are shared with students: never preload private word lists, answers, notes, sensitive file names or the entire preparation tray onto that wire and merely hide them with CSS. Publish an explicit student-safe projection only when activated.

New persistence must also update retention/privacy text and account-deletion cleanup; the current session-only promises cannot silently apply to saved lessons. Save the minimum needed. Private review notes are tutor observations, not automated diagnoses, ability labels or predictions. No child account or child identifying profile is needed just to join a lesson.

## Acceptance checks for the next implementer

- A tutor can model, repeat, correct and revisit work without a game, timer, audio asset or forced automatic progression.
- Sound-box examples distinguish ship (3) from stop (4) and box (4); neither spelling length nor tile count supplies the answer.
- All 28 grouped exports have one photograph, one diagram and matching text in the common frame; no placeholder, clipped example or decorative title/example dash is accepted.
- Check semantic coverage, stable IDs and rendered hashes; do not import the full 47-entry reference as another grouped collection.
- Imported images retain dimensions, provenance and selectable regions. Magic Select and the manual alternative both work without discarding non-face selection.
- Tutor material access, direct Add face, clear-space placement and student resize restrictions remain intact.
- Private lesson fields are absent from every student HTTP/WebSocket message, including reconnect, restoration and page changes; test ownership on the server, not just the tutor interface.
- A trained tutor reviews unfamiliar articulatory content and accent-sensitive examples before publication. Automated layout/coverage checks cannot establish clinical accuracy or improved reading outcomes.

The source review confirmed the local inventory and inspected existing checks; it did not rerun the full app suite, listen to a complete audio library, re-count live storage, or validate all materials with a therapist. Keep those limits visible when reporting readiness.


## Original lesson images

The user explicitly authorized creating original images needed for lessons. Generate new raster teaching visuals when they serve a clear instructional purpose, and inspect them before use. Match the established articulation-card style and required title, one mouth photograph, accurate instructions, diagram and sound labels. Keep the teacher's target and the student's task clear; do not add picture-guessing cues to decoding exercises. Use the existing Azure Blob and Cosmos metadata flow for shared library assets, with provenance and duplicate checks; keep private preparation assets separate until the tutor explicitly shares them. Never substitute an image icon or an unfinished mouth photograph for a complete teaching card.


## Short-a teaching pack coding review (October 29, 2026)

The original illustrated short-a pack uses a **breve above a (ă)** on guided practice only. Reading Universe’s [primary short-vowel reference](https://readinguniverse.org/skill-explainer/phonics-patterns/short-vowels-skill-explainer/an-overview-of-short-vowel-sounds) explicitly defines that mark and its placement. A [school-hosted Take Flight parent overview](https://cdnsm5-ss1.sharpschool.com/UserFiles/Servers/Server_825719/File/Departments/Special%20Programs/Scottish%20Rite%20Hospital_Take%20Flight%20Overview.pdf), indexed PDF page 5, mentions breve and macron but does not provide the full coding key; a direct download returned 404 during this review. This is evidence of referenced marks, not verification of the entire Take Flight coding system. Do not add circled-C, syllable slashes, digraph underlines or am/an coding to this pack by assumption. The words are monosyllabic CVC forms and need only the verified short-vowel mark here.

[Reading Universe’s preparation guidance](https://readinguniverse.org/skill-explainer/phonics-patterns/short-vowels-skill-explainer/prepare-for-short-vowel-instruction) recommends simple CVC targets and treats am/an/all separately. The revised ordinary-print passage uses Pat rather than Sam to avoid that additional pattern; this is a conservative content choice, not a claim that Sam is universally incorrect or that this is Take Flight’s sequence. The apple is a spoken keyword cue, not an untaught printed word the learner must decode. Mat/map illustrations are revealed in a separate meaning activity after decoding. Ordinary letter tiles remain unmarked a; the breve belongs to the guided sheet or a deliberate tutor annotation.

Artwork and coding evidence are recorded alongside `content/lessons/short-a-teaching-pack/lesson.json`. The mouth photo/diagram reuse existing sources rather than adding duplicate library cards. New illustration generation does not establish educational effectiveness; original text, marks, visual layout, scope and privacy require separate checks.
