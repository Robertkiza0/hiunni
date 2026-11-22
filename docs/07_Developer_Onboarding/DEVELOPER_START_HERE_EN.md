# HIUNNI – New Outsourced Developer Onboarding (19 Nov 2026)

## Mission
Ship the existing HIUNNI 19+ anonymous community to production-grade Cloudflare infrastructure, robust real-time messaging/DM/notifications, native Android+iOS, and fully verify the **10 contracted acceptance items**. Preserve the current site, data, IDs, designs and all existing user-facing functions. Do not treat any demo as production.

## Critical dependencies
1. Obtain the client's **written authorization** for subcontracting, sharing confidential source material and (if applicable) any personal-data processor arrangements. NDA required.
2. Get the exact production source (v541 or the official deployed revision), `dist/`, `worker/`, `drizzle/`, Cloudflare Worker deployment SHA, full D1 backup and the original 1,881 tests. These are **not confirmed in this handoff package**.
3. Cloudflare/Apple/Google/FCM/KCP/PortOne credentials must be provisioned via official role-based accounts or secret managers, never sent in source archives, email or chat.
4. Build and verify a staging clone from the actual source before any migration or UI merge.

## Source package priority
- **UI/Dart candidate to inspect first**: `05_Source_Code/HIUNNI_Midnight_Cat_Integrated_20261119.zip`, `hiunni-product/flutter-app/`. Dali cat intro; dark purple home after login.
- Previous Flutter baseline + candidate API: `HIUNNI_Flutter_Continue_20261119(2).zip`.
- FlutterFlow export + reference screenshots: `HIUNNI_Robert_Webapp_FlutterFlow_Design_Handoff_20261119.zip`.
- **Separate**, synthetic-data Web UIUX v2 + SQLite candidate SQL 001–016: `HIUNNI_Web_SQL_UIUX_v2_Handoff_20261119.zip`. Not connected to live Cloudflare and must not be auto-migrated.
- The two GitHub PRs (#10/#23) are draft and not merged; inspect CI failures rather than assuming green builds.

## UI standard
Background #131217; primary #825ED0. Keep Dali intro and five tabs: realtime/ChoiceTalk, DailyTalk, Lounge, Places, My. Preserve the existing native/FlutterFlow sources; no blind overwrite. Reference 12mid.com for patterns **only**; no protected imagery/copy/assets.

## Acceptance priority (contract Annex 1)
F01 Cloudflare migration and full data preservation; F02 R2 photos; F03 multi-device <1s WebSocket chat/status; F04 consent-based anonymous DM + photo/read/report/block; F05 FCM+APNs and DND/preferences; F06 official iOS+Android releases with lock/deep links; F07 room right-side tools; F08 staff last-seen; F09 secret comments/order/DM; F10 late-night/24h/weekend place filters.

## Deliverables required on every PR
Commit SHA; file list; repro steps; environment; legacy regression; unit/permission/integration tests; screenshot+logs; untested/blocked items; rollback. Client sign-off is independent of code completion.

## Never do
Touch production or use real member accounts without client-approved staging, export user data, send credentials in ZIP, mark release complete without actual store links, or subcontract further without approval.
