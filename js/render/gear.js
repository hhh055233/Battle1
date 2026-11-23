// ציוד מגן לדמות ולרצפה: קסדות, אפודים ותיקים (3 רמות כל אחד). עיצוב מקורי, בנוי מגאומטריה מאוחדת עם צבעי קודקודים.
// קסדה: קואורדינטות של ראש (ללא הסקאלה); אפוד: קואורדינטות של פלג גוף עליון; תיק: מקור בתחתית, בחזית התיק (פונה אל הגב), גב התיק ב-Z חיובי.
import * as THREE from 'three';
import { Builder, TAU, vcMat, pchip, ringY, shade, mixc } from './kit.js';
import { TORSO_BASE, SHIRT_FAT } from './character.js';

const U = {};
const BOX = () => (U.box ||= new THREE.BoxGeometry(1, 1, 1));
const SPH = () => (U.sph ||= new THREE.SphereGeometry(1, 18, 12));
const SPL = () => (U.spl ||= new THREE.SphereGeometry(1, 10, 8));
const CYL = () => (U.cyl ||= new THREE.CylinderGeometry(1, 1, 1, 14));
const CAP = (th) => (U['cap' + th] ||= new THREE.SphereGeometry(1, 48, 22, 0, TAU, 0, th));
// רצועה על כיפה: theta מ-a עד b, phi מ-p0 באורך pl (חזית הדמות = phi 3π/2)
const BAND = (a, b, p0, pl) => (U[`band${a}_${b}_${p0}_${pl}`] ||= new THREE.SphereGeometry(1, 26, 6, p0, pl, a, b - a));
const FRONT = Math.PI * 1.5;

const hash = (i) => { const h = Math.sin(i * 127.1 + 311.7) * 43758.5453; return h - Math.floor(h); };

// פס/רצועה בין שתי נקודות (קופסה מיושרת לקטע)
function seg(b, p0, p1, w, t, c, key) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2], L = Math.hypot(dx, dy, dz) || 1e-6, ez = [dx / L, dy / L, dz / L];
  let ex = [ez[2], 0, -ez[0]]; const lx = Math.hypot(ex[0], ex[1], ex[2]); if (lx < 1e-4) ex = [1, 0, 0]; else ex = ex.map((v) => v / lx);
  const ey = [ez[1] * ex[2] - ez[2] * ex[1], ez[2] * ex[0] - ez[0] * ex[2], ez[0] * ex[1] - ez[1] * ex[0]];
  b.add(BOX(), { s: [w, t, L], m: [ex[0], ey[0], ez[0], ex[1], ey[1], ez[1], ex[2], ey[2], ez[2]], p: [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2], c }, key);
}
const camo = (x, y, z) => { const n = Math.sin(x * 12 + 1.3) * Math.cos(z * 10 + 0.4) + 0.8 * Math.sin(y * 14 + z * 8) + 0.5 * Math.sin((x + z) * 19); return n > 0.55 ? 0x3d4a27 : n < -0.5 ? 0x7a8a4e : 0x5b6b3a; };

const MATS = () => ({ m: vcMat('gear-m', 0.74, 0.03), x: vcMat('gear-x', 0.34, 0.65), g: vcMat('gear-g', 0.1, 0.35) });

