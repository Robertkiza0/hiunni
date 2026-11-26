# HIUNNI app — Android + iOS (Capacitor 8)

One codebase for both stores (의뢰서 ⑥). The app bundles the web app from `../web/index.html` and adds
native features: app lock (Face ID / fingerprint / phone passcode), app links, push notifications,
splash screen and status bar.

- **App ID** `app.hiunni.mobile` on both platforms, the same as the existing store listings, so it
  ships as an update to them, not a new app.
- **Versions:** Android 1.1.0 (versionCode **5**, above the store's 1.0.1 / 4); iOS 1.1.0 (build **2**).
- **Icon:** the client's existing store icon (rose "hi"). The splash screen uses the dark brand
  background. A purple icon would be a brand decision for the client.
- **Old projects:** the TWA project in `../mobile/android` and the Safari-wrapper project in
  `../mobile/ios` are left untouched for reference. This project replaces both.

## Build

```bash
npm install
# Release: the API must be https. There is no default URL on purpose.
HIUNNI_API_BASE=https://<api host> npm run sync
# Local testing against `npm run dev` in ../backend (Android emulator reaches the PC at 10.0.2.2):
HIUNNI_ENV=development HIUNNI_API_BASE=http://10.0.2.2:8787 npm run sync

npm run android   # opens Android Studio (needs JDK 21 and Android SDK 36)
npm run ios       # opens Xcode (Mac only; Swift Package Manager, no CocoaPods)
```

`npm run sync` runs `scripts/build-web.mjs` and then `cap sync`:
- It copies `../web/index.html` into `www/`.
- It bundles the plugins into `www/native.js`.
- It injects `window.HIUNNI_CONFIG` (`apiBase`, `push`, `env`).

The web version served by the backend does not include these, so it behaves as a normal website.

## Release signing

**Android.** Set `HIUNNI_KEYSTORE`, `HIUNNI_KEYSTORE_PASSWORD`, `HIUNNI_KEY_ALIAS` and
`HIUNNI_KEY_PASSWORD` in the build environment. These are the same variables the previous TWA build
used. Use the existing approved upload key; a debug or unsigned release build is refused.
`hiunni.kr/.well-known/assetlinks.json` already lists this package and key (a copy is in
`well-known/`), so App Links keep verifying.

**iOS.** In Xcode, choose the client's signing team for the `App` target. The team is left blank on
purpose. Then run Archive → Validate → Upload.

## Native features

| Feature | How | Still needed before release |
|---|---|---|
| App lock (앱 잠금) | 마이페이지 → 앱 잠금. Uses Face ID / Touch ID, fingerprint or face unlock, or the phone's passcode/PIN as fallback. Content is covered as soon as the app goes to the background; returning within 30 s needs no new prompt. | Real-device check. If "비밀번호" means an app-specific PIN rather than the phone's passcode, that is a separate feature. |
| App links | `https://hiunni.kr/rooms|posts|dm|places/<id>` and `hiunni://…` open the right screen, including after login. | iOS: replace `TEAMID` in `well-known/apple-app-site-association` and serve it at `https://hiunni.kr/.well-known/apple-app-site-association`. |
| Push | After login, asks permission, registers, and sends the device token to `PUT /push/devices`. Tapping a notification opens its link. The server sends through FCM on both platforms; on iPhone, `AppDelegate.swift` exchanges the APNs token for an FCM token once Firebase is added. | The client's Firebase project: `google-services.json` (Android), `GoogleService-Info.plist` + the FirebaseMessaging package + APNs key in Firebase (iPhone), then build with `HIUNNI_PUSH=1`. Steps: `../backend/README.md` → "F05 setup". The iOS change is not compiled yet (needs a Mac). |
| Android back button | Closes a sheet, goes back a screen, returns to the first tab, then minimises the app. | — |
| Privacy | Android backups exclude app data. The session is kept on the device behind the app lock. iOS is iPhone-only and portrait-only. `ITSAppUsesNonExemptEncryption = false`. | Store privacy forms (data safety / App Privacy). |

## What was verified, and what was not

- **Verified here:** the www build; `cap sync` for both platforms; a browser test of all native code
  paths with mocked plugins (17 checks: links, back button, push registration, app lock, session
  restore); the web regression test (37 checks).
- **Android debug build compiled** (2026-11-21, JDK 21 Temurin, SDK 36, build-tools 35):
  `android/app/build/outputs/apk/debug/app-debug.apk`. aapt confirms package `app.hiunni.mobile`,
  versionCode 5 / 1.1.0, target SDK 36, the App Links and `hiunni://` filters, backups off, and the
  bundled web app.
- **Not verified:** the iOS build (needs a Mac), a signed release build (needs the client's upload
  key), and any run on a phone or emulator. Nothing has been submitted to a store.

### Building on Windows

```bash
export JAVA_HOME="C:/Users/User/.jdks/jdk-21.0.13.1+2"
# android/local.properties must use forward slashes:  sdk.dir=C:/Users/User/AppData/Local/Android/Sdk
cd android && ./gradlew assembleDebug
```

The debug APK built with `HIUNNI_API_BASE=http://10.0.2.2:8787` only reaches a dev server from the
Android emulator. To try it on a real phone on the same Wi-Fi:
1. Run the backend with `npx wrangler dev --ip 0.0.0.0`.
2. Rebuild with `HIUNNI_ENV=development HIUNNI_API_BASE=http://<PC's LAN IP>:8787 npm run sync`.
3. Run `assembleDebug` again.
