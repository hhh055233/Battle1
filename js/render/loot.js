// חפצים על הקרקע, רימונים, מצנח וחבילת אספקה: דגמים מפורטים בגאומטריה מאוחדת (עד 3 רשתות לפריט; העתקים חולקים גאומטריה וחומרים).
// מוסכמות: כל פריט לוט עומד על Y=0 וממורכז על ציר Y (כך שהסיבוב ב-game.js מסתובב סביב מרכזו).
// רימונים: ראשית במרכז הגוף, Y למעלה (נשמרת התאמה לידית ביד, לתצוגת גוף ראשון ולרימון בטיסה).
import * as THREE from 'three';
import { Builder, vcMat, basicVcMat, shade, mixc, TAU, mul3, rotXYZ } from './kit.js';
import { gearGroup, seg } from './gear.js';
import { buildOptic, lift } from './weapons.js';
import { AMMO } from '../sim/data.js';

// ---------- כלים ----------
const GC = {};
const BOXG = () => (GC.b ||= new THREE.BoxGeometry(1, 1, 1));
const SPHG = () => (GC.s ||= new THREE.SphereGeometry(1, 14, 10));
const SPHS = () => (GC.sl ||= new THREE.SphereGeometry(1, 8, 6)); // כדור דל-פוליגונים לפרטים זעירים
const CYG = (rb, rt, n = 12) => (GC[`c${rb}_${rt}_${n}`] ||= new THREE.CylinderGeometry(rt, rb, 1, n, 1));
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// מסגרת מקומית: מיקום ו-סיבוב (R, t) שחלים על כל הצורות שמוסיפים דרכה (cy = גליל לאורך Y עם רדיוס תחתון/עליון, bx = קופסה, sp = כדור/אליפסואיד)
function frame(b, R = I3, t = [0, 0, 0]) {
  const P = (x, y, z) => [t[0] + R[0] * x + R[1] * y + R[2] * z, t[1] + R[3] * x + R[4] * y + R[5] * z, t[2] + R[6] * x + R[7] * y + R[8] * z];
  const M = (rl) => (rl ? mul3(R, rotXYZ(rl[0], rl[1], rl[2])) : R);
  return {
    bx: (w, h, d, x, y, z, c, k = 'm', rl) => b.add(BOXG(), { s: [w, h, d], p: P(x, y, z), m: M(rl), c }, k),
    cy: (rb, rt, h, x, y, z, c, k = 'm', n = 12, rl) => b.add(CYG(rb, rt, n), { s: [1, h, 1], p: P(x, y, z), m: M(rl), c }, k),
    sp: (r, x, y, z, c, k = 'm', sy = 1, sz = 1, lo = false) => b.add(lo ? SPHS() : SPHG(), { s: [r, r * sy, r * sz], p: P(x, y, z), m: R, c }, k),
  };
}

// בונה עם הרמת צבעים כהים (בלי מפת סביבה צבעים כהים נראים שחורים לגמרי)
function newB() {
  const b = new Builder(), add0 = b.add.bind(b);
  b.add = (geo, o, k) => add0(geo, o && typeof o.c === 'number' ? Object.assign({}, o, { c: lift(o.c) }) : o, k);
  return b;
}

const MATS = () => ({
  m: vcMat('lt-m', 0.62, 0.04),
  x: vcMat('lt-x', 0.4, 0.2),
  g: vcMat('lt-g', 0.12, 0.1, { transparent: true, opacity: 0.5, depthWrite: false }),
  l: basicVcMat('lt-l'),
  c: vcMat('lt-c', 0.85, 0, { side: THREE.DoubleSide }),
});

// אב-טיפוס מוחזק במטמון; כל קריאה מחזירה קבוצה חדשה עם mesh-ים שחולקים גאומטריה וחומר
const PROTO = new Map();
const proto = (key, make) => { let p = PROTO.get(key); if (!p) { p = make(); PROTO.set(key, p); } return p; };
function fresh(p) {
  const g = new THREE.Group();
  for (const m of p.children) { const q = new THREE.Mesh(m.geometry, m.material); q.castShadow = true; g.add(q); }
  return g;
}

