// גוף הדמות בסגנון "מצויר-ריאליסטי" (פרופורציות מעט מוגזמות, צורות חלקות, צבעים נקיים). עיצוב מקורי.
// כל חלק בגוף הוא mesh אחד עם צבעי קודקודים שנאפו לפי ה-look (שיער, עור, חולצה, מכנסיים), לכן פחות draw-calls.
// הדמות פונה ל-Z שלילי; מפרקים: ירך (0,0.9), ברך (0,-0.45), כתף (±0.25,0.54), מרפק (0,-0.3), ראש (0,0.78).
import * as THREE from 'three';
import { Builder, TAU, vcMat, mul3, rotY, rotZ, rotX, pchip, ringY, shade, mixc } from './kit.js';
import { HAIR_COLORS, SKIN_TONES, SHIRT_COLORS, PANTS_COLORS, sanitizeLook } from '../sim/look.js';

const hash3 = (x, y, z) => { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); };

const U = {};
const BOX = () => (U.box ||= new THREE.BoxGeometry(1, 1, 1));
const SPH = () => (U.sph ||= new THREE.SphereGeometry(1, 20, 14));
const SPL = () => (U.spl ||= new THREE.SphereGeometry(1, 10, 8));
const CYL = () => (U.cyl ||= new THREE.CylinderGeometry(1, 1, 1, 12));
const CON = () => (U.con ||= new THREE.ConeGeometry(1, 1, 10));
const CAP = (th) => (U['cap' + th] ||= new THREE.SphereGeometry(1, 30, 14, 0, TAU, 0, th));

// טבעת סביב ציר Z (לנעליים)
function ringZ(cx, cy, z, w, h, n = 2.4, N = 20) {
  const out = [], e = 2 / n;
  for (let k = 0; k < N; k++) {
    const t = (k / N) * TAU, c = Math.cos(t), s = Math.sin(t);
    out.push([cx + (w / 2) * Math.sign(c) * Math.pow(Math.abs(c), e), cy + (h / 2) * Math.sign(s) * Math.pow(Math.abs(s), e), z]);
  }
  return out;
}

export const CHAR_MAT = () => vcMat('char', 0.82, 0.0);
export const HAIR_MAT = () => vcMat('hair', 0.6, 0.0);

export function resolveLook(look) {
  const [hs, hc, sk, ss, sc, ps, pc] = sanitizeLook(look);
  const skin = SKIN_TONES[sk];
  return {
    hs, hair: HAIR_COLORS[hc], skin, ss, shirt: SHIRT_COLORS[sc], ps, pants: PANTS_COLORS[pc],
    skinDark: shade(skin, 0.9), lip: mixc(skin, 0xb4504c, 0.5), eye: [0x3a2412, 0x4d6c8c, 0x4f7a4c][(hc + sk) % 3],
  };
}

// ---------- ראש ופנים ----------
// פרופיל הראש (y, רוחב, עומק, הזזת z): לופט חלק אחד, עם לסת וסנטר
const HROWS = [[0.131, 0.03, 0.03, 0.006], [0.122, 0.1, 0.105, 0.004], [0.1, 0.172, 0.19, 0.002], [0.065, 0.205, 0.224, 0.0], [0.02, 0.212, 0.232, 0.0], [-0.02, 0.204, 0.226, -0.002], [-0.06, 0.172, 0.2, -0.01], [-0.095, 0.128, 0.16, -0.022], [-0.123, 0.075, 0.1, -0.03], [-0.138, 0.04, 0.06, -0.032], [-0.144, 0.012, 0.02, -0.032]];
const hzs = HROWS.map((r) => r[0]).reverse();
const hzW = pchip(hzs, HROWS.map((r) => r[1]).reverse()), hzD = pchip(hzs, HROWS.map((r) => r[2]).reverse()), hzC = pchip(hzs, HROWS.map((r) => r[3]).reverse());
// z של פני הראש בנקודה (x, y) – מקור לכל הפרטים בפנים
const hz = (x, y) => hzC(y) - (hzD(y) / 2) * Math.sqrt(Math.max(0.02, 1 - (x / (hzW(y) / 2)) ** 2));

