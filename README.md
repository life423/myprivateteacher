# My Private Teacher 🎯

Reading activities for learners with dyslexia, live at https://myprivateteacher.com.

- **Phoneme Pop** (`/phoneme-pop`): hear a word, split it into its sounds, and put the sounds back in order.
- **Alphabet Whiteboard** (`/whiteboard`): a live tutoring space. The tutor starts a session and gets a 4-digit code. The student joins with it and moves a cartoon hand over an alphabet strip while the tutor watches it move in real time.

## Develop

```bash
nvm install      # Node 24, matching CI and the production container
nvm use
npm ci
npm run dev      # starts both the .env-aware backend :8080 and Vite :3000
npm run build    # production build in dist/
npm test         # game logic, whiteboard geometry, realtime rooms, web server (build first)
```

Open http://localhost:3000. `npm run dev` starts the API/WebSocket backend before Vite and stops both on Ctrl+C. It refuses to start if either development port is occupied, so a different app cannot silently receive picture, account, or room requests. For separate terminals, use `npm run server` and `npm run dev:client` instead.

For the shared picture library, keep `MONGODB_URI` and `AZURE_STORAGE_ACCOUNT` in the local `.env`, then run `az login`. Blob Storage uses your Azure CLI identity locally; that identity needs Blob data access. Cosmos DB also needs to allow your current public IP. If the first database connection fails, the server retries that connection with a bounded backoff; it does not replay account writes. A verified Google identity whose session cannot be saved receives a temporary service error instead of an invalid-login error. Restart `npm run dev` after changing `.env`. The frontend alone cannot serve picture or account requests. Vite forwards `/auth` as well as `/api` and `/ws`, preserving the browser host for session cookies and same-site checks. Local HTTP pages use Google’s popup/referrer headers; production response headers are configured separately.

For local Google sign-in, the OAuth web client used by `GOOGLE_CLIENT_ID` must authorize `http://localhost` and `http://localhost:3000` under Authorized JavaScript origins in Google Cloud Console. An `origin_mismatch` error means the browser origin is not registered there. The existing popup credential flow needs no localhost redirect callback URL. The backend still verifies Google ID tokens before creating an account session. For a temporary local whiteboard-only preview while OAuth is unavailable, stop the existing dev process and run `STRIPE_SECRET_KEY= npm run dev`; this leaves `.env` untouched and disables the lesson billing/sign-in gate only for that launched process. Restart with normal `npm run dev` to restore the configured gate. It does not create a signed-in tutor or unlock account/admin features.

## Run the production container locally

```bash
docker compose up --build             # http://localhost:8080
npm run smoke -- http://localhost:8080   # a tutor and a student make a round trip over /ws
```

The image builds the client, runs the tests (a failing test fails the build), and serves everything from one small Node server, `server/index.js`. It handles long-lived caching for hashed assets, gzip, security headers, redirects from www and the Azure hostname to https://myprivateteacher.com, and the whiteboard's WebSocket endpoint at `/ws`.

## Alphabet Whiteboard

The shared picture catalog keeps the 16 original mouth-position families and adds 12 missing vowel/sequence cards, for 28 main cards. Every card uses one mouth photo and one anatomy diagram in the same layout. Glide instructions and a single-diagram motion cue describe moving sounds. A developer reference inventory tracks individual sounds and optional accent/sequence targets separately; it is not an official Take Flight deck. The source inventory and references are in `src/data/phonemeArticulation.js`.

The Games tab is the single game chooser. Its active game moves first in DOM and keyboard order, with playing controls before setup options, and remains at the top when the panel reopens. The drawing toolbar contains only board tools. On the landing page, Join a lesson expands in place into a single field for the tutor’s four-digit code. Header and menu join links open the same control; students do not need an account or a separate joining page.

Render only the 12 additions with `node scripts/render-phoneme-articulation.mjs <output-folder> <local-site-url>`, review the exports, and preview the import with `npm run import-library -- <output-folder> --dry-run`. Each card has a stable ID and image hash. Library search supports sound, IPA and keyword. The optional `--all-sounds` export is a developer reference, not an additional catalog to import alongside the grouped cards. The existing room limit remains 32 library cards plus eight uploads.