// ---------- פרופיל הגוף העליון (לאפוד/תיק) ----------
const TY = TORSO_BASE.map((r) => r[0]);
const tw = pchip(TY, TORSO_BASE.map((r) => r[1])), td = pchip(TY, TORSO_BASE.map((r) => r[2])), tcz = pchip(TY, TORSO_BASE.map((r) => r[3]));
const front = (y, f) => tcz(y) - td(y) / 2 - f; // z של פני החולצה (קדימה = Z שלילי)
const back = (y, f) => tcz(y) + td(y) / 2 + f;
// z של פני הגוף בנקודה (x, y) לפי חתך הסופר-אליפסה של הגוף (sgn: -1 קדימה, +1 אחורה), כולל עובי בד f
const surf = (x, y, f, sgn) => { const hw = tw(y) / 2 + f, hd = td(y) / 2 + f, q = Math.min(0.999, Math.pow(Math.abs(x) / hw, 2.5)); return tcz(y) + sgn * hd * Math.pow(1 - q, 0.4); };
// גובה משטח הכתף בנקודה x (קצה הכתף ~0.63, צמוד לצוואר ~0.655)
const ytop = (x, f) => 0.63 + 0.025 * Math.max(0, Math.min(1, (0.165 + f - Math.abs(x)) / 0.08));
// רצועה מעל הכתף: קדימה-למעלה-אחורה (נקודות מפתח), מתחברת לקצה הפנימי של הגוף
function overShoulder(b, x, f, lift, w, t, c, down = null) {
  const yt = ytop(x, f) + lift + t / 2, zf = surf(x, 0.6, f, -1) - lift * 0.6, zb = surf(x, 0.6, f, 1) + lift * 0.6;
  const pts = [[x, 0.585, zb], [x, yt, zb * 0.55], [x, yt, zf * 0.55], [x, 0.585, zf]];
  if (down) for (const [yy, kx] of down) pts.push([x * kx, yy, surf(x * kx, yy, f, -1) - lift * 0.5]);
  for (let i = 0; i < pts.length - 1; i++) seg(b, pts[i], pts[i + 1], w, t, c);
}

// ---------- קסדות ----------
function chinStrap(b, c, w = 0.009) { // רצועה לאורך הלסת מהאוזן אל מתחת לסנטר
  for (const s of [-1, 1]) {
    seg(b, [s * 0.112, -0.02, 0.012], [s * 0.06, -0.122, -0.012], w, 0.01, c);
    seg(b, [s * 0.06, -0.122, -0.012], [s * 0.02, -0.142, -0.05], w, 0.01, c);
  }
  b.add(BOX(), { s: [0.05, 0.014, 0.022], p: [0, -0.146, -0.056], c });
}
function helmet1(b) { // קסדת אופנוען (לבנה עם פס אדום ומגן כהה מורם)
  const white = 0xf3f3f0, stripe = 0xd23c3c, dark = 0x15191e, S = [0.143, 0.166, 0.159], P = [0, 0.0, 0.012], T = 0.5;
  b.add(CAP(Math.PI * 0.5), { s: S, r: [T, 0, 0], p: P, c: (x, y) => (Math.abs(x) < 0.09 && y > 0.1 ? stripe : white) });
  b.add(BAND(Math.PI * 0.482, Math.PI * 0.5, 0, TAU), { s: S.map((v) => v * 1.008), r: [T, 0, 0], p: P, c: 0x2a2f36 }); // קנט שולי
  b.add(BAND(Math.PI * 0.3, Math.PI * 0.44, FRONT - 0.7, 1.4), { s: S.map((v) => v * 1.014), r: [T, 0, 0], p: P, c: dark }, 'g'); // מגן מורם
  for (const s of [-1, 1]) b.add(SPL(), { s: [0.014, 0.032, 0.034], p: [s * 0.122, -0.012, 0.014], c: 0x1f2328 }); // רפידות אוזניים
  chinStrap(b, 0x1a1d21);
  b.add(BOX(), { s: [0.02, 0.016, 0.012], p: [0, -0.148, -0.07], c: 0xb8bcc2 }, 'x'); // אבזם
}
function helmet2(b) { // קסדה צבאית (זית, דוגמת הסוואה)
  const ol = 0x5b6b3a, S = [0.14, 0.158, 0.16], P = [0, -0.004, 0.012], T = 0.52;
  b.add(CAP(Math.PI * 0.52), { s: S, r: [T, 0, 0], p: P, c: camo });
  b.add(BAND(Math.PI * 0.488, Math.PI * 0.52, 0, TAU), { s: S.map((v) => v * 1.01), r: [T, 0, 0], p: P, c: shade(ol, 0.55) }); // שפה
  for (const s of [-1, 1]) {
    b.add(SPL(), { s: [0.01, 0.01, 0.008], p: [s * 0.134, -0.004, 0.012], c: 0xb8bcc2 }, 'x'); // מסמרות
    b.add(SPL(), { s: [0.014, 0.034, 0.034], p: [s * 0.122, -0.012, 0.014], c: 0x2a2f1c }); // רפידות
  }
  b.add(BOX(), { s: [0.05, 0.026, 0.022], p: [0, 0.082, -0.148], r: [0.5, 0, 0], c: shade(ol, 0.7) }); // לוחית קדמית
  chinStrap(b, 0x2a2f1c);
}
function helmet3(b) { // קסדת ספצנאז: שחורה, גזרה גבוהה, אוזניות קשר, מסילות, משקפות על המצח
  const bk = 0x1f2326, S = [0.134, 0.147, 0.152], P = [0, 0.006, 0.014], T = 0.36;
  b.add(CAP(Math.PI * 0.44), { s: S, r: [T, 0, 0], p: P, c: (x, y, z) => shade(bk, 0.9 + 0.2 * hash(Math.round(x * 7) + Math.round(z * 11))) });
  b.add(BAND(Math.PI * 0.415, Math.PI * 0.44, 0, TAU), { s: S.map((v) => v * 1.012), r: [T, 0, 0], p: P, c: 0x363b41 });
  for (const s of [-1, 1]) {
    const cup = (rr, hh, z, cc) => { b.add(CYL(), { s: [rr, hh, rr], r: [0, 0, Math.PI / 2], p: [s * 0.124, -0.006, z], c: cc }); };
    cup(0.034, 0.02, 0.016, 0x2a2e33); cup(0.026, 0.026, 0.016, 0x15171a); // אוזניית קשר
    b.add(BOX(), { s: [0.008, 0.014, 0.13], p: [s * 0.131, 0.05, 0.004], r: [-0.12, 0, 0], c: 0x6a6f76 }, 'x'); // מסילה צדית
  }
  // משקפות מורמות על המצח + מעמד NVG
  b.add(BOX(), { s: [0.13, 0.036, 0.03], p: [0, 0.098, -0.119], r: [0.62, 0, 0], c: 0x2c3036 });
  b.add(BOX(), { s: [0.112, 0.024, 0.01], p: [0, 0.094, -0.136], r: [0.62, 0, 0], c: 0x3d6a74 }, 'g');
  b.add(BOX(), { s: [0.05, 0.024, 0.022], p: [0, 0.122, -0.098], r: [0.55, 0, 0], c: 0x7b8088 }, 'x');
  b.add(BOX(), { s: [0.09, 0.056, 0.036], p: [0, 0.004, 0.157], c: 0x2a2e33 }); // משקל נגדי אחורי
  chinStrap(b, 0x14161a, 0.008);
}

