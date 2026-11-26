// Synthetic venue "photos": abstract lounge scenes (bokeh lights, bar counter glow, neon line).
// No text, no real venue. Output: cover-01.jpg … cover-12.jpg (800x800).
import { chromium } from 'playwright-core';
const out = process.argv[2];
const palettes = [
  ['#2a0f3d', '#e4729f', '#ffb86b', '#7a5cff'], ['#0d1b2a', '#3fd0c9', '#e4729f', '#ffd36b'],
  ['#1f0d1a', '#ff5fa2', '#9b7bff', '#ffcf8a'], ['#101626', '#6fa8ff', '#c48bff', '#ffe08a'],
  ['#24140a', '#ffb05f', '#ff6f6f', '#ffe6b0'], ['#0f1f1a', '#4fe3a6', '#6fd3ff', '#f8a5ff'],
  ['#1b0f2e', '#b98cff', '#ff8fc7', '#8ad8ff'], ['#2b0b14', '#ff4f7b', '#ffb36b', '#ffd9e5'],
  ['#0b1630', '#5f7bff', '#2fe0ff', '#ff9ad5'], ['#1a1206', '#ffc861', '#ff8a5b', '#fff1c2'],
  ['#160b22', '#ff73d1', '#73a7ff', '#ffe28a'], ['#0e1a24', '#7ee0ff', '#ff8fa3', '#d8b4ff'],
];
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const p = await b.newPage({ viewport: { width: 800, height: 800 } });
for (const [i, [bg, a, c, d]] of palettes.entries()) {
  const dots = Array.from({ length: 38 }, () => {
    const col = [a, c, d][Math.floor(rnd() * 3)], r = 20 + rnd() * 90;
    return `<i style="left:${rnd() * 800 - r}px;top:${rnd() * 430 - r}px;width:${r * 2}px;height:${r * 2}px;background:radial-gradient(circle,${col}cc 0%,${col}55 45%,transparent 70%);opacity:${0.35 + rnd() * 0.55}"></i>`;
  }).join('');
  const neonY = 150 + rnd() * 160, neonX = 80 + rnd() * 380;
  const html = `<html><body style="margin:0"><div style="position:relative;width:800px;height:800px;overflow:hidden;background:
      radial-gradient(120% 80% at 50% 0%, ${a}33 0%, transparent 60%), linear-gradient(180deg, ${bg} 0%, #07060a 100%)">
    <style>i{position:absolute;border-radius:50%;filter:blur(6px)}</style>${dots}
    <div style="position:absolute;left:${neonX}px;top:${neonY}px;width:${220 + rnd() * 160}px;height:8px;border-radius:8px;background:${a};box-shadow:0 0 18px ${a},0 0 60px ${a},0 0 120px ${a}88"></div>
    <div style="position:absolute;left:0;right:0;top:520px;height:30px;background:linear-gradient(90deg,transparent,${c}aa,transparent);filter:blur(10px)"></div>
    <div style="position:absolute;left:-40px;right:-40px;top:540px;bottom:0;background:linear-gradient(180deg,#1a1420 0%,#0a080d 70%);border-top:2px solid ${c}66;transform:perspective(600px) rotateX(18deg)"></div>
    ${Array.from({ length: 6 }, (_, k) => `<div style="position:absolute;bottom:${210 + rnd() * 20}px;left:${70 + k * 120 + rnd() * 30}px;width:${18 + rnd() * 10}px;height:${70 + rnd() * 50}px;border-radius:8px 8px 3px 3px;background:linear-gradient(180deg,${[a, c, d][k % 3]}aa,${bg});box-shadow:0 0 22px ${[a, c, d][k % 3]}66"></div>`).join('')}
    <div style="position:absolute;inset:0;background:radial-gradient(90% 90% at 50% 45%,transparent 55%,#000a 100%)"></div>
  </div></body></html>`;
  await p.setContent(html);
  await p.screenshot({ path: `${out}/cover-${String(i + 1).padStart(2, '0')}.jpg`, type: 'jpeg', quality: 82 });
}
await b.close();
console.log('covers written to', out);