function headMesh(L) {
  const b = new Builder();
  b.loft(HROWS.map(([y, w, d, cz]) => ringY(0, cz, y, w, d, 2.0, 30)), { flip: true, capStart: true, capEnd: true, c: L.skin });
  for (const s of [-1, 1]) {
    b.add(SPL(), { s: [0.011, 0.027, 0.019], p: [s * 0.104, -0.005, 0.01], c: L.skinDark }); // אוזניים
    const ex = s * 0.041, ey = 0.016, z = hz(ex, ey);
    b.add(SPL(), { s: [0.0158, 0.012, 0.01], p: [ex, ey, z + 0.002], c: 0xf4f1ec });
    b.add(SPL(), { s: [0.0095, 0.0095, 0.006], p: [ex, ey, z - 0.003], c: L.eye });
    b.add(SPL(), { s: [0.005, 0.005, 0.004], p: [ex, ey, z - 0.0052], c: 0x0b0b0c });
    b.add(BOX(), { s: [0.04, 0.0095, 0.012], p: [s * 0.042, 0.044, hz(s * 0.042, 0.044) + 0.0015], r: [0, 0, -0.1 * s], c: shade(L.hair, 0.85) }); // גבות
  }
  b.add(SPL(), { s: [0.008, 0.02, 0.009], p: [0, 0.004, hz(0, 0.004) - 0.0005], c: L.skin }); // גשר האף
  b.add(SPL(), { s: [0.0135, 0.0125, 0.0135], p: [0, -0.024, hz(0, -0.024) - 0.004], c: L.skinDark }); // אף
  b.add(SPL(), { s: [0.024, 0.0045, 0.008], p: [0, -0.06, hz(0, -0.06) + 0.0005], c: L.lip }); // שפתיים
  b.add(SPL(), { s: [0.02, 0.0055, 0.008], p: [0, -0.07, hz(0, -0.07) + 0.0005], c: shade(L.lip, 1.06) });
  b.add(BOX(), { s: [0.036, 0.0022, 0.004], p: [0, -0.0645, hz(0, -0.0645) + 0.002], c: 0x5a2a28 });
  return b.build({ m: CHAR_MAT() }).children[0];
}

// נקודה על כיפת שיער (עם הטיה לאחור), קואורדינטות ראש
function capPt(c, r, tilt, th, ph) {
  const x = r[0] * Math.sin(th) * Math.cos(ph), y = r[1] * Math.cos(th), z = r[2] * Math.sin(th) * Math.sin(ph);
  return [c[0] + x, c[1] + y * Math.cos(tilt) - z * Math.sin(tilt), c[2] + y * Math.sin(tilt) + z * Math.cos(tilt)];
}