// ---------- אפודים ----------
function vest(b, lvl, ss) {
  const col = [0, 0x3b4048, 0x26324a, 0x6d6a45][lvl], f = SHIRT_FAT[ss] + 0.016 + (lvl - 1) * 0.004, Y = [0.17, 0.2, 0.3, 0.4, 0.5, 0.565, 0.6];
  const trim = shade(col, 0.7), side = shade(col, 0.86), mol = shade(col, 0.78);
  b.loft(Y.map((y) => ringY(0, tcz(y), y, tw(y) + 2 * f, td(y) + 2 * f, 2.5, 30)), {
    capStart: false, c: col, jitter: 0.03,
    color: (i, j, cx, cy, cz, nx) => (cy < 0.19 ? trim : Math.abs(nx) > 0.8 ? side : col),
  });
  const zf = (y) => front(y, f), zb = (y) => back(y, f);
  // רצועות כתף וכריות
  for (const s of [-1, 1]) {
    overShoulder(b, s * 0.125, SHIRT_FAT[ss], 0.004 + (lvl - 1) * 0.002, 0.07, 0.016, trim);
    if (lvl >= 2) b.add(SPH(), { s: [0.07, 0.026, 0.085], p: [s * 0.205, 0.622 + SHIRT_FAT[ss] * 0.3, -0.004], r: [0, 0, -0.25 * s], c: side }); // כרית כתף
  }
  const pouch = (x, y, w, h, d, c, fl = true) => {
    b.add(BOX(), { s: [w, h, d], p: [x, y, zf(y) - d / 2 + 0.006], c });
    if (fl) { b.add(BOX(), { s: [w * 1.02, h * 0.3, d * 1.08], p: [x, y + h * 0.36, zf(y) - d / 2 + 0.006 - 0.003], c: shade(c, 0.82) }); b.add(BOX(), { s: [w * 0.18, h * 0.1, 0.006], p: [x, y + h * 0.24, zf(y) - d - 0.0], c: 0xb8bcc2 }, 'x'); }
  };
  if (lvl === 1) { // אפוד משטרה: פסי זוהר, תג, שתי כיסים
    for (const dy of [0.395, 0.355]) b.add(BOX(), { s: [0.3, 0.014, 0.008], p: [0, dy, zf(dy) - 0.003], c: 0xc9ced4 });
    b.add(BOX(), { s: [0.07, 0.085, 0.01], p: [-0.12, 0.49, zf(0.49) - 0.003], c: 0xd9dde2 }); // תג
    b.add(BOX(), { s: [0.05, 0.055, 0.012], p: [-0.12, 0.49, zf(0.49) - 0.005], c: 0x23272d });
    pouch(-0.08, 0.26, 0.085, 0.085, 0.035, shade(col, 1.12)); pouch(0.08, 0.26, 0.085, 0.085, 0.035, shade(col, 1.12));
    b.add(BOX(), { s: [0.3, 0.014, 0.008], p: [0, 0.4, zb(0.4) + 0.003], c: 0xc9ced4 }); b.add(BOX(), { s: [0.3, 0.014, 0.008], p: [0, 0.36, zb(0.36) + 0.003], c: 0xc9ced4 });
  } else if (lvl === 2) { // נשא לוחות: לוח קדמי + אחורי, שלושה כיסי מחסניות, כתפיות רחבות
    b.add(BOX(), { s: [0.27, 0.3, 0.03], p: [0, 0.42, zf(0.42) - 0.011], c: 0x3a4a68 });
    b.add(BOX(), { s: [0.24, 0.27, 0.01], p: [0, 0.42, zf(0.42) - 0.028], c: 0x4a5a78 });
    b.add(BOX(), { s: [0.27, 0.3, 0.03], p: [0, 0.42, zb(0.42) + 0.011], c: 0x3a4a68 });
    for (const x of [-0.095, 0, 0.095]) pouch(x, 0.255, 0.08, 0.1, 0.04, shade(col, 1.2));
    pouch(0.17, 0.4, 0.05, 0.11, 0.036, shade(col, 1.15), false);
  } else { // אפוד צבאי: MOLLE, שלושה כיסי מחסניות, כיס קשר, צווארון הגנה ותליון
    b.add(BOX(), { s: [0.29, 0.32, 0.034], p: [0, 0.42, zf(0.42) - 0.012], c: shade(col, 1.08) });
    for (let r = 0; r < 4; r++) for (let k = -3; k <= 3; k++) b.add(BOX(), { s: [0.022, 0.0045, 0.006], p: [k * 0.038, 0.33 + r * 0.05, zf(0.33 + r * 0.05) - 0.031], c: mol });
    b.add(BOX(), { s: [0.29, 0.32, 0.034], p: [0, 0.42, zb(0.42) + 0.012], c: shade(col, 1.08) });
    for (let r = 0; r < 4; r++) for (let k = -3; k <= 3; k++) b.add(BOX(), { s: [0.022, 0.0045, 0.006], p: [k * 0.038, 0.33 + r * 0.05, zb(0.33 + r * 0.05) + 0.031], c: mol });
    for (const x of [-0.098, 0, 0.098]) pouch(x, 0.255, 0.088, 0.105, 0.045, shade(col, 1.25));
    pouch(-0.16, 0.45, 0.06, 0.13, 0.04, shade(col, 1.18)); // כיס קשר
    b.add(CYL(), { s: [0.004, 0.09, 0.004], p: [-0.16, 0.56, zf(0.45) - 0.02], c: 0x15171a });
    b.add(BOX(), { s: [0.17, 0.05, 0.03], p: [0, 0.62, zf(0.6) - 0.012], c: shade(col, 0.82) }); // תליון קדמי
    b.add(BOX(), { s: [0.11, 0.07, 0.03], p: [0, 0.13, zb(0.17) + 0.015], c: shade(col, 1.05) }); // כיס אחורי
  }
}

