# HIUNNI API (Cloudflare Workers) — staging candidate

> **This is not the production backend.** The production source (`HIUNNI_v541_Development.zip`,
> `dist/`, `worker/`, `drizzle/`, the D1 schema and the original 1,881 tests) was not in the handoff
> package. This Worker implements the contract items (F01–F10) against **synthetic data**, so the
> behaviour can be reviewed and reconciled with the real source once it arrives. Do not point it at
> production, and do not migrate production data with it.

Stack: Workers + [Hono](https://hono.dev) · D1 (SQLite) · R2 (private media) · Durable Objects
(WebSocket hubs, hibernation API) · Zod validation · Vitest via `@cloudflare/vitest-plugin`
(tests run inside workerd/Miniflare against real local D1/R2/DO).

## Run

```bash
npm install
cp .dev.vars.example .dev.vars          # set MEDIA_SIGNING_KEY
npm run db:reset:local                  # wipe local D1, apply migrations, load synthetic seed
npx wrangler d1 execute hiunni-db --local --file=seed/demo_journey.sql   # optional: more stores/staff for the 초이스톡 walkthrough
npm run dev                             # API + web prototype on http://localhost:8787
npm test                                # 44 tests
npm run typecheck
```

`npm run dev` also serves the web prototype (`../web/index.html`) at `/`, from the same origin as the
API, so no CORS setup is needed. To point the page at a different API, open it with
`?api=http://host:port`. Synthetic accounts: 테스트A/B/C (`usera`/`userb`/`userc`), 합성 실장 하나
(`manager1`, operator of store 1) and 운영자 (`admin1`). Re-run `db:reset:local` with the dev server
stopped to start over.

Dev login (development only; it returns 404 unless `ENVIRONMENT=development` and `DEV_LOGIN_ENABLED=true`):

```bash
curl -X POST localhost:8787/auth/dev-login -H 'Content-Type: application/json' -d '{"userId":"usera"}'
# → { token } — send as  Authorization: Bearer <token>
```

## Contract status (F01–F10)

| ID | Item | What exists here | Verified by | Still needed (cannot be done without client access) |
|---|---|---|---|---|
| F01 | Cloudflare migration | Worker + D1 schema, bearer sessions, logout, withdraw. **Migration tool** `tools/migrate-members.mjs` (see "F01 member migration"): members, nicknames, withdrawn accounts, Google/Naver links (`oauth_links`, migration 0007), shops → stores + store rooms (업종 grouped, original label kept), latest live status, saved shops, posts/comments/likes (hidden stays hidden), 오픈톡 rooms, members and messages; ids kept; report lists every source table not carried over | tests; `tools/test-migrate-members.mjs` (25 checks on the existing service's own table definitions, incl. photos → covers); dry run on its local preview database (all checks clean) | The client's D1 export; import into a new database on the client's Cloudflare account (photos first, then members); Peter's decisions on the tables not carried over (places, terms, groups, levels, staff roles…) and on board categories; **real phone verification (PortOne/KCP) + OAuth login replacing `/auth/dev-login`**; recovery rehearsal on the client's account |
| F02 | Photos on R2 | Upload with type sniffing (jpeg/png/webp, ≤10 MB), SHA-256, private bucket, 5-minute HMAC-signed URLs, access via DM/room membership, owner delete. **Migration tool** `tools/migrate-photos.mjs` (see "F02 photo migration") + `legacy_media_refs` (migration 0005) | tests; `tools/test-migrate-photos.mjs` (24 checks on a synthetic copy of the existing schema, incl. upload to local R2/D1) | The client's D1 export; R2 enabled on the target account; run on staging, then the client's approval for production; linking `legacy_media_refs` to new rows once F01 maps members and posts |
| F03 | <1 s realtime | Durable Object per channel (`room:`, `dm:`, `status`); single-use 30 s tickets; idempotent sends (`requestId`); `afterSeq` backfill after reconnect; socket revocation (4003) on kick/leave/block/close | tests (two clients in Miniflare; delivery well under 1 s locally) | **Two physical phones on staging**: measure latency, reconnect and offline behaviour; Flutter client subscription |
| F04 | Anonymous 1:1 DM | Request (from a profile or a post) → accept/reject/cancel; one conversation per pair (idempotent accept); no messages before acceptance; third-party 403; photos; read receipts; block cuts sockets and sending both ways; reports | tests (A→B→talk→C denied→block→logout scenario) | Moderation workflow for reports; two-device check |
| F05 | Push | Device token register/move/delete (removed on logout and withdrawal); per-type toggles (comment/dm/saved); KST DND window; hide-content; secret comments and DM bodies never in payloads; inbox + read. **Sender** (`src/lib/push-send.ts`, migration 0004): FCM HTTP v1 for Android and iPhone, sent right after the write and by a 1-minute cron; retries with backoff (5 tries, `Retry-After`), drops pushes older than 24 h, forgets uninstalled tokens, pauses on bad credentials without using up tries, never sends a row twice; admin status at `GET /push/outbox` | tests (signed service-account JWT checked, fake FCM) | The client's Firebase project: `FCM_SERVICE_ACCOUNT` secret, `google-services.json`, `GoogleService-Info.plist` and the APNs key uploaded to Firebase (see "F05 setup"). Real-device receipt in foreground, background and killed states |
| F06 | Store release | — (out of scope for the backend) | — | Signing, Face ID/lock, deep links, TestFlight/Play review |
| F07 | Store-room tools | Prices (`amount: null` = 문의, distinct from 0), terms, vacancy log → live status broadcast; store-operator-only edits; data scoped per store | tests | Real store IDs and roles from production |
| F08 | Staff last seen | Last authenticated activity (written at most once a minute); shown only with the staff member's opt-in (`PATCH /me/privacy`); hidden if blocked either way or withdrawn | tests | Client sign-off on the definition and timezone of "last seen" and on the exposure policy |
| F09 | Board | Server-side latest/oldest/popular keyset pagination (posts and comments); notices fetched separately; secret-comment ACL (commenter, post author, admin); likes; blocked authors filtered; idempotent create (`mutationId`); DM from post | tests (55 comments × 3 sorts, no duplicates or gaps) | Production board/category codes |
| F10 | Places | Weekly intervals that may cross midnight + closure dates; `lateNight` (22:00–06:00), `allDay`, `weekend`, `openNow`, `unknown` kept distinct from closed; filtered cursor pagination | tests (Friday→Saturday midnight, closures, 70 places > 48) | Production business-hours data and policy; region and category code mapping |

"Verified by tests" means automated tests on local Miniflare only. Nothing here has been checked on
staging, on devices, or by the client.

## Checked against the client's request (하이언니 개발 의뢰서, 2026-11-12)

| 의뢰서 | Status in this candidate |
|---|---|
| ③ 채팅방·오픈톡·가게 방·가게 숫자 즉시 반영 (웹소켓) | Done locally. Topic rooms (데일리톡), **익명 오픈톡** with per-room automatic nicknames (migration 0002), store rooms, and live counters all use WebSocket. |
| ④ 글이나 댓글에서 신청 → 수락 후 대화, 사진·읽음·신고·차단 | Done (requests from posts and from comments). |
| ⑤ 댓글·1:1·**찜한 가게 소식** 알림 + 종류별·방해 금지·내용 숨기기 | Inbox and settings are done. Saved-store updates notify savers, throttled to once per 10 minutes per store. The phone sender (FCM) is written and tested against a fake FCM; **it sends nothing until the client's Firebase credentials are set.** |
| ⑦ 가게 방 오른쪽 버튼 | Done (가격표, 용어설명, 담당 찾기, 빈방 기록). |
| ⑧ 초이스톡 실장 카드 + 최근 접속 | Done (opt-in). |
| ⑨ 비밀 댓글, 등록순·공감순·최신순, 글에서 1:1 | Done. |
| ⑩ 심야·24시, 주말 영업 **탭** | Done as tabs. Place categories follow the client's list: 헤어·메이크업, 홀복·렌탈, 성형·시술, 네일&취미, 생활필수, 놀거리 ZIP. The letter mentions 7 categories but names 6, so the 7th needs confirming. |
| ①②⑥ 서버 이전, 기존 사진 R2 이전, 스토어 출시 | Not started. These need production access. |
| 지켜 주셨으면 하는 것: 자료는 지우지 말고 숨기기 | Posts, comments, accounts and media are hidden, never deleted. Deleting a photo keeps the R2 object. |
| 지켜 주셨으면 하는 것: 미드나잇테라스 사진·문구·로고 금지 | The web prototype uses its own "hi" mark and synthetic copy only. |
| 지켜 주셨으면 하는 것: 기존 기능 유지 | **Not verifiable yet.** The existing features (게시판 7개 + 법률 게시판, BEST, 투표, 실시간 검색어, 출근백과, LIVE 번개모임, 언니그램, 출석·출근가계부, 가게 소식·스토리·지도, 업체 채널 …) live in the production source, which has not been received. This candidate does not replace them. |

## API overview

All routes except `/health`, `/auth/dev-login`, `/realtime/ws` and `/media/:id/raw` need
`Authorization: Bearer <token>`. Errors look like `{ "error": { "code", "message" } }`. Lists return
`{ items, nextCursor, hasMore }`, and cursors are opaque. Times are ISO-8601 UTC. Hours and DND are
evaluated in KST.

| Area | Routes |
|---|---|
| Auth / me | `POST /auth/dev-login` · `POST /auth/logout` · `GET /me` · `PATCH /me/privacy` · `DELETE /me` · `PUT/DELETE /me/saved/{room\|place}/:id` |
| Safety | `POST /safety/blocks` · `DELETE /safety/blocks/:userId` · `GET /safety/blocks` · `POST /safety/reports` |
| Realtime | `POST /realtime/tickets {channel}` → `GET /realtime/ws?ticket=` (WebSocket; send `ping` to get `pong`). Events: `ready`, `message`, `status`, `member`, `tools`, `read`, `revoked` |
| Rooms | `GET /rooms?kind=&category=hyperpublic\|jjeomo\|ten&region=&q=` (q matches the name or the store's 동네) · `GET /rooms/:id` · `POST /rooms/:id/join` · `POST /rooms/:id/leave` · `GET /rooms/:id/members?state=` · `POST /rooms/:id/members/:userId {action: approve\|reject\|kick\|block\|unblock}` · `POST /rooms/:id/close` · `PUT /rooms/:id/status` · `GET/POST /rooms/:id/messages` |
| Store tools | `GET /rooms/:id/tools` · `PUT /rooms/:id/tools/prices` · `PUT /rooms/:id/tools/terms` · `POST /rooms/:id/tools/vacancy` · `GET /rooms/:id/staff` |
| DM | `POST /dm/requests {toUserId \| postId}` · `GET /dm/requests?box=received\|sent` · `POST /dm/requests/:id/{accept,reject,cancel}` · `GET /dm/conversations` · `GET/POST /dm/conversations/:id/messages` · `POST /dm/conversations/:id/read` |
| Board | `GET /posts?board=&sort=latest\|oldest\|popular` · `GET /posts/notices?board=` · `POST /posts` · `GET/DELETE /posts/:id` · `PUT/DELETE /posts/:id/like` · `GET/POST /posts/:id/comments` · `PUT/DELETE /comments/:id/like` · `DELETE /comments/:id` |
| Places | `GET /places?category=&region=&q=&filter=lateNight,allDay,weekend,openNow&date=YYYY-MM-DD&saved=true` · `GET /places/:id` · `PUT /places/:id/hours` (operator) |
| Media | `POST /media` (raw body) · `GET /media/:id/url` · `GET /media/:id/raw?exp=&sig=` · `DELETE /media/:id` |
| Push | `PUT/DELETE /push/devices` · `GET/PUT /push/preferences` · `GET /push/outbox` (admin) · `GET /notifications` · `POST /notifications/read` |

## Design notes

- **Writes go through HTTP; WebSockets only fan out.** Every message is stored in D1 before it is
  broadcast, so an acknowledged message is never lost. A client that reconnects backfills with
  `afterSeq`. A retry with the same `requestId` returns the original message (`duplicate: true`) and
  is not broadcast again. The same `requestId` with a different body returns 409.
- **The bearer token never appears in a URL.** Browsers cannot set headers on a WebSocket, so the
  client exchanges the token for a single-use ticket that expires after 30 seconds.
- **`null` is different from `0`** in live status counts, prices and hours. Unknown hours are never
  reported as closed.
- **Race safety** comes from database constraints rather than from checks in code. Room capacity is
  checked inside the same `UPDATE`. Each pair of users gets one conversation (a `UNIQUE` constraint
  on the pair). A pair can have only one pending request (a partial unique index).

## Before going further

1. Get the production source and reconcile this schema with it, table by table. Wherever the real API
   contract differs, the real one wins.
2. Replace `/auth/dev-login` with the real login, and turn `DEV_LOGIN_ENABLED` off outside development.
3. Turn on push with the client's Firebase project (below).
4. Create D1, R2 and the Durable Object on the client's Cloudflare account, replace the placeholder
   `database_id`, and set `MEDIA_SIGNING_KEY` with `wrangler secret put`.

## F05 setup: turning on phone push

The sender is in place; it needs the client's Firebase project. Nothing below goes in the repo.

1. **Firebase project** (client's Google account): add an Android app `app.hiunni.mobile` and an iOS
   app `app.hiunni.mobile`.
2. **Server:** Firebase console → Project settings → Service accounts → *Generate new private key*.
   Store the whole JSON as a Worker secret, never in a file in the repo:
   `npx wrangler secret put FCM_SERVICE_ACCOUNT --env staging` (paste the JSON).
   `GET /push/outbox` as an admin then shows `senderConfigured: true`.
3. **Android:** put `google-services.json` in `capacitor/android/app/`, build with `HIUNNI_PUSH=1`.
4. **iPhone:** upload the APNs key (.p8, from the client's Apple account) in Firebase → Cloud
   Messaging. In Xcode add the package `https://github.com/firebase/firebase-ios-sdk` (product
   *FirebaseMessaging*) to the App target, add `GoogleService-Info.plist` to the App folder, enable
   the Push Notifications capability, build with `HIUNNI_PUSH=1`. `AppDelegate.swift` already swaps
   the APNs token for an FCM token once Firebase is present (and builds unchanged without it).
   Why FCM for iPhone too: Apple's push service only speaks HTTP/2, which a Worker's `fetch` does not
   offer, so the Worker cannot call Apple directly.
5. **Check (Peter's F05 test):** on each phone, with the app in the foreground, in the background and
   closed, get a comment, an accepted DM and a saved-store update; tap each and land on the right
   screen; turn a type off and confirm nothing arrives. `GET /push/outbox` shows each row `sent`, or
   the reason it failed.

## F02 photo migration

The existing service keeps pictures inside its database as base64 text (raw or `data:image/…`),
for example `place_photos.image`, `recruiter_profiles.photo`, `group_profiles.photo`.
`tools/migrate-photos.mjs` moves them to R2 without touching the source:

```bash
npx wrangler d1 export <client db> --remote --output export.sql   # needs the client's access
node --no-warnings tools/migrate-photos.mjs --source export.sql --work ./photo-run --verify
node --no-warnings tools/migrate-photos.mjs --source export.sql --work ./photo-run --upload staging
```

- Every text column of every table is scanned, so unknown columns are still found and listed in
  `report.json` (counts per table/column, bytes).
- Each distinct picture is stored once at `legacy/<sha256>.<ext>`; the type comes from the bytes.
  Cut-off or look-alike values are listed in `manifest.jsonl` with the reason, never uploaded.
- `media-import.sql` adds the `media` rows and one `legacy_media_refs` row per source cell
  (`INSERT OR IGNORE`, safe to apply twice). Owner is the placeholder `legacy-import` until F01.
- Running it again gives 0 new files and the same manifest and SQL; `--verify` re-hashes every
  file and reports missing files, checksum errors and broken references (F02 acceptance).
- `--upload` only accepts `local` or `staging`. It is resumable (`uploaded-<target>.txt`).
- Rehearsal on synthetic data: `node --no-warnings tools/test-migrate-photos.mjs [--upload-local]`.

## F01 member migration

`tools/migrate-members.mjs` turns an export of the existing service's database into SQL for this
schema. It never writes to the source and never connects to anything; applying the SQL is a separate
step, done on the **client's** Cloudflare account (agreed 2026-11-27).

```bash
npx wrangler d1 export <client db> --remote --output export.sql          # on the client's account
node --no-warnings tools/migrate-photos.mjs  --source export.sql --work ./run --verify
node --no-warnings tools/migrate-members.mjs --source export.sql --work ./run --verify
npx wrangler d1 execute <new db> --remote --file ./run/media-import.sql   # photos first
npx wrangler d1 execute <new db> --remote --file ./run/import.sql
```

- **What is carried over:** members (nickname, withdrawn), Google/Naver links, shops → stores and a
  store room each, the latest live status per shop, saved shops, posts, comments and likes, 오픈톡
  rooms with members and messages. Ids stay the same, so old links and sample checks work.
- **Mappings** (reported in `report.json` for checking): 업종 하이퍼블릭 → 하이퍼블릭, 쩜오 → 쩜오,
  텐카페/텐프로/일프로 → 텐 (as the existing app groups them; the original label is kept in
  `stores.source_industry`); "강남 역삼" → region 강남 + 동네 역삼; 오픈톡 → 익명 오픈톡;
  banned → blocked. Board categories are kept as they are until the board list is decided.
- **Nothing is guessed or dropped silently:** a broken date, a missing author or "초중 20 미만" is
  left empty or listed with the reason; unlisted shops are kept without a room (hidden); hidden posts
  and comments come over hidden; every source table that is not carried over is listed with its row
  count (`sourceTables.notCarriedWithRows`) so each one gets a decision.
- **Checks (`--verify`):** builds this schema from `migrations/`, applies the SQL twice, and confirms
  row counts, foreign keys, 20 sample ids per entity, and that the second run changed nothing.
- **Not carried over yet:** places (needs the category list and hours format), the 용어 dictionary,
  groups, member levels and staff roles, attendance, jobs, market, and the rest listed in the report.
  Passwords and sessions are not copied; members sign in again with the real login (F01).
- Rehearsal on synthetic data: `node --no-warnings tools/test-migrate-members.mjs`.