// מציב קבוצה כך שתשב על Y=0 וממורכזת ב-X/Z, אחרי סיבוב (rx,ry,rz) וקנה מידה (s, או fit = הגודל המרבי הרצוי)
function place(g, o = {}) {
  const rx = o.rx || 0, ry = o.ry || 0, rz = o.rz || 0, R = rotXYZ(rx, ry, rz);
  const ext = (s) => {
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const m of g.children) {
      const P = m.geometry.attributes.position.array;
      for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { const v = (R[k * 3] * P[i] + R[k * 3 + 1] * P[i + 1] + R[k * 3 + 2] * P[i + 2]) * s; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
    }
    return { mn, mx };
  };
  let s = o.s || 1;
  if (o.fit) { const e = ext(1); s = o.fit / Math.max(e.mx[0] - e.mn[0], e.mx[1] - e.mn[1], e.mx[2] - e.mn[2]); }
  const e = ext(s), pv = new THREE.Group();
  pv.rotation.set(rx, ry, rz); pv.scale.setScalar(s);
  pv.position.set(-(e.mn[0] + e.mx[0]) / 2, -e.mn[1], -(e.mn[2] + e.mx[2]) / 2);
  pv.add(g);
  const w = new THREE.Group(); w.add(pv);
  return w;
}

// טבעת קטנה במישור XY (טבעת הסיכה של הרימון), מורכבת מקופסאות קטנות
function ringXY(b, cx, cy, cz, r, n, th, c) {
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU; b.add(BOXG(), { s: [(TAU * r / n) * 1.2, th, th], p: [cx + r * Math.cos(a), cy + r * Math.sin(a), cz], r: [0, 0, a + Math.PI / 2], c }, 'x'); }
}

// ---------- ציוד: קסדות, אפודים, תיקים (אותה גאומטריה כמו על הדמות) ----------
const HELM_T = [0, 0.5, 0.52, 0.36]; // הטיית הכיפה בקסדה על הראש; מיישרים אותה כדי שהקסדה תשב ישר
function gearItem(kind, lvl) {
  if (kind === 'helm') return place(gearGroup('helm', lvl), { rx: -HELM_T[lvl] + 0.3, s: 1.38 });
  if (kind === 'vest') return place(gearGroup('vest', lvl, 0), { rx: -0.28, s: 0.92 });
  // תיק: מוסיפים רצועות כתף שיוצאות מהגב (בעת לבישה הן מכוסות בגוף)
  const grp = gearGroup('pack', lvl, 0), H = [0, 0.34, 0.45, 0.52][lvl], W = [0, 0.3, 0.34, 0.38][lvl];
  const b = newB(), c = 0x2c2f33;
  for (const s of [-1, 1]) {
    const x = s * W * 0.24;
    seg(b, [x, H * 0.92, 0], [x * 1.08, H * 0.72, -0.075], 0.052, 0.016, c, 'm');
    seg(b, [x * 1.08, H * 0.72, -0.075], [x * 1.08, H * 0.3, -0.08], 0.052, 0.016, c, 'm');
    seg(b, [x * 1.08, H * 0.3, -0.08], [x, H * 0.05, 0], 0.052, 0.016, c, 'm');
  }
  for (const m of b.build(MATS()).children.slice()) grp.add(m);
  return place(grp, { rx: -0.1, s: 1.05 });
}