function hairMesh(L) {
  if (L.hs === 8) return null; // קירח
  const b = new Builder(), H = L.hair, noisy = (a = 0.14) => (x, y, z) => shade(H, 1 - a / 2 + a * hash3(x * 40, y * 40, z * 40));
  const cap = (r, c, th, tilt, color) => b.add(CAP(th), { s: r, r: [tilt, 0, 0], p: c, c: color || noisy() });
  const R0 = [0.121, 0.147, 0.143], C0 = [0, 0.006, 0.002];
  switch (L.hs) {
    case 0: // קצר
      cap(R0, C0, Math.PI * 0.47, 0.45);
      for (const s of [-1, 1]) b.add(SPL(), { s: [0.013, 0.04, 0.02], p: [s * 0.102, -0.012, -0.01], c: noisy() });
      break;
    case 1: // פרידה צדית
      cap([0.123, 0.15, 0.145], C0, Math.PI * 0.5, 0.45);
      b.add(SPH(), { s: [0.07, 0.028, 0.046], p: [0.03, 0.108, -0.07], r: [0.35, 0, -0.3], c: noisy() });
      b.add(SPH(), { s: [0.045, 0.022, 0.036], p: [-0.032, 0.114, -0.058], r: [0.35, 0, 0.3], c: noisy() });
      for (const s of [-1, 1]) b.add(SPL(), { s: [0.013, 0.042, 0.02], p: [s * 0.102, -0.012, -0.01], c: noisy() });
      break;
    case 2: // קוצים
      cap(R0, C0, Math.PI * 0.47, 0.45);
      for (let k = 0; k < 11; k++) {
        const a = (k / 10) * TAU, rho = k === 10 ? 0 : 0.062, phi = k === 10 ? 0 : 0.6;
        const M = mul3(rotY(-a), rotZ(-phi)), base = capPt(C0, R0, 0.45, 0.62 * (rho / 0.062 || 0), a), h = 0.09;
        b.add(CON(), { s: [0.026, h, 0.026], m: M, p: [base[0] + Math.sin(phi) * Math.cos(a) * h * 0.4, base[1] + 0.012 + Math.cos(phi) * h * 0.45, base[2] + Math.sin(phi) * Math.sin(a) * h * 0.4], c: noisy(0.2) });
      }
      break;
    case 3: // ארוך
      cap([0.125, 0.152, 0.147], C0, Math.PI * 0.52, 0.42);
      b.add(SPH(), { s: [0.12, 0.25, 0.068], p: [0, -0.13, 0.082], c: noisy() });
      for (const s of [-1, 1]) b.add(SPH(), { s: [0.03, 0.105, 0.052], p: [s * 0.106, -0.062, 0.012], c: noisy() });
      b.add(SPH(), { s: [0.07, 0.026, 0.045], p: [0.012, 0.11, -0.068], r: [0.35, 0, -0.2], c: noisy() });
      break;
    case 4: // קוקו
      cap(R0, C0, Math.PI * 0.5, 0.45);
      [[0, 0.045, 0.125, 0.036], [0, 0.0, 0.165, 0.038], [0, -0.055, 0.19, 0.034], [0, -0.115, 0.2, 0.027], [0, -0.17, 0.2, 0.018]].forEach(([x, y, z, r]) => b.add(SPL(), { s: r, p: [x, y, z], c: noisy() }));
      b.add(BOX(), { s: [0.05, 0.016, 0.05], p: [0, 0.04, 0.122], c: 0xd8403a });
      break;
    case 5: { // מוהוק
      cap([0.113, 0.139, 0.133], C0, Math.PI * 0.45, 0.45, mixc(H, L.skin, 0.55));
      for (let k = 0; k < 9; k++) {
        const z = -0.075 + k * 0.0205, top = 0.004 + 0.138 * Math.sqrt(Math.max(0.05, 1 - ((z - 0.005) / 0.124) ** 2));
        b.add(SPH(), { s: [0.013, 0.036 + 0.014 * Math.sin((k / 8) * Math.PI), 0.021], p: [0, top - 0.005, z], c: noisy(0.2) });
      }
      break;
    }
    case 6: { // אפרו
      const c = [0, 0.03, 0.035], r = [0.168, 0.162, 0.168];
      cap(r, c, Math.PI * 0.5, 0.62);
      for (let k = 0; k < 16; k++) { const p = capPt(c, r, 0.62, 0.08 + (k / 16) * 1.35, k * 2.4); b.add(SPL(), { s: 0.04, p, c: noisy(0.18) }); }
      break;
    }
    case 7: // פקעת
      cap(R0, C0, Math.PI * 0.47, 0.45);
      b.add(SPH(), { s: 0.056, p: [0, 0.158, 0.045], c: noisy() });
      b.add(BOX(), { s: [0.09, 0.012, 0.09], p: [0, 0.122, 0.045], c: shade(H, 0.7) });
      break;
    default: break;
  }
  const m = b.build({ m: HAIR_MAT() }).children[0];
  return m || null;
}

