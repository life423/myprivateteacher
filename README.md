# My Private Teacher 🎯

Reading activities for learners with dyslexia, live at https://myprivateteacher.com.

- **Phoneme Pop** (`/phoneme-pop`): hear a word, split it into its sounds, and put the sounds back in order.
- **Alphabet Whiteboard** (`/whiteboard`): a live tutoring space. The tutor starts a session and gets a 4-digit code. The student joins with it and moves a cartoon hand over an alphabet strip while the tutor watches it move in real time.

## Develop

```bash
npm install
npm run server   # Node server, loads .env, http://localhost:8080
npm run dev      # in a second terminal: http://localhost:3000 (proxies /api and /ws)
npm run build    # production build in dist/
npm test         # game logic, whiteboard geometry, realtime rooms, web server (build first)
```

For the shared picture library, keep `MONGODB_URI` and `AZURE_STORAGE_ACCOUNT` in the local `.env`, then run `az login`. Blob Storage uses your Azure CLI identity locally; that identity needs Blob data access. Cosmos DB also needs to allow your current public IP. Restart the Node server after changing `.env`. The frontend alone cannot serve picture or account requests.

## Run the production container locally

```bash
docker compose up --build             # http://localhost:8080
npm run smoke -- http://localhost:8080   # a tutor and a student make a round trip over /ws
```

The image builds the client, runs the tests (a failing test fails the build), and serves everything from one small Node server, `server/index.js`. It handles long-lived caching for hashed assets, gzip, security headers, redirects from www and the Azure hostname to https://myprivateteacher.com, and the whiteboard's WebSocket endpoint at `/ws`.

## Alphabet Whiteboard

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

The tutor adds worksheets or pictures in the Pictures tab beside the board (Add picture, or paste an image). The browser shrinks each one to at most 1600px as a JPEG before sending it. Pictures live only in the server's memory, for that room: no database and no disk, and they're gone when the session ends or the tutor removes them. `POST /api/rooms/:code/pictures/:id` needs the tutor's room key, and the server checks the bytes really are a JPEG, PNG or WebP. Limits: 8 pictures per room, 1.5 MB each, 200 MB across all rooms.

Opening a picture shows Magic Select: parts glow on hover, a tap selects one, and dragging it drops a copy onto the board (Add to board places it in the middle). The part finder (`src/whiteboard/regions.js`) runs in the browser with no libraries. It takes the most common colour as the paper, groups everything else into pictures (exactly as drawn, so neighbours only merge if they touch) and blocks of text (small gaps bridged), and keeps a photo's rounded corners. Draw a box is the manual fallback.

A piece on the board is a window onto its picture (`shared/pieces.js`), so the picture stays whole and the same part can be copied again. With Watch or Hand, click a piece to move it, resize it from its handles (it keeps its shape), duplicate it or delete it. Pieces sit under the ink, so you can write on them, and they sync and lock like letter tiles. The student can always move pieces. The tutor decides what the student may lift out: select a part and tap Give to student. The student sees every picture the tutor adds, with the parts given to them bright and the rest dimmed, and while their tools are on they can take each one once; the server holds them to it and hands over exactly the part given. Let them take it again resets a part. With tools on the student can also resize their pieces. Only the tutor adds pictures, duplicates and deletes pieces. If the server restarts mid-session, the tutor's browser sends its pictures back up before the board.

## Content notes

- Words live in `src/data/wordLists.js`. In `display`, vowels carry a breve (short) or macron (long), and `[brackets]` mark letters that make one sound together; they render underlined.
- Keyword pictures live in `src/data/phonemeSymbols.js`. A picture's name should start with its sound, and no picture should stand for two different sounds.
- Text-to-speech is used for whole words and feedback only. Single sounds need recorded clips, because TTS reads a lone letter by its name.

## Deploy

Azure Container Apps: `phoneme-pop` in the `portfolio-apps` resource group. `.github/workflows/deploy.yml` runs the tests on every pull request. Pushes to `main` build the image (tagged with the commit), deploy it, wait until https://myprivateteacher.com/version.txt reports that commit, then run the realtime smoke test against the live site.

Repo secrets: `PHONEMEPOP_AZURE_CLIENT_ID`, `PHONEMEPOP_AZURE_TENANT_ID`, `PHONEMEPOP_AZURE_SUBSCRIPTION_ID` (OIDC sign-in, no password), `DOCKERHUB_USERNAME`, and `DOCKERHUB_TOKEN`.