Both screens draw the same fixed 1600 x 1000 stage, scaled to fit, so a point on a 27-inch monitor is the same point on an iPad. The student's device works out which letter is under the fingertip and sends it with the position as 0-1 coordinates, about 30 times a second, newest position wins. On touch screens the fingertip sits a little above the finger so the child can still see the letter.

`server/realtime.js` keeps rooms in memory, with one tutor and one student each. A room closes a minute after the tutor leaves. Both sides reconnect on their own, and the tutor gets the same code back after a deploy. Join attempts are rate-limited per IP, and only this site's pages can open a connection.

Because rooms live in memory, the Container App runs exactly one replica.

Tools: the tutor has their own hand (a blue glove), a blue pen, an eraser, undo and a two-tap clear, and can drag the student's hand to guide it. The student's toolbar (hand, black pen, eraser, undo) appears only while the tutor has Student tools switched on, and the server enforces that. The board is one ordered list of strokes: ink sits on two layers so the student's eraser can't touch the tutor's writing, and each person's undo only takes back their own strokes. After a restart, the tutor's browser hands the board back to the server.

Letter tiles: the tutor types tiles into the bar under the board (spaces separate them, so sh stays one tile), and they line up on a tray along the bottom. Both people can drag them; whoever is dragging a tile holds it until they drop it. The tutor can delete a tile, click one to change its letters (for word chains like map, mat, sat), send them all back to the tray, or clear them, and can turn on 2 to 5 sound boxes that tiles snap into. Tiles are coloured by kind (vowel, consonant, letter team), stored on each tile so a different scheme can be added later. The tutor can also hide the alphabet strip for both screens; the board grows into its space without moving anything. Tile rules and geometry live in shared/tiles.js, used by both the browser and the server.

## Video calls

The whiteboard has a one-to-one video call in a collapsible panel beside the board. Camera and microphone stay off until each person clicks Start video. The room's WebSocket carries only the call setup (`rtc:*` messages, relayed between the two people in a room); audio and video go directly between the browsers, never through the app server. The client uses the perfect-negotiation pattern, with the student as the polite side.

When a direct connection isn't possible (strict school or office networks), the call goes through our own TURN relay on Azure:

