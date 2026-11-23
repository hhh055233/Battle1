// ערכת בנייה למודלים: מאחדת הרבה צורות לגאומטריה אחת עם צבעי קודקודים (פחות draw-calls, מראה חלק וחד).
// הכול בנוי על ה-API הבסיסי של three (BufferGeometry/Mesh/חומרים), כך שאפשר גם לרנדר אותו בכלי תצוגה מקדימה.
import * as THREE from 'three';

export const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;

// צבע hex -> RGB לינארי (כמו ש-three מעבד את צבעי החומר)
const colCache = new Map();
export const col3 = (hex) => {
  let c = colCache.get(hex);
  if (!c) { const t = new THREE.Color(hex); c = [t.r, t.g, t.b]; colCache.set(hex, c); }
  return c;
};

export const mul3 = (a, b) => {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
};
export const rotX = (t) => { const c = Math.cos(t), s = Math.sin(t); return [1, 0, 0, 0, c, -s, 0, s, c]; };
export const rotY = (t) => { const c = Math.cos(t), s = Math.sin(t); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
export const rotZ = (t) => { const c = Math.cos(t), s = Math.sin(t); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
// סדר XYZ כמו ב-three (Rx·Ry·Rz)
export const rotXYZ = (x, y, z) => mul3(mul3(rotX(x), rotY(y)), rotZ(z));

// אינטרפולציה מונוטונית חלקה (בלי overshoot) לפרופילים
export function pchip(xs, ys) {
  const n = xs.length, h = [], d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; d[i] = (ys[i + 1] - ys[i]) / h[i]; }
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]);
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}

// טבעת סופר-אליפסה סביב ציר Z (נגד כיוון השעון כשמסתכלים מ-Z חיובי): n=2 אליפסה, n גדול = מלבן מעוגל
export function superRing(cx, cy, z, w, h, n = 2, N = 32) {
  const out = [], e = 2 / n;
  for (let k = 0; k < N; k++) {
    const t = (k / N) * TAU, c = Math.cos(t), s = Math.sin(t);
    out.push([cx + (w / 2) * Math.sign(c) * Math.pow(Math.abs(c), e), cy + (h / 2) * Math.sign(s) * Math.pow(Math.abs(s), e), z]);
  }
  return out;
}

// טבעת סופר-אליפסה אופקית (ציר Y), נגד כיוון השעון כשמסתכלים מלמעלה; n=2 אליפסה, n גדול = מלבן מעוגל
export function ringY(cx, cz, y, w, d, n = 2.4, N = 26) {
  const out = [], e = 2 / n;
  for (let k = 0; k < N; k++) {
    const t = (k / N) * TAU, c = Math.cos(t), s = Math.sin(t);
    out.push([cx + (w / 2) * Math.sign(c) * Math.pow(Math.abs(c), e), y, cz - (d / 2) * Math.sign(s) * Math.pow(Math.abs(s), e)]);
  }
  return out;
}

export const shade = (h, f) => (Math.min(255, Math.round(((h >> 16) & 255) * f)) << 16) | (Math.min(255, Math.round(((h >> 8) & 255) * f)) << 8) | Math.min(255, Math.round((h & 255) * f));
export const mixc = (a, b, t) => { const c = (s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t); return (c(16) << 16) | (c(8) << 8) | c(0); };

// פרופיל כנף סימטרי (NACA 4 ספרות): עובי יחסי t, מקום יחסי u בין 0 ל-1 -> חצי עובי יחסי למיתר
export const naca = (u, t) => 5 * t * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u * u * u - 0.1036 * u * u * u * u);

export class Builder {
  constructor() { this.parts = new Map(); }
  part(k) {
    let p = this.parts.get(k);
    if (!p) { p = { pos: [], nor: [], col: [], idx: [] }; this.parts.set(k, p); }
    return p;
  }