// ---------- תחמושת ----------
// כדורים מוגדלים ~2.2 פעמים כדי שיהיו קריאים: h = אורך כולל, r = רדיוס התרמיל
const CART = {
  '9mm': { k: 'p', h: 0.066, r: 0.0125, brass: 0xd8b04a, tip: 0xc4803c },
  '45': { k: 'p', h: 0.072, r: 0.0155, brass: 0xd8b04a, tip: 0xb8742f },
  '556': { k: 'r', h: 0.13, r: 0.0125, brass: 0xd8b04a, tip: 0x5fc24f },
  '762': { k: 'r', h: 0.125, r: 0.0145, brass: 0xc89a3c, tip: 0xd9442e },
  '300': { k: 'r', h: 0.19, r: 0.0175, brass: 0xd8b04a, tip: 0x8a74f0 },
  '12g': { k: 's', h: 0.15, r: 0.0235, brass: 0xd8b04a, hull: 0xe0484a },
};
function cartridge(b, id, R, t) {
  const S = CART[id], F = frame(b, R, t), h = S.h, r = S.r, br = S.brass, N = 8;
  if (S.k === 's') { // קליע רובה ציד: בסיס פליז, גוף פלסטיק אדום וכיפוף עליון
    F.cy(r * 1.04, r * 1.04, h * 0.2, 0, h * 0.1, 0, br, 'x', 10);
    F.cy(r * 1.08, r * 1.08, h * 0.022, 0, h * 0.2, 0, shade(br, 0.7), 'x', 10);
    F.cy(r, r, h * 0.78, 0, h * 0.6, 0, S.hull, 'm', 10);
    F.cy(r, r * 0.82, h * 0.05, 0, h * 0.975, 0, shade(S.hull, 0.75), 'm', 10);
    return;
  }
  const rn = r * (S.k === 'r' ? 0.68 : 0.92);
  if (S.k === 'r') { // רובה: תרמיל עם צוואר, קליע נחושת וקצה צבוע לפי קליבר
    F.cy(r * 1.07, r * 1.07, h * 0.035, 0, h * 0.0175, 0, shade(br, 0.7), 'x', N);
    F.cy(r, r * 0.96, h * 0.59, 0, h * 0.325, 0, br, 'x', N);
    F.cy(r * 0.96, rn, h * 0.1, 0, h * 0.67, 0, br, 'x', N);
    F.cy(rn, rn, h * 0.08, 0, h * 0.76, 0, br, 'x', N);
    F.cy(rn * 0.98, rn * 0.98, h * 0.07, 0, h * 0.835, 0, 0xb87438, 'x', N);
    F.cy(rn * 0.98, rn * 0.2, h * 0.13, 0, h * 0.935, 0, S.tip, 'm', N);
  } else { // אקדח/תת-מקלע: תרמיל ישר וקליע מעוגל
    F.cy(r * 1.07, r * 1.07, h * 0.04, 0, h * 0.02, 0, shade(br, 0.7), 'x', N);
    F.cy(r, r, h * 0.52, 0, h * 0.3, 0, br, 'x', N);
    F.cy(rn, rn, h * 0.22, 0, h * 0.67, 0, S.tip, 'x', N);
    F.cy(rn, rn * 0.55, h * 0.22, 0, h * 0.89, 0, S.tip, 'x', N);
  }
}
function ammoItem(id) {
  const b = newB(), F = frame(b), cc = AMMO[id].color, S = CART[id];
  const body = shade(cc, 0.55), lid = shade(cc, 0.4), ms = 0xb4b8be;
  F.bx(0.26, 0.12, 0.115, 0, 0.06, 0, body);                 // קופסת פח
  F.bx(0.272, 0.028, 0.127, 0, 0.134, 0, lid);               // מכסה
  for (const z of [-0.032, 0.032]) F.bx(0.2, 0.006, 0.012, 0, 0.1515, z, shade(lid, 1.35)); // צלעות חיזוק
  for (const x of [-0.055, 0.055]) F.bx(0.008, 0.032, 0.008, x, 0.17, 0, ms, 'x');         // ידית קשת
  F.bx(0.118, 0.008, 0.012, 0, 0.19, 0, ms, 'x');
  for (const x of [-0.078, 0.078]) { F.bx(0.034, 0.05, 0.012, x, 0.115, 0.063, 0xaeb3ba, 'x'); F.bx(0.022, 0.016, 0.016, x, 0.138, 0.066, 0x70757c, 'x'); } // תפסים
  F.bx(0.15, 0.07, 0.004, 0, 0.06, 0.059, cc);               // תווית קליבר
  F.bx(0.15, 0.008, 0.005, 0, 0.1, 0.0592, 0xf2f0e6); F.bx(0.15, 0.008, 0.005, 0, 0.02, 0.0592, 0xf2f0e6);
  for (const x of [-0.035, 0, 0.035]) F.bx(0.014, 0.032, 0.005, x, 0.06, 0.0596, 0x23262b); // סמלי כדורים
  const lie = (yaw) => rotXYZ(0, yaw, -Math.PI / 2);
  if (S.k === 's') {
    cartridge(b, id, I3, [0.17, 0, -0.01]); cartridge(b, id, I3, [0.21, 0, 0.045]);
    cartridge(b, id, lie(0.3), [-0.08, S.r, 0.13]);
  } else {
    cartridge(b, id, I3, [0.165, 0, -0.03]); cartridge(b, id, I3, [0.2, 0, 0.012]); cartridge(b, id, I3, [0.145, 0, 0.045]);
    cartridge(b, id, lie(0.0), [-0.08, S.r, 0.125]); cartridge(b, id, lie(0.45), [0.01, S.r, 0.15]);
  }
  return b.build(MATS());
}

