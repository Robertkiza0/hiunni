# HIUNNI

Working repo for the HIUNNI (하이언니) rebuild: web app, Cloudflare Workers API, and the
Android/iOS apps.

**Status:** staging candidate on synthetic data. This is *not* the production source for
hiunni.kr. The live web/Worker code (v541, commit `bc9f18e`), its D1 schema and its test suite
have not been handed over yet, see `docs/08_Security_And_Handoff/REQUIRED_MISSING_ORIGINALS.md`.
Nothing here touches production data or the live accounts.

## Layout

```
web/        Web app, single file (index.html). Talks to the API, ko/en.
backend/    API on Cloudflare Workers: Hono, D1, R2, Durable Objects. Tests in backend/test.
capacitor/  Android + iOS app (Capacitor 8) wrapping web/, with app lock, push, deep links.
mobile/     The client's existing v541 store wrappers (Android TWA, iOS Safari view) and store
            assets, kept as received. See mobile/HANDOFF_v541.ko.md.
deploy/     Demo deploy (Vercel for web, staging Worker for the API).
design/     UI screens used for the v2 design.
docs/       Handoff package: PRD, technical spec, design guide, F01–F10 acceptance matrix,
            onboarding, security notes. Contract files are kept out of Git (NDA).
```

## Quick start

Needs Node 24.

```bash
cd backend
npm ci
cp .dev.vars.example .dev.vars     # set MEDIA_SIGNING_KEY
npm run db:reset:local             # local D1 + synthetic seed
npm run dev                        # API and web app on http://localhost:8787
npm test
```

More detail in `backend/README.md` and `capacitor/README.md`.

## Rules for this repo

- Synthetic data only. No production DB exports, real member content or credentials.
- No secrets in Git. `.dev.vars`, keystores and Firebase/Apple config files are ignored.
- Contract scope is F01–F10 (see `docs/06_Progress_QA/F01_F10_Acceptance_Matrix.csv`).
  Anything beyond it gets agreed in writing first.
