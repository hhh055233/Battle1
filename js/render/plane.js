// מטוס מטען צבאי בסגנון הרקולס (C-130): כנף גבוהה ישרה, 4 מנועי מדחף, זנב גבוה, גחון עם בליטות לגלגלים, רמפה אחורית, חלונות תא טייס.
// מודל מקורי שנבנה בקוד לפי מבנה המטוס האמיתי (אורך ~48 מ', מוטת כנפיים ~65 מ'). חזית = Z שלילי, מדחפים = ילדים ישירים עם userData.spin.
import * as THREE from 'three';
import { Builder, superRing, naca, pchip, rotZ, rotY, mul3, vcMat, basicVcMat, TAU } from './kit.js';

const C = {
  top: 0x868d94, belly: 0xaeb4ba, dark: 0x3a4046, glass: 0x0b1118, radome: 0x565d64, boot: 0x5f666c, ctrl: 0x7c838a, line: 0x454b51,
  red: 0xd8481f, intake: 0x101315, nacelle: 0x757c83, tank: 0xa3aaaf, yellow: 0xf3c232, blade: 0x1b1c1f, door: 0x6c747a, ramp: 0x596067,
};

// ---- פרופיל גוף המטוס (z, רוחב, גובה, מרכז y, חדות פינות) ----
const FK = [
  [-24.0, 0.0, 0.0, -1.0, 2],
  [-23.6, 1.5, 1.6, -1.0, 2],
  [-22.8, 2.6, 2.8, -0.85, 2],
  [-21.6, 3.5, 3.7, -0.6, 2.1],
  [-20.0, 4.15, 4.4, -0.3, 2.2],
  [-18.0, 4.55, 4.95, 0.0, 2.3],
  [-15.0, 4.8, 5.35, 0.15, 2.4],
  [-11.0, 5.0, 5.6, 0.2, 2.5],
  [8.0, 5.0, 5.6, 0.2, 2.5],
  [11.5, 4.95, 5.4, 0.35, 2.5],
  [14.5, 4.6, 4.7, 0.95, 2.4],
  [17.5, 3.9, 3.9, 1.6, 2.3],
  [20.0, 3.0, 3.0, 2.15, 2.2],
  [22.5, 2.3, 2.2, 2.55, 2.2],
];
const fz = FK.map((k) => k[0]);
const fw = pchip(fz, FK.map((k) => k[1])), fh = pchip(fz, FK.map((k) => k[2])), fyc = pchip(fz, FK.map((k) => k[3])), fn = pchip(fz, FK.map((k) => k[4]));

// ---- כנף ----
const WX = [1.2, 3.5, 6, 8, 10, 12.3, 15, 17.5, 20.6, 21.0, 24, 28, 31.8, 32.3, 32.55];
const U = [0, 0.012, 0.03, 0.06, 0.1, 0.16, 0.24, 0.33, 0.42, 0.52, 0.62, 0.70, 0.72, 0.8, 0.88, 0.95, 1.0];
const wingChord = pchip([1.2, 18, 24, 32.3], [7.8, 7.05, 5.4, 3.7]);
const wingLE = pchip([1.2, 18, 24, 32.3], [-7.4, -7.4, -7.0, -6.4]);
const wingT = pchip([1.2, 32.3], [0.155, 0.12]);
const wingY = (x) => 2.8 + (x - 1.2) * 0.04;
const tipK = (x) => (x <= 31.8 ? 1 : x <= 32.3 ? 1 - ((x - 31.8) / 0.5) * 0.25 : 0.75 - ((x - 32.3) / 0.25) * 0.5);

// טבעת פרופיל כנף: סדר LE -> משטח ראשון -> TE -> משטח שני; frame(u, side) מחזיר נקודה תלת-ממדית
function airfoilRing(frame, firstSide) {
  const n = U.length - 1, pts = [];
  for (let k = 0; k <= n; k++) pts.push(frame(U[k], firstSide));
  for (let k = n - 1; k >= 1; k--) pts.push(frame(U[k], -firstSide));
  return pts;
}
const uMid = (i) => { const n = U.length - 1; return i < n ? (U[i] + U[i + 1]) / 2 : (U[2 * n - i] + U[2 * n - i - 1]) / 2; };
const isUpper = (i) => i < U.length - 1;