// ---------- תיקים ----------
// מקור: מרכז תחתית התיק, פני התיק הצמודים לגב ב-Z=0, התיק מתרחב ל-Z חיובי
function pack(b, lvl, ss) {
  const S = [0, { w: 0.3, h: 0.34, d: 0.14, c: 0xc9b58a }, { w: 0.34, h: 0.45, d: 0.19, c: 0x56743c }, { w: 0.38, h: 0.52, d: 0.25, c: 0x4b5838 }][lvl];
  const { w, h, d, c } = S, dk = shade(c, 0.66), lt = shade(c, 1.12), strapC = 0x1b1d1f;
  const prof = [[0, 0.9, 0.86], [0.1 * h, 0.99, 0.97], [0.5 * h, 1.0, 1.0], [0.88 * h, 0.95, 0.9], [h, 0.82, 0.72]];
  b.loft(prof.map(([y, kw, kd]) => ringY(0, d / 2, y, w * kw, d * kd, 3.0, 26)), { capStart: true, capEnd: true, c, jitter: 0.04, capColor: dk });
  // שולי תפר עליון ותחתון
  b.add(BOX(), { s: [w * 0.92, 0.012, d * 0.86], p: [0, 0.006, d / 2], c: dk });
  if (lvl === 1) {
    b.add(BOX(), { s: [w * 0.78, h * 0.4, 0.05], p: [0, h * 0.3, d + 0.022], c: lt }); // כיס קדמי
    b.add(BOX(), { s: [w * 0.78, 0.008, 0.052], p: [0, h * 0.5, d + 0.022], c: dk });
    b.add(BOX(), { s: [0.1, 0.02, 0.03], p: [0, h + 0.006, d * 0.5], c: strapC }); // ידית
    b.add(BOX(), { s: [0.012, h * 0.7, 0.01], p: [0, h * 0.5, d + 0.0], c: dk });
  } else if (lvl === 2) {
    for (const s of [-1, 1]) b.add(BOX(), { s: [0.05, h * 0.42, d * 0.6], p: [s * (w / 2 + 0.018), h * 0.27, d * 0.52], c: lt }); // כיסי צד
    b.add(BOX(), { s: [w * 0.8, h * 0.36, 0.055], p: [0, h * 0.32, d + 0.025], c: lt }); // כיס אחורי
    b.add(BOX(), { s: [w * 0.9, h * 0.16, d * 0.92], p: [0, h * 0.97, d * 0.5], c: dk }); // מכסה עליון
    for (const s of [-1, 1]) { b.add(BOX(), { s: [0.022, h * 0.6, 0.012], p: [s * 0.07, h * 0.62, d + 0.006], c: strapC }); b.add(BOX(), { s: [0.026, 0.028, 0.016], p: [s * 0.07, h * 0.9, d + 0.012], c: 0xb8bcc2 }, 'x'); }
    b.add(CYL(), { s: [0.05, w * 0.9, 0.05], r: [0, 0, Math.PI / 2], p: [0, -0.04, d * 0.5], c: 0xcdbd8e }); // מזרן מגולגל
  } else {
    for (const s of [-1, 1]) {
      b.add(BOX(), { s: [0.07, h * 0.5, d * 0.7], p: [s * (w / 2 + 0.03), h * 0.3, d * 0.52], c: lt }); // כיסי צד
      b.add(BOX(), { s: [0.075, h * 0.12, d * 0.72], p: [s * (w / 2 + 0.03), h * 0.58, d * 0.52], c: dk });
    }
    b.add(BOX(), { s: [w * 0.9, h * 0.3, 0.06], p: [0, h * 0.24, d + 0.028], c: lt });
    b.add(BOX(), { s: [w * 0.96, h * 0.15, d * 0.96], p: [0, h * 0.97, d * 0.5], c: dk });
    for (let r = 0; r < 4; r++) for (let k = -2; k <= 2; k++) b.add(BOX(), { s: [0.038, 0.006, 0.008], p: [k * 0.06, h * 0.4 + r * 0.06, d + 0.004], c: dk }); // MOLLE
    for (const s of [-1, 1]) { b.add(BOX(), { s: [0.026, h * 0.7, 0.012], p: [s * 0.1, h * 0.55, d + 0.056], c: strapC }); b.add(BOX(), { s: [0.032, 0.03, 0.018], p: [s * 0.1, h * 0.82, d + 0.062], c: 0xb8bcc2 }, 'x'); }
    b.add(CYL(), { s: [0.062, w * 0.95, 0.062], r: [0, 0, Math.PI / 2], p: [0, -0.05, d * 0.52], c: 0x4a5d38 }); // שק שינה מגולגל
    b.add(CYL(), { s: [0.04, 0.2, 0.04], p: [w / 2 + 0.085, h * 0.3, d * 0.55], c: 0x2c6e8f }); // בקבוק מים
    b.add(CYL(), { s: [0.026, 0.03, 0.026], p: [w / 2 + 0.085, h * 0.3 + 0.115, d * 0.55], c: 0xe6e6e6 });
  }
}