- Resource group `myprivateteacher-turn` (South Central US): a Standard_B1ls Ubuntu 24.04 VM running coturn, a static public IP with the free hostname `myprivateteacher-turn.southcentralus.cloudapp.azure.com`, and a network security group that only opens the TURN ports (3478 UDP/TCP, 443 TCP for TURN over TLS, relay ports 49152-49252 UDP, and 80 for certificate renewal). There is no SSH; manage it with `az vm run-command`. Roughly $9-10 a month, with a $15 monthly budget alert on the resource group.
- `infra/turn/create.sh` creates it and `infra/turn/setup-vm.sh` configures coturn (a free Let's Encrypt certificate that renews itself, security updates on, no relaying into private networks, per-user and bandwidth caps).
- The app signs a short-lived TURN login for each call with a secret it shares with the relay (the TURN REST API scheme). `scripts/set-turn-secret.sh` creates that secret and installs it on both sides without printing it; run it again to rotate it.
- App settings: `TURN_HOST`, `TURN_SECRET` (a Container App secret) and `TURN_TLS`. Without a secret the app offers STUN only.

Check the relay: `az vm run-command invoke -g myprivateteacher-turn -n turn --command-id RunShellScript --scripts 'systemctl status coturn --no-pager | head -5'`

## Pictures and Magic Select

The tutor adds worksheets or pictures in the Pictures tab beside the board (Upload picture, or paste an image). The browser shrinks each one to at most 1600px as a JPEG before sending it. Pictures live only in the server's memory, for that room: no database and no disk, and they're gone when the session ends or the tutor removes them. `POST /api/rooms/:code/pictures/:id` needs the tutor's room key, and the server checks the bytes really are a JPEG, PNG or WebP. Limits: eight uploaded pictures plus 32 library cards per room, 1.5 MB each, 200 MB across all rooms.

The instructor can open the full picture library before sharing any cards. Add face uses the exact curated mouth-photo crop and finds clear space near the visible board. View card and the card thumbnail open a private, read-only preview; they do not add a session picture or share it with the student. The source image is copied into the lesson only after an explicit add, Show student, Give to student or Give all action. Concurrent additions of the same card share one source image. Loading failures offer Retry, and the catalog reloads after reconnecting.

Adding normally closes the library. Ctrl-click or Command-click keeps it open for more additions; Keep library open provides the same option on touch screens. Search, collection and catalog scroll position survive closing, reopening and returning from a preview, using per-tab session storage. The student can dismiss their drawer by tapping the empty background below its white card panel; gaps between cards and the strip below the header remain inactive.

Opening a picture keeps Magic Select, Draw a box and the add actions visible beside the complete preview. Add face takes the mouth, while Add whole card preserves the complete teaching card. Parts glow on hover and a tap selects one. Add selected part finds clear space; an explicit drag keeps the chosen drop position. For tutors, Magic Select analyzes the entire card so headings, instructions, diagrams and sound labels can be selected too. A predefined mouth-photo region refines the photo crop without hiding the other parts. Student permissions still come only from predefined mouth regions and explicit tutor offers. Uploaded pictures use the same part finder described below. The part finder (`src/whiteboard/regions.js`) runs in the browser with no libraries. It takes the most common colour as the paper, groups everything else into pictures (exactly as drawn, so neighbours only merge if they touch) and blocks of text (small gaps bridged), and keeps a photo's rounded corners. Draw a box is the manual fallback.

A piece on the board is a window onto its picture (`shared/pieces.js`), so the picture stays whole and the same part can be copied again. With Watch or Hand, click a piece to move it, resize it from its handles (it keeps its shape), duplicate it or delete it. Pieces sit under the ink, so you can write on them, and they sync and lock like letter tiles. New copies reserve clear space even during rapid additions. Amber outlines and the Layers count identify overlaps; the front-to-back list can select covered pictures and move them to Front or Back. The Layers control sits below the internal alphabet instead of covering its letters. The student can always move pieces. The tutor decides what the student may lift out: select a part and tap Give to student. The student sees every picture the tutor adds, with the parts given to them bright and the rest dimmed, and while their tools are on they can take each one once; the server holds them to it and hands over exactly the part given. Let them take it again resets a part. Predefined library regions may be copied repeatedly while student tools are on; explicit tutor offers remain once-only until reset. With tools on the student can resize uploads and other card parts, but library faces and crops contained in their trusted mouth region retain their size. The server enforces that restriction on initial copies, moves and drops; the teacher can still resize faces. Only the tutor adds pictures, duplicates and deletes pieces. If the server restarts mid-session, the tutor's browser sends its pictures back up before the board.

## Content notes

- Words live in `src/data/wordLists.js`. In `display`, vowels carry a breve (short) or macron (long), and `[brackets]` mark letters that make one sound together; they render underlined.
- Keyword pictures live in `src/data/phonemeSymbols.js`. A picture's name should start with its sound, and no picture should stand for two different sounds.
- Text-to-speech is used for whole words and feedback only. Single sounds need recorded clips, because TTS reads a lone letter by its name.

## Deploy

Azure Container Apps: `phoneme-pop` in the `portfolio-apps` resource group. `.github/workflows/deploy.yml` runs the tests on every pull request. Pushes to `main` build the image (tagged with the commit), deploy it, wait until https://myprivateteacher.com/version.txt reports that commit, then run the realtime smoke test against the live site.

Repo secrets: `PHONEMEPOP_AZURE_CLIENT_ID`, `PHONEMEPOP_AZURE_TENANT_ID`, `PHONEMEPOP_AZURE_SUBSCRIPTION_ID` (OIDC sign-in, no password), `DOCKERHUB_USERNAME`, and `DOCKERHUB_TOKEN`.
