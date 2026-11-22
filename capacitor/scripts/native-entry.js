// Bundled by scripts/build-web.mjs into www/native.js (app builds only).
// Exposes the Capacitor plugins to the plain-JS web app as window.HiunniNative.
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { PushNotifications } from '@capacitor/push-notifications';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { NativeBiometric } from '@capgo/capacitor-native-biometric';

window.HiunniNative = {
  isNative: Capacitor.isNativePlatform(),
  platform: Capacitor.getPlatform(), // 'android' | 'ios' | 'web'
  App,
  PushNotifications,
  SplashScreen,
  StatusBar,
  StatusBarStyle: Style,
  NativeBiometric,
};