// רצועות הכתף של התיק (על הכתפיים והחזה) — נבנות לפי סגנון החולצה
function packStraps(b, ss, lvl) {
  const f = SHIRT_FAT[ss] + 0.006, c = 0x1b1d1f;
  for (const s of [-1, 1]) {
    overShoulder(b, s * 0.15, SHIRT_FAT[ss], 0.014, 0.05, 0.022, c, [[0.5, 0.78], [0.34, 0.74]]);
    seg(b, [s * 0.15 * 0.74, 0.34, surf(s * 0.15 * 0.74, 0.34, f, -1)], [s * 0.2, 0.3, surf(s * 0.2, 0.3, f, 0) + 0.12], 0.04, 0.016, c); // רצועת צד אל התיק
  }
  const y = 0.5; seg(b, [-0.11, y, surf(0.11, y, f + 0.014, -1)], [0.11, y, surf(0.11, y, f + 0.014, -1)], 0.014, 0.012, c); // רצועת חזה
  if (lvl >= 2) b.add(BOX(), { s: [0.03, 0.03, 0.016], p: [0, y, surf(0, y, f + 0.014, -1) - 0.006], c: 0xb8bcc2 }, 'x');
}

// ---------- מחסן וממשק ----------
const CACHE = new Map();
function make(kind, lvl, ss) {
  const b = new Builder();
  if (kind === 'helm') [null, helmet1, helmet2, helmet3][lvl](b);
  else if (kind === 'vest') vest(b, lvl, ss);
  else { pack(b, lvl, ss); }
  return b.build(MATS());
}