// ---------- גוף עליון ----------
// נקודות לאורך חזית הגוף (לשים רוכסנים/כיסים צמודים לפני השטח)
// שורות הגוף העליון (y, רוחב, עומק, הזזת z); משותף גם לאפודים ולתיקים (gear.js)
export const TORSO_BASE = [
  [-0.07, 0.33, 0.22, 0], [0.0, 0.372, 0.232, 0], [0.002, 0.372, 0.232, 0], [0.055, 0.366, 0.228, 0], [0.1, 0.345, 0.22, 0], [0.105, 0.345, 0.22, 0],
  [0.22, 0.31, 0.208, -0.004], [0.34, 0.348, 0.228, -0.012], [0.46, 0.405, 0.246, -0.02], [0.54, 0.43, 0.248, -0.014], [0.59, 0.43, 0.232, 0], [0.63, 0.33, 0.19, 0],
];
export const SHIRT_FAT = [0.006, 0.022, 0.014]; // עובי הבד לפי סגנון חולצה (טי/קפוצ'ון/ג'קט)
function torsoRows(L) {
  const tee = L.ss === 0, fat = SHIRT_FAT[L.ss], shirtY = tee ? 0.1025 : 0.001;
  const rows = TORSO_BASE.map((r) => r.slice());
  if (L.ss === 2) rows.push([0.655, 0.19, 0.16, 0.004], [0.675, 0.152, 0.142, 0.004], [0.708, 0.148, 0.138, 0.004], [0.714, 0.104, 0.104, 0], [0.8, 0.1, 0.1, 0]);
  else rows.push([0.655, 0.17, 0.145, 0.004], [0.675, 0.118, 0.115, 0.004], [0.705, 0.108, 0.108, 0], [0.8, 0.1, 0.1, 0]);
  return rows.map(([y, w, d, cz]) => { const f = y >= shirtY && y < 0.64 ? fat : 0; return [y, w + 2 * f, d + 2 * f, cz, f]; });
}
const frontZ = (rows, y) => {
  for (let i = 0; i < rows.length - 1; i++) if (y <= rows[i + 1][0] && y >= rows[i][0]) { const t = (y - rows[i][0]) / (rows[i + 1][0] - rows[i][0] || 1), r0 = rows[i], r1 = rows[i + 1]; return (r0[3] - r0[2] / 2) * (1 - t) + (r1[3] - r1[2] / 2) * t; }
  return -0.12;
};

function torsoMesh(L) {
  const b = new Builder(), tee = L.ss === 0, hood = L.ss === 1, jack = L.ss === 2, rows = torsoRows(L);
  const shirtY = tee ? 0.1025 : 0.001, trim = shade(L.shirt, 0.8), neckTop = jack ? 0.711 : tee ? 0.672 : 0.661;
  b.loft(rows.map(([y, w, d, cz]) => ringY(0, cz, y, w, d, 2.5, 28)), {
    capStart: true, capColor: L.pants,
    color: (i, j, cx, cy) => {
      if (cy > neckTop) return L.skin;
      if (cy > 0.645) return trim;
      if (cy < shirtY) return L.pants;
      if (!tee && cy < 0.057) return trim;
      return L.shirt;
    },
  });
  if (hood) {
    b.add(SPH(), { s: [0.125, 0.085, 0.09], p: [0, 0.652, 0.082], c: shade(L.shirt, 0.92) });
    b.add(SPH(), { s: [0.112, 0.06, 0.075], p: [0, 0.665, 0.07], c: shade(L.shirt, 0.7) });
    b.add(BOX(), { s: [0.22, 0.1, 0.03], p: [0, 0.12, frontZ(rows, 0.12) - 0.006], c: shade(L.shirt, 0.92) });
    for (const s of [-1, 1]) { b.add(CYL(), { s: [0.004, 0.13, 0.004], p: [s * 0.032, 0.575, frontZ(rows, 0.575) - 0.004], c: 0xf2f2f2 }); b.add(SPL(), { s: 0.0075, p: [s * 0.032, 0.505, frontZ(rows, 0.505) - 0.004], c: 0xf2f2f2 }); }
  }
  if (jack) {
    const edge = 0xe9e9e6;
    for (let y = 0.02; y < 0.6; y += 0.06) b.add(BOX(), { s: [0.009, 0.062, 0.006], p: [0, y + 0.03, frontZ(rows, y + 0.03) - 0.002], c: 0xcfd2d6 });
    for (const s of [-1, 1]) b.add(BOX(), { s: [0.075, 0.007, 0.006], p: [s * 0.1, 0.42, frontZ(rows, 0.42) - 0.002], r: [0, 0, -0.08 * s], c: shade(L.shirt, 0.55) });
    for (const s of [-1, 1]) b.add(BOX(), { s: [0.012, 0.5, 0.01], p: [s * (0.165 + 0.014), 0.34, -0.005], c: edge }); // פס צד
  }
  return b.build({ m: CHAR_MAT() }).children[0];
}