// ---------- רפואה ----------
function bandage() {
  const b = newB(), F = frame(b), W = 0xf3f1e8;
  const roll = (x, z, r, h, stripe) => {
    F.cy(r, r, h, x, h / 2, z, W, 'm', 18);
    F.cy(r * 1.012, r * 1.012, h * 0.3, x, h * 0.5, z, stripe, 'm', 18);
    for (const f of [0.16, 0.84]) F.cy(r * 1.006, r * 1.006, h * 0.012, x, h * f, z, 0xd5d1c4, 'm', 18);
    F.cy(r * 0.3, r * 0.3, h * 1.02, x, h / 2, z, 0x7c8087, 'm', 10);
  };
  roll(-0.05, -0.01, 0.075, 0.075, 0xd23c3c);
  roll(0.09, 0.03, 0.056, 0.062, 0x2f6fd0);
  F.bx(0.17, 0.004, 0.058, 0.01, 0.002, 0.105, W, 'm', [0, -0.25, 0]);   // זנב פרוס
  F.bx(0.17, 0.005, 0.01, 0.01, 0.0026, 0.105, 0xd23c3c, 'm', [0, -0.25, 0]);
  return b.build(MATS());
}
function aidKit() { // ארגז לבן עם צלב אדום
  const b = newB(), F = frame(b), W = 0xeef0ee, Rd = 0xd22a2a, dk = 0x3a3d42, ms = 0xb8bcc2;
  F.bx(0.26, 0.17, 0.095, 0, 0.085, 0, W);
  F.bx(0.264, 0.008, 0.099, 0, 0.12, 0, shade(W, 0.78));    // תפר המכסה
  for (const s of [-1, 1]) { F.bx(0.08, 0.024, 0.004, 0, 0.085, s * 0.0495, Rd); F.bx(0.024, 0.08, 0.004, 0, 0.085, s * 0.0495, Rd); }
  for (const x of [-0.05, 0.05]) F.bx(0.012, 0.03, 0.014, x, 0.185, 0, dk);
  F.bx(0.112, 0.012, 0.016, 0, 0.2, 0, dk);                 // ידית
  for (const x of [-0.08, 0.08]) for (const s of [-1, 1]) F.bx(0.028, 0.034, 0.008, x, 0.12, s * 0.0485, ms, 'x');
  for (const x of [-1, 1]) for (const y of [0.012, 0.158]) for (const z of [-1, 1]) F.bx(0.02, 0.02, 0.02, x * 0.125, y, z * 0.04, shade(W, 0.7)); // פינות
  return b.build(MATS());
}
function medKit() { // תיק רפואה אדום עם צלב לבן
  const b = newB(), F = frame(b), Rd = 0xc8312c, W = 0xf4f2ec, dk = 0x2e3136, ms = 0xbfc3c9;
  F.bx(0.34, 0.22, 0.13, 0, 0.11, 0, Rd);
  F.bx(0.346, 0.012, 0.136, 0, 0.155, 0, shade(Rd, 0.62));
  for (const s of [-1, 1]) { F.bx(0.1, 0.034, 0.004, 0, 0.1, s * 0.067, W); F.bx(0.034, 0.1, 0.004, 0, 0.1, s * 0.067, W); }
  for (const x of [-0.07, 0.07]) F.bx(0.014, 0.036, 0.016, x, 0.24, 0, dk);
  F.bx(0.156, 0.014, 0.02, 0, 0.26, 0, dk);
  for (const x of [-0.11, 0.11]) for (const s of [-1, 1]) F.bx(0.036, 0.04, 0.01, x, 0.155, s * 0.066, ms, 'x');
  for (const x of [-1, 1]) for (const y of [0.014, 0.206]) for (const z of [-1, 1]) F.bx(0.03, 0.03, 0.03, x * 0.155, y, z * 0.057, dk);
  F.bx(0.2, 0.05, 0.004, 0, 0.18, -0.067, shade(Rd, 0.8)); // כיס אחורי
  return b.build(MATS());
}
function drinkCan(b, R, t) {
  const F = frame(b, R, t), al = 0xcfd3d8, cy = 0x2fc6ee;
  F.cy(0.034, 0.04, 0.012, 0, 0.006, 0, al, 'x', 16);
  F.cy(0.04, 0.04, 0.14, 0, 0.082, 0, cy, 'm', 16);
  F.cy(0.0408, 0.0408, 0.016, 0, 0.05, 0, 0xf4f4f0, 'm', 16); F.cy(0.0408, 0.0408, 0.016, 0, 0.114, 0, 0xf4f4f0, 'm', 16);
  F.cy(0.0412, 0.0412, 0.02, 0, 0.082, 0, 0x1d2a4a, 'm', 16);
  F.cy(0.04, 0.034, 0.012, 0, 0.158, 0, al, 'x', 16);
  F.cy(0.034, 0.034, 0.004, 0, 0.166, 0, al, 'x', 16);
  F.bx(0.022, 0.003, 0.012, 0.002, 0.1685, 0, 0x8b9096, 'x');
  // ברק צהוב על הפח
  F.bx(0.012, 0.034, 0.004, 0.004, 0.092, 0.0415, 0xffd23a, 'm', [0, 0, 0.35]);
  F.bx(0.012, 0.03, 0.004, -0.004, 0.066, 0.0415, 0xffd23a, 'm', [0, 0, 0.35]);
  F.bx(0.026, 0.008, 0.004, 0, 0.08, 0.0417, 0xffd23a, 'm');
}
function drink() {
  const b = newB();
  drinkCan(b, I3, [-0.055, 0, -0.01]);
  drinkCan(b, rotXYZ(0, 0.7, -Math.PI / 2), [-0.0, 0.04, 0.1]);
  return b.build(MATS());
}
function painkillers() {
  const b = newB(), F = frame(b), am = 0xd9892a, wh = 0xf5f2ea, Rd = 0xd33a3a;
  F.cy(0.046, 0.046, 0.12, -0.05, 0.06, 0, am, 'm', 18);                 // בקבוק ענבר
  F.cy(0.046, 0.027, 0.026, -0.05, 0.133, 0, am, 'm', 18);
  F.cy(0.0295, 0.0295, 0.01, -0.05, 0.151, 0, am, 'm', 14);
  F.cy(0.034, 0.034, 0.034, -0.05, 0.173, 0, wh, 'm', 16);              // מכסה
  for (const y of [0.162, 0.172, 0.182]) F.cy(0.0352, 0.0352, 0.004, -0.05, y, 0, shade(wh, 0.82), 'm', 16);
  F.cy(0.0468, 0.0468, 0.07, -0.05, 0.06, 0, wh, 'm', 18);              // תווית
  F.cy(0.0472, 0.0472, 0.012, -0.05, 0.086, 0, Rd, 'm', 18);
  F.bx(0.03, 0.008, 0.004, -0.05, 0.05, 0.0475, Rd); F.bx(0.008, 0.03, 0.004, -0.05, 0.05, 0.0475, Rd);
  const caps = (x, z, yaw) => { // כמוסה על הרצפה
    const f = frame(b, rotXYZ(0, yaw, Math.PI / 2), [x, 0.011, z]);
    f.cy(0.011, 0.011, 0.017, 0, -0.0085, 0, wh, 'm', 8); f.cy(0.011, 0.011, 0.017, 0, 0.0085, 0, Rd, 'm', 8);
    f.sp(0.011, 0, -0.017, 0, wh, 'm', 1, 1, true); f.sp(0.011, 0, 0.017, 0, Rd, 'm', 1, 1, true);
  };
  caps(0.06, 0.02, 0.4); caps(0.09, -0.035, 1.9); caps(0.105, 0.03, -0.6); caps(0.04, -0.06, 0.9);
  return b.build(MATS());
}
function adrenaline() { // מזרק אדרנלין: חבית שקופה עם נוזל כתום, בוכנה, אוגן אצבעות ומחט
  const b = newB(), R = rotXYZ(0, 0.25, -Math.PI / 2), F = frame(b, R, [-0.1, 0.034, 0]);
  const or = 0xf08a2a, wh = 0xf2f2ee;
  F.cy(0.0022, 0.0022, 0.05, 0, -0.03, 0, 0xcfd3d8, 'x', 6);             // מחט
  F.cy(0.012, 0.016, 0.02, 0, 0.0, 0, or, 'm', 10);                      // חיבור המחט
  F.cy(0.028, 0.028, 0.15, 0, 0.085, 0, 0xdce8f2, 'g', 18);              // חבית
  F.cy(0.0225, 0.0225, 0.1, 0, 0.06, 0, 0xff9a2e, 'm', 16);              // נוזל
  for (const y of [0.05, 0.075, 0.1, 0.125]) F.cy(0.0284, 0.0284, 0.0016, 0, y, 0, 0x4a4f58, 'm', 18);
  F.bx(0.09, 0.008, 0.032, 0, 0.162, 0, wh);                            // אוגן אצבעות
  F.bx(0.034, 0.08, 0.004, 0, 0.2, 0, wh); F.bx(0.004, 0.08, 0.034, 0, 0.2, 0, wh);   // מוט הבוכנה בצורת +
  F.cy(0.026, 0.026, 0.008, 0, 0.244, 0, or, 'm', 16);                  // כרית אגודל
  F.cy(0.0285, 0.0285, 0.01, 0, 0.055, 0, or, 'm', 18);                 // טבעת כתומה
  return b.build(MATS());
}
const MED = { band: bandage, aid: aidKit, kit: medKit, drink, pain: painkillers, adren: adrenaline };
const MED_S = { band: 1.3, aid: 1.15, kit: 1.0, drink: 1.5, pain: 1.5, adren: 1.45 };