// מחזיר קבוצה חדשה עם mesh-ים שחולקים גאומטריה (לא משכפל נתונים)
export function gearGroup(kind, lvl, ss = 0) {
  const key = kind + lvl + ':' + (kind === 'helm' ? 0 : ss);
  let proto = CACHE.get(key);
  if (!proto) { proto = make(kind, lvl, ss); CACHE.set(key, proto); }
  const g = new THREE.Group();
  for (const m of proto.children) g.add(new THREE.Mesh(m.geometry, m.material));
  return g;
}

// נקודת העיגון של תיק על הגב (בקואורדינטות פלג גוף עליון) לפי סגנון חולצה ורמת אפוד (האפוד מעבה את הגב)
export function packMount(lvl, ss, vestLvl = 0) {
  const vz = vestLvl > 0 ? [0, 0.026, 0.044, 0.056][vestLvl] : 0;
  return [0, [0, 0.27, 0.2, 0.17][lvl], back(0.3, SHIRT_FAT[ss]) + 0.012 + vz];
}

// רצועות התיק על הכתפיים והחזה (קבוצה נפרדת בקואורדינטות פלג גוף עליון)
export function packStrapGroup(lvl, ss) {
  const key = 'ps' + lvl + ':' + ss;
  let proto = CACHE.get(key);
  if (!proto) { const b = new Builder(); packStraps(b, ss, lvl); proto = b.build(MATS()); CACHE.set(key, proto); }
  const g = new THREE.Group();
  for (const m of proto.children) g.add(new THREE.Mesh(m.geometry, m.material));
  return g;
}