// ---------- זרועות ----------
function upperArmMesh(L) {
  const b = new Builder(), long = L.ss !== 0, f = L.ss === 1 ? 0.008 : L.ss === 2 ? 0.004 : 0.0, trim = shade(L.shirt, 0.82);
  const rows = [[0.05, 0.095, 0.095], [0.0, 0.11, 0.11], [-0.1, 0.108, 0.108], [-0.2, 0.1, 0.1], [-0.3, 0.092, 0.092]];
  if (!long) { rows.splice(3, 0, [-0.125, 0.112, 0.112]); rows[3][1] += 0.0; rows.splice(4, 0, [-0.128, 0.1, 0.1]); }
  b.loft(rows.map(([y, w, d]) => ringY(0, 0, y, w + 2 * f, d + 2 * f, 2.1, 20)), {
    flip: true, capStart: true, capColor: L.shirt,
    color: (i, j, cx, cy, cz, nx) => {
      if (long) return L.ss === 2 && Math.abs(nx) > 0.82 && cy < 0.01 && cy > -0.28 ? 0xe9e9e6 : L.shirt;
      if (cy > -0.1265) return cy < -0.108 ? trim : L.shirt;
      return L.skin;
    },
  });
  b.add(SPH(), { s: 0.057 + f, p: [0, 0.002, 0], c: L.shirt });
  b.add(SPL(), { s: 0.047 + f, p: [0, -0.3, 0], c: long ? L.shirt : L.skin });
  return b.build({ m: CHAR_MAT() }).children[0];
}
function foreArmMesh(L, side) {
  const b = new Builder(), long = L.ss !== 0, f = L.ss === 1 ? 0.007 : L.ss === 2 ? 0.003 : 0, trim = shade(L.shirt, 0.78);
  const rows = [[0.0, 0.092, 0.09], [-0.08, 0.096, 0.094], [-0.2, 0.08, 0.077], [-0.25, 0.072, 0.07], [-0.254, 0.08, 0.078], [-0.3, 0.078, 0.076]];
  b.loft(rows.map(([y, w, d]) => ringY(0, 0, y, w + (long ? 2 * f : 0), d + (long ? 2 * f : 0), 2.1, 18)), {
    flip: true,
    color: (i, j, cx, cy) => (long ? (cy > -0.252 ? L.shirt : trim) : L.skin),
  });
  b.add(SPL(), { s: 0.047 + (long ? f : 0), p: [0, 0, 0], c: long ? L.shirt : L.skin });
  b.add(SPH(), { s: [0.047, 0.054, 0.05], p: [0, -0.345, -0.004], c: L.skin }); // אגרוף
  b.add(SPL(), { s: [0.018, 0.034, 0.021], p: [-side * 0.04, -0.33, -0.032], r: [0, 0, side * 0.2], c: L.skin }); // אגודל
  return b.build({ m: CHAR_MAT() }).children[0];
}