// ---------- רימונים ----------
const GREN = {
  frag(b) { // רימון רסס: גוף זית עם פס צהוב, נצרה, ידית בטיחות וטבעת סיכה
    const F = frame(b), ol = 0x5d6e3a, ol2 = 0x48572d, st = 0x9aa0a8;
    F.sp(0.046, 0, 0, 0, ol, 'm', 1.12, 1);
    F.cy(0.0436, 0.0436, 0.012, 0, 0.02, 0, 0xe0c040, 'm', 14);
    F.cy(0.021, 0.019, 0.02, 0, 0.0585, 0, ol2, 'm', 10);
    F.cy(0.0235, 0.0235, 0.036, 0, 0.086, 0, st, 'x', 10);
    F.cy(0.025, 0.025, 0.006, 0, 0.107, 0, 0x6f757e, 'x', 10);
    const sp = [[0.022, 0.104, 0], [0.039, 0.092, 0], [0.049, 0.062, 0], [0.0495, 0.02, 0], [0.043, -0.02, 0], [0.032, -0.042, 0]];
    for (let i = 0; i < sp.length - 1; i++) seg(b, sp[i], sp[i + 1], 0.016, 0.004, 0xa7adb5, 'x');
    F.cy(0.0035, 0.0035, 0.064, 0, 0.088, 0, 0xc0c4ca, 'x', 6, [Math.PI / 2, 0, 0]);
    ringXY(b, 0, 0.088, 0.04, 0.012, 8, 0.0035, 0xc0c4ca);
  },
  smoke(b) { // רימון עשן: גליל אפור עם פס צבע, נצרה, ידית וטבעת
    const F = frame(b), gy = 0xb4bac0, dk = 0x4b5057, st = 0x9aa0a8;
    F.cy(0.04, 0.04, 0.13, 0, 0, 0, gy, 'm', 16);
    F.cy(0.0408, 0.0408, 0.02, 0, 0.02, 0, 0xe8c840, 'm', 16);
    F.cy(0.0412, 0.0412, 0.008, 0, -0.04, 0, shade(gy, 0.7), 'm', 16);
    F.cy(0.0415, 0.0415, 0.012, 0, -0.065, 0, dk, 'm', 16);
    F.cy(0.04, 0.024, 0.016, 0, 0.073, 0, dk, 'm', 16);
    F.cy(0.0195, 0.0195, 0.03, 0, 0.096, 0, st, 'x', 10);
    F.cy(0.021, 0.021, 0.005, 0, 0.1155, 0, 0x6f757e, 'x', 10);
    const sp = [[0.02, 0.114, 0], [0.036, 0.104, 0], [0.0445, 0.088, 0], [0.0445, 0.0, 0], [0.0445, -0.03, 0]];
    for (let i = 0; i < sp.length - 1; i++) seg(b, sp[i], sp[i + 1], 0.016, 0.004, 0xa7adb5, 'x');
    F.cy(0.0035, 0.0035, 0.064, 0, 0.096, 0, 0xc0c4ca, 'x', 6, [Math.PI / 2, 0, 0]);
    ringXY(b, 0, 0.096, 0.04, 0.012, 8, 0.0035, 0xc0c4ca);
  },
  stun(b) { // רימון הלם: גוף כהה עם חורי אוורור, כיפות מתכת ופס כתום
    const F = frame(b), body = 0x3a3f48, cap = 0xc3c8cf;
    F.cy(0.034, 0.034, 0.11, 0, 0, 0, body, 'm', 16);
    F.cy(0.0355, 0.0355, 0.016, 0, 0.063, 0, cap, 'x', 16); F.cy(0.0355, 0.0355, 0.016, 0, -0.063, 0, cap, 'x', 16);
    F.cy(0.0346, 0.0346, 0.012, 0, 0, 0, 0xe38a2c, 'm', 16);
    for (const yy of [0.032, -0.032]) for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU + (yy > 0 ? 0 : 0.39);
      F.bx(0.008, 0.014, 0.004, 0.0342 * Math.cos(a), yy, 0.0342 * Math.sin(a), 0x0c0d0f, 'm', [0, Math.PI / 2 - a, 0]);
    }
    F.cy(0.0165, 0.015, 0.026, 0, 0.084, 0, 0x6a707a, 'x', 10);
    F.cy(0.0185, 0.0185, 0.005, 0, 0.1, 0, 0x9aa0a8, 'x', 10);
    const sp = [[0.018, 0.098, 0], [0.0335, 0.09, 0], [0.0385, 0.078, 0], [0.0385, 0.0, 0], [0.0385, -0.03, 0]];
    for (let i = 0; i < sp.length - 1; i++) seg(b, sp[i], sp[i + 1], 0.014, 0.004, 0xa7adb5, 'x');
    F.cy(0.0035, 0.0035, 0.058, 0, 0.085, 0, 0xc0c4ca, 'x', 6, [Math.PI / 2, 0, 0]);
    ringXY(b, 0, 0.085, 0.036, 0.011, 8, 0.0035, 0xc0c4ca);
  },
  molo(b, lit) { // בקבוק מולוטוב: זכוכית ירקרקה שקופה, נוזל ענבר וסמרטוט בצוואר
    const F = frame(b), gl = 0x6fae5e;
    F.cy(0.0345, 0.0345, 0.092, 0, -0.024, 0, 0xe3a22e, 'm', 14);        // נוזל
    F.cy(0.04, 0.04, 0.1, 0, -0.02, 0, gl, 'g', 16);                      // גוף הבקבוק
    F.cy(0.04, 0.0165, 0.03, 0, 0.045, 0, gl, 'g', 16);                   // כתף
    F.cy(0.0165, 0.0165, 0.05, 0, 0.085, 0, gl, 'g', 12);                 // צוואר
    F.cy(0.0205, 0.0205, 0.01, 0, 0.11, 0, shade(gl, 0.8), 'x', 12);      // שפה
    F.cy(0.04, 0.04, 0.006, 0, -0.07, 0, shade(gl, 0.7), 'x', 16);        // בסיס
    // סמרטוט: חבילה תחובה בצוואר, שלוש רצועות פרושות מעט ושובל תלוי לאורך הצוואר
    F.cy(0.012, 0.016, 0.05, 0, 0.12, 0, 0xcdbf9a, 'm', 8);
    for (const [x, z, rx, rz] of [[0.004, 0.0, 0.0, -0.3], [-0.004, 0.004, 0.25, 0.3], [0.0, -0.004, -0.25, 0.05]]) F.bx(0.014, 0.06, 0.006, x, 0.16, z, 0xe9e0c8, 'm', [rx, 0, rz]);
    F.bx(0.016, 0.07, 0.006, 0.02, 0.095, 0.004, 0xdcd2b8, 'm', [0, 0, -0.08]);
    if (lit) { F.cy(0.024, 0.002, 0.085, 0, 0.225, 0, 0xff8a1a, 'l', 8); F.cy(0.013, 0.002, 0.055, 0, 0.215, 0, 0xffe05a, 'l', 8); }
  },
};
export function buildGrenade(kind, lit = false) {
  const fn = GREN[kind] || GREN.frag, key = 'gr:' + kind + (lit ? ':lit' : '');
  return fresh(proto(key, () => { const b = newB(); fn(b, lit); return b.build(MATS()); }));
}