function addWing(b, sign) {
  const rings = WX.map((x) => {
    const k = tipK(x), c = wingChord(x) * k, le = wingLE(x) + (wingChord(x) - c) * 0.5, t = wingT(x) * k, y0 = wingY(x);
    return airfoilRing((u, s) => [sign * x, y0 + s * naca(u, t) * c, le + u * c], 1);
  });
  b.loft(rings, {
    flip: sign < 0, capStart: true, capEnd: true, capColor: C.top, jitter: 0.05,
    color: (i, j, cx, cy, cz) => {
      const um = uMid(i), up = isUpper(i), ax = Math.abs(cx);
      if (um < 0.085) return C.boot;
      if (j === 8 && um > 0.72) return C.line; // קו הפרדה בין דש לאיילרון
      if (up && um > 0.69 && um < 0.73) return C.line;
      if (um > 0.73) return up ? C.ctrl : C.belly;
      return up ? C.top : C.belly;
    },
  });
}

// ---- יציבים ----
function addStab(b, sign) { // מייצב אופקי
  const X = [0.8, 3, 6, 9, 12, 12.9, 13.15], ch = pchip([0.8, 12.9], [6.3, 2.7]), le = pchip([0.8, 12.9], [14.4, 16.9]);
  const k = (x) => (x <= 12 ? 1 : x <= 12.9 ? 1 - ((x - 12) / 0.9) * 0.2 : 0.8 - ((x - 12.9) / 0.25) * 0.5);
  const rings = X.map((x) => {
    const kk = k(x), c = ch(Math.min(x, 12.9)) * kk, l = le(Math.min(x, 12.9)) + (ch(Math.min(x, 12.9)) - c) * 0.5, t = 0.11 * kk, y0 = 3.2 + x * 0.045;
    return airfoilRing((u, s) => [sign * x, y0 + s * naca(u, t) * c, l + u * c], 1);
  });
  b.loft(rings, {
    flip: sign < 0, capStart: true, capEnd: true, capColor: C.top,
    color: (i, j, cx, cy, cz) => { const um = uMid(i), up = isUpper(i); if (um < 0.08) return C.boot; if (up && um > 0.52 && um < 0.56) return C.line; if (um > 0.56) return up ? C.ctrl : C.belly; return up ? C.top : C.belly; },
  });
}
function addFin(b, root, tip, top, thick, dorsal) {
  // כנף אנכית (ציר +Y): טבעת LE -> צד -X -> TE -> צד +X
  const Y = dorsal ? [root, root + (top - root) * 0.5, top] : [root, root + (top - root) * 0.33, root + (top - root) * 0.66, top - 0.5, top - 0.1, top];
  const f = dorsal ? { c0: 6.2, c1: 1.2, l0: 5.8, l1: 10.6 } : { c0: 10.0, c1: 4.6, l0: 10.3, l1: 16.3 };
  const rings = Y.map((y) => {
    const t = (y - root) / (top - root), kk = t > 0.97 ? 0.6 : 1, c = (f.c0 + (f.c1 - f.c0) * t) * kk, l = f.l0 + (f.l1 - f.l0) * t + ((f.c0 + (f.c1 - f.c0) * t) - c) * 0.5, th = (thick - (dorsal ? 0.03 : 0.04) * t);
    return airfoilRing((u, s) => [s * naca(u, th) * c, y, l + u * c], -1);
  });
  b.loft(rings, {
    capEnd: true, capColor: C.top,
    color: (i, j, cx, cy, cz) => {
      const um = uMid(i);
      if (um < 0.07) return C.boot;
      if (!dorsal && um > 0.69 && um < 0.73) return C.line;
      if (!dorsal && cy > 11.8) return C.red;
      if (um > 0.73) return C.ctrl;
      return C.top;
    },
  });
}

