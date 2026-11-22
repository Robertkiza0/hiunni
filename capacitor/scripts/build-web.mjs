// Builds www/ for the native app from ../web/index.html:
//  1. bundles the Capacitor plugins into www/native.js
//  2. injects window.HIUNNI_CONFIG (API base URL, push on/off) and native.js into the page
//
// Usage:
//   HIUNNI_API_BASE=https://api.example.com npm run sync            # release
//   HIUNNI_ENV=development HIUNNI_API_BASE=http://10.0.2.2:8787 npm run sync   # Android emulator → local dev server
//   HIUNNI_PUSH=1 ...   only after google-services.json (Android) / APNs (iOS) are set up
//
// There is deliberately no default API URL: a build that silently points at the wrong server is worse
// than a build that refuses to run.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const src = path.resolve(root, '../web/index.html');
const out = path.join(root, 'www');

const apiBase = (process.env.HIUNNI_API_BASE || '').replace(/\/+$/, '');
const dev = process.env.HIUNNI_ENV === 'development';
const push = process.env.HIUNNI_PUSH === '1';

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

if (!apiBase) fail('HIUNNI_API_BASE is required, e.g. HIUNNI_API_BASE=https://api.hiunni.kr npm run sync');
let url;
try {
  url = new URL(apiBase);
} catch {
  fail(`HIUNNI_API_BASE is not a valid URL: ${apiBase}`);
}
if (url.pathname !== '/' || url.search || url.username) fail('HIUNNI_API_BASE must be an origin only (scheme://host[:port]), no path or credentials');
if (url.protocol !== 'https:' && !dev) fail('Release builds need an https API. For a local dev server set HIUNNI_ENV=development.');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

await build({
  entryPoints: [path.join(root, 'scripts/native-entry.js')],
  bundle: true,
  format: 'iife',
  target: ['es2020', 'safari15'],
  minify: true,
  outfile: path.join(out, 'native.js'),
  logLevel: 'warning',
});

const cfg = { apiBase, push, env: dev ? 'development' : 'production' };
const inject =
  `<script>window.HIUNNI_CONFIG=${JSON.stringify(cfg).replace(/</g, '\\u003c')};</script>\n` +
  `<script src="native.js"></script>\n`;

const html = fs.readFileSync(src, 'utf8');
// The app's own inline script starts with <script> + 'use strict' (LF or CRLF line endings).
const marker = /<script>\r?\n'use strict';/;
if (!marker.test(html)) fail(`could not find the app script marker in ${src}`);
fs.writeFileSync(path.join(out, 'index.html'), html.replace(marker, m => inject + m));

console.log(`✔ www/ built · api=${apiBase} · push=${push ? 'on' : 'off'} · env=${cfg.env}`);