// ---------- פריט לוט: גוף הפריט (בלי טבעת/קרן; הן נוספות ב-models.js) ----------
export function lootBody(info) {
  const id = info.id, key = info.type + ':' + id + ':' + (info.lvl || 0);
  if (info.type === 'ammo') return place(fresh(proto(key, () => ammoItem(id))), { s: 1.3 });
  if (info.type === 'med') return place(fresh(proto(key, () => (MED[id] || bandage)())), { s: MED_S[id] || 1.2 });
  if (info.type === 'throw') return place(buildGrenade(id), { s: 1.8 });
  if (info.type === 'scope') return place(buildOptic(id), { fit: 0.36 });
  if (info.type === 'helmet') return gearItem('helm', info.lvl);
  if (info.type === 'vest') return gearItem('vest', info.lvl);
  if (info.type === 'pack') return gearItem('pack', info.lvl);
  return new THREE.Group();
}

// ---------- מצנח ----------
// R/H = רדיוס וגובה הכיפה, y0 = גובה השפה, attach = נקודות חיבור של החבלים, risers = רצועות [x0,y0,z0,x1,y1,z1], lines = מספר חבלים
const CHUTE_DEF = { R: 3.2, H: 2.4, y0: 5, c1: 0xe5503c, c2: 0xf2eee4, lines: 12, attach: [[-0.5, 2.05, 0], [0.5, 2.05, 0]], risers: [[-0.5, 2.05, 0, -0.22, 1.5, 0.02], [0.5, 2.05, 0, 0.22, 1.5, 0.02]] };
export function buildParachute(o) {
  const q = Object.assign({}, CHUTE_DEF, o), key = 'chute:' + JSON.stringify(q);
  return fresh(proto(key, () => {
    const b = newB(), NG = 12, PG = 4, N = NG * PG, PH = [0.14, 0.42, 0.7, 0.98, 1.26, Math.PI / 2], rings = [];
    for (let j = 0; j < PH.length; j++) {
      const ph = PH[j], rr = q.R * Math.sin(ph), yy = q.y0 + q.H * Math.cos(ph), ring = [];
      for (let i = 0; i < N; i++) {
        const a = (i / N) * TAU, fr = (i % PG) / PG, sn = Math.sin(Math.PI * fr);
        const bulge = 1 + 0.05 * sn * Math.sin(ph); // תפיחה בין התפרים
        ring.push([rr * bulge * Math.cos(a), yy + (j === PH.length - 1 ? 0.2 * sn : 0), rr * bulge * Math.sin(a)]); // שפה מסולסלת
      }
      rings.push(ring);
    }
    b.loft(rings, { capStart: true, capColor: 0x2a2a2e, c: q.c1, color: (i) => (((i / PG) | 0) % 2 ? q.c2 : q.c1) }, 'c');
    for (let i = 0; i < q.lines; i++) { // חבלי תליה מהשפה אל נקודות החיבור הקרובות
      const a = (i / q.lines) * TAU, p0 = [q.R * Math.cos(a), q.y0, q.R * Math.sin(a)];
      let best = q.attach[0], bd = 1e9;
      for (const t of q.attach) { const d = (t[0] - p0[0]) ** 2 + (t[2] - p0[2]) ** 2; if (d < bd) { bd = d; best = t; } }
      seg(b, p0, best, 0.014, 0.014, 0xe3e3dc, 'm');
    }
    for (const r of q.risers) seg(b, [r[0], r[1], r[2]], [r[3], r[4], r[5]], 0.035, 0.014, 0x2d3036, 'm');
    return b.build(MATS());
  }));
}

