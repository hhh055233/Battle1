// מוריד את three.js ו-PeerJS לתיקיית vendor/ כדי שהאתר לא יהיה תלוי ב-CDN.  הרצה: node scripts/fetch-vendor.mjs
// (אופציונלי – בלי זה האתר טוען את הספריות מ-jsDelivr / unpkg.)
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'vendor');
const FILES = [
  ['three.module.js', ['https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js', 'https://unpkg.com/three@0.160.0/build/three.module.js']],
  ['peerjs.min.js', ['https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js', 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js']],
];

await mkdir(dir, { recursive: true });
for (const [name, urls] of FILES) {
  let ok = false;
  for (const url of urls) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 50000) throw new Error('הקובץ קטן מדי, כנראה לא הספרייה');
      await writeFile(path.join(dir, name), buf);
      console.log(`✔ ${name} (${Math.round(buf.length / 1024)}KB) מתוך ${url}`);
      ok = true;
      break;
    } catch (e) { console.log(`✘ ${url} – ${e.message}`); }
  }
  if (!ok) { console.error(`נכשלה הורדת ${name}`); process.exitCode = 1; }
}
