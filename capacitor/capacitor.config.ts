import type { CapacitorConfig } from '@capacitor/cli';

/**
 * HIUNNI native app (Android + iOS) — 의뢰서 ⑥ "앱 출시".
 * Same app ID as the existing store listings, so this ships as an update to them.
 *
 * HIUNNI_ENV=development allows plain-http API calls to a local dev server
 * (Android emulator → http://10.0.2.2:8787). Release builds must use https.
 */
const dev = process.env.HIUNNI_ENV === 'development';

const config: CapacitorConfig = {
  appId: 'app.hiunni.mobile',
  appName: '하이언니',
  webDir: 'www',
  backgroundColor: '#131217',
  android: {
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'never',
  },
  ...(dev ? { server: { cleartext: true } } : {}),
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      launchAutoHide: true,
      backgroundColor: '#131217',
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