// ---------- חבילת אספקה ----------
const CRATE_H = 1.2;
function crateModel() {
  const b = newB(), F = frame(b), red = 0xc4452a, redL = 0xd9593c, redD = 0x8d2f1c, steel = 0x3c4249, wd = 0x7b5a37, wh = 0xf1efe6, ms = 0xb4b8be;
  for (const z of [-0.52, 0.52]) F.bx(1.64, 0.1, 0.16, 0, 0.05, z, wd);                  // מזחלות עץ
  F.bx(1.56, 0.06, 1.56, 0, 0.13, 0, steel);
  F.bx(1.46, 0.94, 1.46, 0, 0.63, 0, red);                                                   // גוף
  F.bx(1.6, 0.1, 1.6, 0, 1.15, 0, steel);                                                    // מסגרת מכסה
  F.bx(1.2, 0.04, 1.2, 0, 1.22, 0, 0x4a5058);
  for (const x of [-1, 1]) for (const z of [-1, 1]) F.bx(0.12, 1.0, 0.12, x * 0.73, 0.66, z * 0.73, steel, 'x'); // עמודי פינה
  for (let k = 0; k < 4; k++) { // ארבע הפאות (כל אחת מוגדרת כפאה +Z ומסובבת)
    const f = frame(b, rotXYZ(0, (k * Math.PI) / 2, 0));
    f.bx(1.0, 0.62, 0.03, 0, 0.62, 0.745, redL);
    f.bx(1.18, 0.05, 0.02, 0, 0.62, 0.765, redD, 'm', [0, 0, 0.554]); f.bx(1.18, 0.05, 0.02, 0, 0.62, 0.765, redD, 'm', [0, 0, -0.554]);
    f.bx(1.06, 0.04, 0.026, 0, 0.94, 0.76, redD); f.bx(1.06, 0.04, 0.026, 0, 0.3, 0.76, redD);
    for (const x of [-0.52, 0.52]) f.bx(0.04, 0.68, 0.026, x, 0.62, 0.76, redD);
    f.bx(1.46, 0.07, 0.012, 0, 1.01, 0.737, wh);                                             // פס לבן
    f.bx(0.3, 0.07, 0.012, 0, 0.62, 0.785, wh); f.bx(0.07, 0.3, 0.012, 0, 0.62, 0.785, wh); // סימן "+"
    for (const x of [-0.42, 0.42]) { f.bx(0.14, 0.2, 0.05, x, 1.06, 0.76, ms, 'x'); f.bx(0.08, 0.04, 0.06, x, 1.0, 0.77, 0x6a6f76, 'x'); } // תפסים
  }
  F.bx(0.07, 0.34, 0.07, 0, 1.4, 0, steel, 'x');                                              // תורן משואה
  F.sp(0.1, 0, 1.62, 0, 0xff3a1a, 'l');
  F.cy(0.012, 0.012, 0.9, 0.55, 1.65, 0.55, 0x2b2f35, 'x', 6);                                // אנטנה
  return b.build(MATS());
}
export function buildAirdrop() {
  const g = new THREE.Group();
  g.add(fresh(proto('crate', crateModel)));
  const chute = buildParachute({ R: 3.9, H: 2.7, y0: 4.8, c1: 0xff7b2e, c2: 0xf4f0e6, lines: 16, risers: [], attach: [[-0.66, 0, -0.66], [0.66, 0, -0.66], [0.66, 0, 0.66], [-0.66, 0, 0.66]] });
  chute.position.y = CRATE_H; g.add(chute); g.userData.chute = chute;
  return g;
}
