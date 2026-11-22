// Builds the Vercel demo site from ../../web/index.html and points it at the staging API Worker.
//
// Usage (from this folder):
//   HIUNNI_API_BASE=https://hiunni-api-staging.<account>.workers.dev node build.mjs
//   npx vercel deploy dist --prod
//
// Staging demo only: synthetic data, never the production API.
import fs from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname;
const src = path.resolve(here, '../../web/index.html');
const out = path.join(here, 'dist');

const apiBase = (process.env.HIUNNI_API_BASE || '').replace(/\/+$/, '');
if (!apiBase) {
  console.error('✖ HIUNNI_API_BASE is required (the staging Worker URL)');
  process.exit(1);
}
const url = new URL(apiBase);
if (url.protocol !== 'https:' || url.pathname !== '/') {
  console.error('✖ HIUNNI_API_BASE must be an https origin with no path');
  process.exit(1);
}

const html = fs.readFileSync(src, 'utf8');
const marker = /<script>\r?\n'use strict';/;
if (!marker.test(html)) {
  console.error(`✖ could not find the app script marker in ${src}`);
  process.exit(1);
}
const cfg = { apiBase, push: false, env: 'staging' };
const inject = `<script>window.HIUNNI_CONFIG=${JSON.stringify(cfg).replace(/</g, '\\u003c')};</script>\n`;

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), html.replace(marker, m => inject + m));
fs.copyFileSync(path.join(here, 'vercel.json'), path.join(out, 'vercel.json'));

console.log(`✔ dist/ built · api=${apiBase}`);
