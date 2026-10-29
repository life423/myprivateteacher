# Teaching requirements

Research baseline reviewed 28 October 2026. These are product requirements and an audit backlog, not a completed curriculum or evidence that this app improves reading outcomes.

## Instructional basis

Use explicit, planned teaching with cumulative practice and adjustments based on a learner's responses. Reading, spelling, oral language and meaning must connect rather than become unrelated games. IDA emphasizes integrated instruction and teacher knowledge; there is no single required sequence for every learner. [IDA definition and rationale](https://dyslexiaida.org/wp-content/uploads/2025/12/8_SL-Fact-Sheet.pdf).

The Take Flight public summary integrates articulation with decoding and spelling, alongside fluency, vocabulary and comprehension. Its results concern the complete intervention delivered by trained therapists. Our articulation library and generic tools do not constitute that program or inherit its evidence. Support tutors' authorized materials and chosen sequences; do not label an invented sequence official Take Flight. [Scottish Rite summary](https://scottishriteforchildren.org/wp-content/uploads/2024/08/Take-Flight-Research-Summary-2020-1.pdf).

IES recommends linking speech sounds to print, decoding and writing words, and connected-text reading in K–3. Its separate grades 4–9 guide includes complex word decoding, purposeful fluency practice and comprehension. Match support and content to the learner rather than treating every dyslexic learner as a beginning reader. [K–3 guide](https://ies.ed.gov/ncee/WWC/PracticeGuide/21), [4–9 guide](https://ies.ed.gov/ncee/wwc/PracticeGuide/29).

UFLI provides a useful comparison for drills, explicit new teaching, word work and text practice. Its published routine is a reference, not a sequence copied into our app. [UFLI overview](https://ufli.education.ufl.edu/foundations/).

## Requirements for our tools

| Teaching task | Product behavior to design and verify |
| --- | --- |
| Hear and analyze sounds | Tutor can give a spoken word, let the learner segment or blend, then reveal print. Supplying answer tiles is scaffolded practice, not an independent segmentation assessment. |
| Map sounds to spelling | Keep phoneme identity separate from written spelling. `ship` has three sounds with `sh` together; `box` has four sounds although `x` is one letter. A spelling can represent more than one sound. |
| Read and spell | Let tutors select taught patterns, build word chains, model and guide practice, then hide the answer for dictation and read-back. Preserve handwriting and paper-based options. |
| Apply learning | Put tutor-selected words, phrases and passages into the same lesson. Include vocabulary and comprehension prompts. Speed alone is not the instructional goal. |
| Review and respond | Record private observations such as independent, prompted and retry, with optional notes. Game score or a completed round must not automatically establish mastery or introduce untaught patterns. |
| Explain visually | Use original, consistent illustrations when they clarify a concept. Check anatomy, labels, examples and sound mappings; attractive generated artwork is not verification of teaching accuracy. |

These interface choices are engineering hypotheses derived from the instructional requirements. Observe trained tutors using them and revise based on that evidence.

## Worked design example: sh

This is an original tool scenario, not a scripted Take Flight lesson. Assume the tutor has selected sh plus previously taught short i and p.

1. Tutor models the target sound and connects it to sh, using an articulation card if helpful.
2. Tutor says ship. With the written answer hidden, the learner segments the word using movable counters. The tutor decides how much support is needed; prefilled boxes reveal the expected sound count.
3. Learner maps the sounds to sh, i and p and blends the word. The sh tile occupies one sound box.
4. Tutor hides the answer for spelling, then asks the learner to read back their own work. Typed tiles and handwriting are different response modes; log which was used.
5. Learner applies the pattern in tutor-selected text containing appropriate taught spellings, then discusses its meaning.
6. Tutor records any prompts or errors privately and chooses what to review next time.

## Current audit and delivery boundaries

- Existing tiles, shared tap counters in 2–5 sound boxes, articulation cards, Magic Select, ink, worksheet images and selected PDF page imports provide manual teaching tools. Sound-box count is chosen by the tutor, not inferred from spelling; a team such as sh can occupy one sound box. They do not yet provide a saved instructional sequence or private dictation workflow.
- Phoneme Pop currently supplies the printed target and answer tokens. Its broad levels and automatic progression need a tutor-selected skill and review model.
- Reviewed source corrections: `box` and `fox` need separate /k/ and /s/ units; `pink`, `bank` and `think` need separate /ng/ and /k/ units. Keep their normal written spellings. `nk` must not be marked as two letters making just one sound. [UFLI sound correspondences](https://ufli.education.ufl.edu/wp-content/uploads/2022/06/UFLI-Scope2.pdf).
- That focused correction is not an audit of every word, pronunciation variant or illustration. A future sound model needs explicit pronunciation and spelling mappings, including voiced/unvoiced th and dialect differences.
- Live tutor speech is sufficient for tutor-led modeling. If recorded sound examples are added, have a qualified tutor check isolated sounds and blending quality before release. Whole-word speech synthesis is not validation of an isolated sound model.
- Private tutor notes and answers must remain out of student API and WebSocket payloads, not just visually hidden.

## Next delivery order

1. Validate a real two-device lesson, including quiet speech, interruptions, student joining and tablet writing. Automated signaling and browser tests do not establish these real-world qualities.
2. Build saved preparation, per-activity board recovery, private tutor prompts and review notes around these requirements.

The reviewed sound-count corrections, video lifecycle repairs and selected-page PDF import are implemented. Continue validating them as the saved lesson workflow is developed.