// ---------- רגליים ----------
function thighMesh(L) {
  const b = new Builder(), shorts = L.ps === 2, P = L.pants;
  const rows = [[0.05, 0.205, 0.21], [0.0, 0.2, 0.205], [-0.12, 0.185, 0.195], [-0.28, 0.155, 0.165]];
  if (shorts) rows.push([-0.285, 0.18, 0.19], [-0.288, 0.152, 0.16]);
  rows.push([-0.4, 0.13, 0.14], [-0.45, 0.125, 0.13]);
  b.loft(rows.map(([y, w, d]) => ringY(0, 0, y, w, d, 2.1, 22)), {
    flip: true, capStart: true, capColor: P,
    color: (i, j, cx, cy) => (shorts && cy < -0.2865 ? L.skin : (cy < -0.283 && shorts ? shade(P, 0.86) : P)),
  });
  b.add(SPH(), { s: 0.064, p: [0, -0.45, 0], c: shorts ? L.skin : P });
  if (L.ps === 1) {
    for (const s of [-1, 1]) {
      b.add(BOX(), { s: [0.026, 0.12, 0.1], p: [s * 0.093, -0.17, -0.004], c: shade(P, 0.9) });
      b.add(BOX(), { s: [0.03, 0.024, 0.105], p: [s * 0.093, -0.108, -0.004], c: shade(P, 0.8) });
    }
  }
  return b.build({ m: CHAR_MAT() }).children[0];
}
function shinMesh(L) {
  const b = new Builder(), shorts = L.ps === 2, P = L.pants, sock = 0xf0efe9, acc = shade(L.shirt, 0.9);
  const rows = [[0.02, 0.13, 0.135], [-0.08, 0.125, 0.135], [-0.2, 0.105, 0.115], [-0.3, 0.085, 0.09], [-0.33, 0.082, 0.087], [-0.335, 0.098, 0.103], [-0.375, 0.094, 0.099]];
  b.loft(rows.map(([y, w, d]) => ringY(0, 0, y, w, d, 2.1, 20)), {
    flip: true, capStart: true, capColor: shorts ? L.skin : P,
    color: (i, j, cx, cy) => {
      if (shorts) return cy < -0.235 ? sock : L.skin;
      return cy < -0.333 ? shade(P, 0.86) : P;
    },
  });
  b.add(SPH(), { s: 0.063, p: [0, 0, 0], c: shorts ? L.skin : P });
  // נעל ספורט: סוליה + גוף + לשונית + פס צבע
  const sole = [[-0.22, 0.062, 0.022, -0.438], [-0.19, 0.088, 0.03, -0.435], [-0.1, 0.1, 0.032, -0.434], [0.0, 0.097, 0.032, -0.434], [0.06, 0.088, 0.03, -0.435], [0.085, 0.07, 0.026, -0.437]];
  b.loft(sole.map(([z, w, h, cy]) => ringZ(0, cy, z, w, h, 3.2, 16)), { capStart: true, capEnd: true, c: 0xe8e7e2 });
  const up = [[-0.215, 0.06, 0.04, -0.412], [-0.15, 0.092, 0.066, -0.402], [-0.08, 0.098, 0.088, -0.39], [-0.02, 0.095, 0.108, -0.372], [0.04, 0.09, 0.1, -0.376], [0.085, 0.072, 0.082, -0.386]];
  b.loft(up.map(([z, w, h, cy]) => ringZ(0, cy, z, w, h, 2.6, 18)), {
    capStart: true, capEnd: true,
    color: (i, j, cx, cy, cz, nx) => (Math.abs(nx) > 0.72 && cz > -0.12 && cz < 0.03 && cy > -0.4 && cy < -0.38 ? acc : 0xf4f4f1),
  });
  b.add(BOX(), { s: [0.062, 0.012, 0.075], p: [0, -0.322, -0.06], r: [0.35, 0, 0], c: 0xdfe1e4 }); // שרוכים
  return b.build({ m: CHAR_MAT() }).children[0];
}

// מחזיר את כל חלקי הגוף כ-Mesh נפרדים (הרכבה בשלד נעשית ב-models.js)
export function makeBody(look) {
  const L = resolveLook(look);
  const thigh = thighMesh(L), shin = shinMesh(L);
  return {
    L, torso: torsoMesh(L), head: headMesh(L), hair: hairMesh(L),
    armU: [upperArmMesh(L), upperArmMesh(L)], armF: [foreArmMesh(L, 1), foreArmMesh(L, -1)], thigh, shin,
    shirtColor: L.shirt,
  };
}