  // מוסיף גאומטריית three (Box/Cylinder/Sphere...) עם טרנספורם: s (קנה מידה), r (אוילר XYZ) או m (מטריצה 3x3), p (מיקום), c (hex או פונקציה של קודקוד מקומי)
  add(geo, o = {}, k = 'm') {
    const p = this.part(k);
    const P = geo.attributes.position.array, N = geo.attributes.normal ? geo.attributes.normal.array : null, I = geo.index ? geo.index.array : null;
    const sc = o.s === undefined ? [1, 1, 1] : typeof o.s === 'number' ? [o.s, o.s, o.s] : o.s;
    const R = o.m || rotXYZ(...(o.r || [0, 0, 0])), t = o.p || [0, 0, 0];
    const nv = P.length / 3, base = p.pos.length / 3;
    const cfn = typeof o.c === 'function' ? o.c : null, c0 = col3(cfn ? 0xffffff : (o.c === undefined ? 0xffffff : o.c));
    const det = sc[0] * sc[1] * sc[2];
    for (let i = 0; i < nv; i++) {
      const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2];
      const X = x * sc[0], Y = y * sc[1], Z = z * sc[2];
      p.pos.push(R[0] * X + R[1] * Y + R[2] * Z + t[0], R[3] * X + R[4] * Y + R[5] * Z + t[1], R[6] * X + R[7] * Y + R[8] * Z + t[2]);
      const nx = (N ? N[3 * i] : 0) / sc[0], ny = (N ? N[3 * i + 1] : 1) / sc[1], nz = (N ? N[3 * i + 2] : 0) / sc[2];
      const ax = R[0] * nx + R[1] * ny + R[2] * nz, ay = R[3] * nx + R[4] * ny + R[5] * nz, az = R[6] * nx + R[7] * ny + R[8] * nz, l = Math.hypot(ax, ay, az) || 1;
      p.nor.push(ax / l, ay / l, az / l);
      const c = cfn ? col3(cfn(x, y, z, N ? N[3 * i] : 0, N ? N[3 * i + 1] : 1, N ? N[3 * i + 2] : 0)) : c0;
      p.col.push(c[0], c[1], c[2]);
    }
    const cnt = I ? I.length : nv;
    for (let q = 0; q < cnt; q += 3) {
      const a = I ? I[q] : q, b = I ? I[q + 1] : q + 1, c = I ? I[q + 2] : q + 2;
      if (det < 0) p.idx.push(base + a, base + c, base + b); else p.idx.push(base + a, base + b, base + c);
    }
    return this;
  }

  // משטח לופט: rings = מערך טבעות סגורות של נקודות [x,y,z]; הצבע לכל פאה נקבע ע"י o.color(i, j, cx, cy, cz, nx, ny, nz)
  // o.capStart/o.capEnd: מכסה שטוח; o.flip: הפיכת כיוון; o.c: צבע קבוע
  loft(rings, o = {}, k = 'm') {
    const p = this.part(k), S = rings.length, N = rings[0].length, flip = !!o.flip;
    const nrm = rings.map((r) => r.map(() => [0, 0, 0]));
    const addN = (v, fn) => { v[0] += fn[0]; v[1] += fn[1]; v[2] += fn[2]; };
    const cr = (A, B, C) => { const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2]; return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]; };
    for (let j = 0; j < S - 1; j++) for (let i = 0; i < N; i++) {
      const i2 = (i + 1) % N, A = rings[j][i], B = rings[j][i2], C = rings[j + 1][i2], D = rings[j + 1][i];
      const n1 = cr(A, B, C), n2 = cr(A, C, D);
      addN(nrm[j][i], n1); addN(nrm[j][i2], n1); addN(nrm[j + 1][i2], n1);
      addN(nrm[j][i], n2); addN(nrm[j + 1][i2], n2); addN(nrm[j + 1][i], n2);
    }
    for (const r of nrm) for (const v of r) { const l = Math.hypot(v[0], v[1], v[2]) || 1; v[0] /= l; v[1] /= l; v[2] /= l; if (flip) { v[0] = -v[0]; v[1] = -v[1]; v[2] = -v[2]; } }
    const c0 = col3(o.c === undefined ? 0xffffff : o.c);
    const emit = (pts, nors, colr) => {
      const base = p.pos.length / 3;
      for (let q = 0; q < pts.length; q++) { p.pos.push(pts[q][0], pts[q][1], pts[q][2]); p.nor.push(nors[q][0], nors[q][1], nors[q][2]); p.col.push(colr[0], colr[1], colr[2]); }
      if (pts.length === 4) { if (flip) p.idx.push(base, base + 2, base + 1, base, base + 3, base + 2); else p.idx.push(base, base + 1, base + 2, base, base + 2, base + 3); }
      else if (flip) p.idx.push(base, base + 2, base + 1); else p.idx.push(base, base + 1, base + 2);
    };
    for (let j = 0; j < S - 1; j++) for (let i = 0; i < N; i++) {
      const i2 = (i + 1) % N, A = rings[j][i], B = rings[j][i2], C = rings[j + 1][i2], D = rings[j + 1][i];
      let colr = c0;
      if (o.color) {
        const cx = (A[0] + B[0] + C[0] + D[0]) / 4, cy = (A[1] + B[1] + C[1] + D[1]) / 4, cz = (A[2] + B[2] + C[2] + D[2]) / 4;
        const nx = nrm[j][i][0] + nrm[j][i2][0] + nrm[j + 1][i2][0] + nrm[j + 1][i][0], ny = nrm[j][i][1] + nrm[j][i2][1] + nrm[j + 1][i2][1] + nrm[j + 1][i][1], nz = nrm[j][i][2] + nrm[j][i2][2] + nrm[j + 1][i2][2] + nrm[j + 1][i][2];
        const nl = Math.hypot(nx, ny, nz) || 1;
        colr = col3(o.color(i, j, cx, cy, cz, nx / nl, ny / nl, nz / nl));
      }
      if (o.jitter) { // וריאציה עדינה בין פאנלים, שוברת את השטיחות
        const h = Math.sin((i + 1) * 12.9898 + (j + 1) * 78.233) * 43758.5453, f = 1 + ((h - Math.floor(h)) - 0.5) * 2 * o.jitter;
        colr = [colr[0] * f, colr[1] * f, colr[2] * f];
      }
      emit([A, B, C, D], [nrm[j][i], nrm[j][i2], nrm[j + 1][i2], nrm[j + 1][i]], colr);
    }
    const cap = (ring, sign) => {
      const cx = ring.reduce((s, v) => s + v[0], 0) / N, cy = ring.reduce((s, v) => s + v[1], 0) / N, cz = ring.reduce((s, v) => s + v[2], 0) / N;
      const cen = [cx, cy, cz];
      // כיוון המכסה: ממוצע של cross סביב המרכז
      let nx = 0, ny = 0, nz = 0;
      for (let i = 0; i < N; i++) { const q = cr(cen, ring[i], ring[(i + 1) % N]); nx += q[0]; ny += q[1]; nz += q[2]; }
      const l = Math.hypot(nx, ny, nz) || 1; nx = (nx / l) * sign; ny = (ny / l) * sign; nz = (nz / l) * sign;
      const nn = [nx, ny, nz], colr = o.capColor !== undefined ? col3(o.capColor) : c0;
      for (let i = 0; i < N; i++) {
        const a = ring[i], b = ring[(i + 1) % N];
        // סדר הקודקודים כך שהחזית פונה ל-nn
        const t = cr(cen, a, b), dp = t[0] * nn[0] + t[1] * nn[1] + t[2] * nn[2];
        const base = p.pos.length / 3;
        p.pos.push(cen[0], cen[1], cen[2], a[0], a[1], a[2], b[0], b[1], b[2]);
        for (let q = 0; q < 3; q++) { p.nor.push(nn[0], nn[1], nn[2]); p.col.push(colr[0], colr[1], colr[2]); }
        if (dp >= 0) p.idx.push(base, base + 1, base + 2); else p.idx.push(base, base + 2, base + 1);
      }
    };
    // כיוון הרינג מול כיוון ההתקדמות קובע לאן פונה המכסה; ב-flip הכיוון הפוך
    if (o.capStart) cap(rings[0], flip ? 1 : -1);
    if (o.capEnd) cap(rings[S - 1], flip ? -1 : 1);
    return this;
  }

  // מוסיף מצולע מישורי מלא (משולשים) ע"י משולשים מרכזיים; לשימוש בפרופילים קמורים
  build(mats) {
    const g = new THREE.Group();
    for (const [k, p] of this.parts) {
      if (!p.idx.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(p.nor, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(p.col, 3));
      geo.setIndex(p.idx);
      const m = (mats && mats[k]) || defaultMat(k);
      const mesh = new THREE.Mesh(geo, m);
      mesh.userData.key = k;
      g.add(mesh);
    }
    return g;
  }
}

// חומרים משותפים (מטמון) – צבע בא מקודקודים
const matCache = new Map();
export function vcMat(key, rough = 0.7, metal = 0.0, extra = {}) {
  let m = matCache.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal, ...extra }); matCache.set(key, m); }
  return m;
}
export function basicVcMat(key, extra = {}) {
  let m = matCache.get(key);
  if (!m) { m = new THREE.MeshBasicMaterial({ vertexColors: true, ...extra }); matCache.set(key, m); }
  return m;
}
function defaultMat(k) {
  if (k === 'l') return basicVcMat('basic-l');
  if (k === 'g') return vcMat('glass', 0.15, 0.2);
  if (k === 'x') return vcMat('metal', 0.4, 0.3);
  return vcMat('matte', 0.65, 0.05);
}

// עזר: אינטרפולציה לינארית בין נקודות מפתח
export function keyed(keys) {
  return (x) => {
    if (x <= keys[0][0]) return keys[0][1];
    for (let i = 0; i < keys.length - 1; i++) if (x <= keys[i + 1][0]) return lerp(keys[i][1], keys[i + 1][1], (x - keys[i][0]) / (keys[i + 1][0] - keys[i][0]));
    return keys[keys.length - 1][1];
  };
}