export function buildPlane() {
  const root = new THREE.Group();
  const b = new Builder();

  // גוף
  const zs = [];
  for (let z = -24; z < -18; z += 0.5) zs.push(z);
  for (let z = -18; z < 22.5; z += 1) zs.push(z);
  zs.push(22.5);
  const frings = zs.map((z) => superRing(0, fyc(z), z, fw(z), fh(z), fn(z), 48));
  b.loft(frings, {
    capEnd: true, capColor: C.ramp, jitter: 0.045,
    color: (i, j, cx, cy, cz, nx, ny, nz) => {
      const ax = Math.abs(cx), anx = Math.abs(nx);
      if (cz < -21.3) return C.radome;
      // שמשה קדמית ושמשות צד של תא הטייס
      if (cz > -20.2 && cz < -17.0 && ny > 0.32 && nz < 0.05 && ax < 1.6 && cy > 0.4 && !(ax < 0.12)) return C.glass;
      if (cz > -17.0 && cz < -14.8 && anx > 0.5 && cy > 0.35 && cy < 1.9) return C.glass;
      // חלונות עגולים בתא המטען
      if (anx > 0.8 && cy > 0.5 && cy < 1.4 && ((cz > -12.2 && cz < -11.1) || (cz > -9.1 && cz < -8.0))) return C.glass;
      // דלתות צנחנים אחוריות
      if (anx > 0.7 && cz > 10.4 && cz < 14.0 && cy > -1.4 && cy < 2.0) return (cz > 11.4 && cz < 12.4 && cy > 0.6) ? C.glass : C.door;
      // רמפה אחורית (גחון) וגחון בהיר
      if (cz > 12.6 && ny < -0.2) return C.ramp;
      if (ny < -0.38) return C.belly;
      return C.top;
    },
  });

  // בליטות גלגלי נחיתה (sponsons)
  const SPK = [[-3.2, 0.05, 0.05], [-2.6, 0.6, 0.55], [-1.5, 0.95, 0.9], [0, 1.1, 1.0], [6, 1.1, 1.0], [8.5, 0.9, 0.8], [10, 0.5, 0.45], [10.8, 0.05, 0.05]];
  const spx = pchip(SPK.map((k) => k[0]), SPK.map((k) => k[1])), spy = pchip(SPK.map((k) => k[0]), SPK.map((k) => k[2]));
  for (const s of [-1, 1]) {
    const rings = [];
    for (let z = -3.2; z <= 10.8; z += 0.7) rings.push(superRing(s * 2.0, -1.95, z, spx(z) * 2, spy(z) * 2, 2.2, 20));
    rings.push(superRing(s * 2.0, -1.95, 10.8, 0.1, 0.1, 2, 20));
    b.loft(rings, { c: C.top, color: (i, j, cx, cy, cz, nx, ny) => (ny < -0.25 ? C.belly : C.top) });
  }

  // כנפיים, יציבים
  addWing(b, 1); addWing(b, -1);
  addStab(b, 1); addStab(b, -1);
  addFin(b, 2.6, 4.6, 14.6, 0.125, false);
  addFin(b, 3.0, 1.2, 4.9, 0.075, true);

  // מנועים, צינורות יניקה, מיכלי דלק חיצוניים
  const NAC = [[-11.7, 0.6], [-11.4, 0.78], [-10.7, 0.9], [-9.5, 0.96], [-7.5, 1.0], [-5, 1.02], [-2.5, 0.95], [0, 0.8], [1.6, 0.58], [2.4, 0.42]];
  const nr = pchip(NAC.map((k) => k[0]), NAC.map((k) => k[1]));
  const engines = [];
  for (const sx of [-1, 1]) for (const ex of [8, 17.5]) {
    const x = sx * ex, ye = wingY(ex) - 1.0;
    engines.push([x, ye]);
    const rings = [];
    for (let z = -11.7; z <= 2.4; z += 0.55) rings.push(superRing(x, ye, z, nr(z) * 2, nr(z) * 1.9, 2.3, 28));
    rings.push(superRing(x, ye, 2.4, nr(2.4) * 2, nr(2.4) * 1.9, 2.3, 28));
    b.loft(rings, { capEnd: true, capColor: 0x24272a, c: C.nacelle, color: (i, j, cx, cy, cz, nx, ny) => (ny < -0.5 && cz > -9 ? C.top : cz > -6.4 && cz < 2 ? C.top : C.nacelle) });
    // פתח יניקה תחתון
    const IK = [[-11.1, 0.75, 0.55], [-10.6, 0.95, 0.62], [-9.4, 1.0, 0.58], [-8.2, 0.7, 0.2]];
    const ikw = pchip(IK.map((k) => k[0]), IK.map((k) => k[1])), ikh = pchip(IK.map((k) => k[0]), IK.map((k) => k[2]));
    const ir = [];
    for (let z = -11.1; z <= -8.2; z += 0.4) ir.push(superRing(x, ye - 0.86, z, ikw(z), ikh(z), 2.6, 16));
    ir.push(superRing(x, ye - 0.86, -8.2, ikw(-8.2), ikh(-8.2), 2.6, 16));
    b.loft(ir, { capStart: true, capColor: C.intake, c: C.nacelle });
  }
  // מיכלי דלק מתחת לכנף, בין המנועים
  const TK = [[-8.2, 0.05], [-7.9, 0.45], [-7.2, 0.72], [-6.0, 0.82], [-3, 0.82], [-1.5, 0.7], [-0.6, 0.3], [-0.3, 0.05]];
  const tr = pchip(TK.map((k) => k[0]), TK.map((k) => k[1]));
  for (const s of [-1, 1]) {
    const x = s * 12.3, y = wingY(12.3) - 1.55, rings = [];
    for (let z = -8.2; z <= -0.3; z += 0.4) rings.push(superRing(x, y, z, tr(z) * 2, tr(z) * 2, 2, 20));
    b.loft(rings, { c: C.tank });
    b.add(new THREE.BoxGeometry(0.35, 0.5, 4.4), { p: [x, y + 0.95, -4.4], c: C.top });
  }

  // אנטנות ופרטים
  b.add(new THREE.BoxGeometry(0.1, 0.7, 1.3), { p: [0, 3.35, -6.5], c: C.dark });
  b.add(new THREE.BoxGeometry(0.1, 0.55, 1.1), { p: [0, 3.25, 7.0], c: C.dark });
  b.add(new THREE.BoxGeometry(0.1, 0.55, 1.0), { p: [0, -2.9, -13.0], c: C.dark });
  b.add(new THREE.CylinderGeometry(0.05, 0.05, 1.3, 6), { r: [Math.PI / 2, 0, 0], p: [0, -1.05, -24.45], c: C.dark });
  for (const s of [-1, 1]) b.add(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 6), { r: [Math.PI / 2, 0, 0], p: [s * 0.9, 0.3, -21.3], c: C.dark });

  // נורות ניווט
  const tipY = wingY(32.4) + 0.02, tipZ = wingLE(32.3) + 1.1;
  b.add(new THREE.SphereGeometry(0.34, 8, 6), { p: [-32.55, tipY, tipZ], c: 0xff2d2d }, 'l'); // שמאל אדום
  b.add(new THREE.SphereGeometry(0.34, 8, 6), { p: [32.55, tipY, tipZ], c: 0x2dff6a }, 'l'); // ימין ירוק
  b.add(new THREE.SphereGeometry(0.3, 8, 6), { p: [0, 15.0, 17.5], c: 0xff4040 }, 'l');
  b.add(new THREE.SphereGeometry(0.3, 8, 6), { p: [0, -2.85, 4], c: 0xffffff }, 'l');
  b.add(new THREE.SphereGeometry(0.26, 8, 6), { p: [0, 2.7, 22.7], c: 0xffffff }, 'l');

  root.add(b.build({ m: vcMat('plane-body', 0.55, 0.1, { emissive: 0x394046 }) }));

  // מדחפים: ילדים ישירים של השורש עם userData.spin (game.js מסובב אותם סביב Z)
  const pb = new Builder();
  pb.add(new THREE.ConeGeometry(0.64, 1.6, 18), { r: [-Math.PI / 2, 0, 0], p: [0, 0, -0.8], c: 0x8c9399 });
  for (let k = 0; k < 4; k++) {
    const th = (k * Math.PI) / 2, R = mul3(rotZ(th), rotY(0.5));
    const at = (r) => [-Math.sin(th) * r, Math.cos(th) * r, 0];
    pb.add(new THREE.BoxGeometry(0.5, 0.95, 0.08), { m: R, p: at(1.0), c: C.blade });
    pb.add(new THREE.BoxGeometry(0.42, 1.45, 0.07), { m: R, p: at(2.2), c: C.blade });
    pb.add(new THREE.BoxGeometry(0.34, 0.55, 0.07), { m: R, p: at(3.2), c: C.yellow });
  }
  const propGeo = pb.build();
  const discMat = new THREE.MeshBasicMaterial({ color: 0xdfe6ea, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false });
  const discGeo = new THREE.RingGeometry(0.7, 3.45, 36);
  for (const [x, y] of engines) {
    const p = new THREE.Group();
    p.position.set(x, y, -11.7);
    for (const m of propGeo.children) p.add(new THREE.Mesh(m.geometry, m.material));
    p.add(new THREE.Mesh(discGeo, discMat));
    p.userData.spin = true;
    root.add(p);
  }
  return root;
}
