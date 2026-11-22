// בניית כל הגיאומטריה התלת-ממדית של העולם מתוך World (שטח, כבישים, בניינים, עצים, קישוטים, שמיים, מים).
// השטח, הבניינים והצמחייה מחולקים לנתחים (chunks) של 200 מ' – כך three.js חותך מה שמחוץ לשדה הראייה,
// ובעיקר מחוץ לחרוט הצל (שהוא רק ±70 מ' מהשחקן), וכל פריים מצייר רק חלק קטן מהמפה.
import * as THREE from 'three';
import { MAP } from '../sim/data.js';
import { mulberry32, fbm, clamp, lerp, smoothstep } from '../sim/util.js';
import { MAT_DEFS, matTexture, makeGrass, makeAsphalt, makeRunwayTex, makeFieldTex, makeWaterTex } from './textures.js';

const SKIP = new Set(['trunk', 'rock']);
const CHUNK = 200;
const NCH = Math.ceil(MAP.size / CHUNK);
const chunkOf = (x, z) => clamp(Math.floor((x + MAP.half) / CHUNK), 0, NCH - 1) + clamp(Math.floor((z + MAP.half) / CHUNK), 0, NCH - 1) * NCH;

// ממזג כמה גיאומטריות (צבע קבוע לכל אחת) לגיאומטריה אחת עם צבעי קודקודים – עץ שלם הוא instance אחד ולא ארבעה.
function mergeColored(parts) {
  let n = 0;
  for (const { geo } of parts) n += geo.index ? geo.index.count : geo.attributes.position.count;
  const P = new Float32Array(n * 3), NR = new Float32Array(n * 3), C = new Float32Array(n * 3);
  let o = 0;
  for (const { geo, color } of parts) {
    const p = geo.attributes.position, nn = geo.attributes.normal, ix = geo.index;
    const cnt = ix ? ix.count : p.count;
    for (let t = 0; t < cnt; t++, o++) {
      const v = ix ? ix.getX(t) : t;
      P[o * 3] = p.getX(v); P[o * 3 + 1] = p.getY(v); P[o * 3 + 2] = p.getZ(v);
      NR[o * 3] = nn.getX(v); NR[o * 3 + 1] = nn.getY(v); NR[o * 3 + 2] = nn.getZ(v);
      C[o * 3] = color.r; C[o * 3 + 1] = color.g; C[o * 3 + 2] = color.b;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(NR, 3));
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  return g;
}

export const TIME_PRESETS = {
  day: { sky: [0x2f7fe0, 0xbfdcf5], fog: 0xbcd8f0, sun: 0xfff2dc, sunI: 2.6, hemi: [0xbcd8ff, 0x7d8a5a, 0.9], dir: [0.55, 0.78, 0.3], exp: 1.0 },
  dusk: { sky: [0x35406e, 0xf2a46a], fog: 0xd89a76, sun: 0xffa95c, sunI: 1.9, hemi: [0x9aa6d6, 0x6a5a4a, 0.6], dir: [0.85, 0.28, 0.4], exp: 0.95 },
  night: { sky: [0x050912, 0x1a2540], fog: 0x121a2e, sun: 0x8fa8ff, sunI: 0.55, hemi: [0x2a3a66, 0x151a22, 0.42], dir: [-0.4, 0.7, 0.5], exp: 0.9 },
};

export function buildWorldMesh(world, scene, renderer, opts = {}) {
  const root = new THREE.Group();
  scene.add(root);
  const out = { root, update() {}, setTime() {}, sunDir: new THREE.Vector3(), dynamic: [] };

  // ---------- שטח (נתחים של 40x40 תאים) ----------
  const N = world.N, cs = world.cell, W1 = N + 1;
  const pos = new Float32Array(W1 * W1 * 3);
  const nor = new Float32Array(W1 * W1 * 3);
  const col = new Float32Array(W1 * W1 * 3);
  const c1 = new THREE.Color();
  const cSand = new THREE.Color(0xd8c690), cGrass = new THREE.Color(0x8fb35a), cGrass2 = new THREE.Color(0x6f9a44), cRock = new THREE.Color(0x8a867e), cDirt = new THREE.Color(0x7a6a52), cPad = new THREE.Color(0x9a9c92), cWet = new THREE.Color(0x8a7a58), cHigh = new THREE.Color(0xb7b59c);
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const k = i + j * W1;
    const x = -MAP.half + i * cs, z = -MAP.half + j * cs, h = world.hgt[k];
    pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
    const hl = world.hgt[Math.max(0, i - 1) + j * W1], hr = world.hgt[Math.min(N, i + 1) + j * W1];
    const hu = world.hgt[i + Math.max(0, j - 1) * W1], hd = world.hgt[i + Math.min(N, j + 1) * W1];
    // נורמל חלק מההפרשים המרכזיים (זהה בין נתחים, בלי תפרים)
    const gx = -(hr - hl) / (2 * cs), gz = -(hd - hu) / (2 * cs), gl = Math.hypot(gx, 1, gz);
    nor[k * 3] = gx / gl; nor[k * 3 + 1] = 1 / gl; nor[k * 3 + 2] = gz / gl;
    const slope = Math.hypot(hr - hl, hd - hu) / (2 * cs);
    const n1 = fbm(x / 22, z / 22, 91, 3), n2 = fbm(x / 140, z / 140, 17, 3);
    c1.copy(cGrass).lerp(cGrass2, clamp(n2 * 1.6 - 0.3, 0, 1));
    c1.multiplyScalar(0.88 + n1 * 0.26);
    c1.lerp(cHigh, smoothstep(26, 44, h) * 0.55);
    c1.lerp(cRock, smoothstep(0.38, 0.8, slope));
    c1.lerp(cSand, 1 - smoothstep(0.3, 1.5, h));
    if (h < 0.1) c1.lerp(cWet, smoothstep(0.1, -1.5, h));
    const rm = world.roadMask[k];
    if (rm === 1) c1.lerp(cDirt, 0.55);
    else if (rm === 2) c1.lerp(cPad, 0.5);
    col[k * 3] = c1.r; col[k * 3 + 1] = c1.g; col[k * 3 + 2] = c1.b;
  }
  const grassTex = makeGrass();
  const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: grassTex });
  const TCN = 40;
  let terrainChunks = 0;
  for (let cj = 0; cj < N; cj += TCN) for (let ci = 0; ci < N; ci += TCN) {
    const wx = Math.min(TCN, N - ci), wz = Math.min(TCN, N - cj), vc = (wx + 1) * (wz + 1);
    const P = new Float32Array(vc * 3), NR = new Float32Array(vc * 3), C = new Float32Array(vc * 3), U = new Float32Array(vc * 2);
    let o = 0;
    for (let j = 0; j <= wz; j++) for (let i = 0; i <= wx; i++, o++) {
      const k = (ci + i) + (cj + j) * W1;
      P[o * 3] = pos[k * 3]; P[o * 3 + 1] = pos[k * 3 + 1]; P[o * 3 + 2] = pos[k * 3 + 2];
      NR[o * 3] = nor[k * 3]; NR[o * 3 + 1] = nor[k * 3 + 1]; NR[o * 3 + 2] = nor[k * 3 + 2];
      C[o * 3] = col[k * 3]; C[o * 3 + 1] = col[k * 3 + 1]; C[o * 3 + 2] = col[k * 3 + 2];
      U[o * 2] = (ci + i) / N; U[o * 2 + 1] = (cj + j) / N;
    }
    const I = new Uint16Array(wx * wz * 6);
    let q = 0;
    for (let j = 0; j < wz; j++) for (let i = 0; i < wx; i++) {
      const a = i + j * (wx + 1), b = a + 1, c = a + wx + 1, d = c + 1;
      I[q++] = a; I[q++] = c; I[q++] = b; I[q++] = b; I[q++] = c; I[q++] = d;
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(P, 3));
    tg.setAttribute('normal', new THREE.BufferAttribute(NR, 3));
    tg.setAttribute('color', new THREE.BufferAttribute(C, 3));
    tg.setAttribute('uv', new THREE.BufferAttribute(U, 2));
    tg.setIndex(new THREE.BufferAttribute(I, 1));
    const terrain = new THREE.Mesh(tg, terrainMat);
    terrain.receiveShadow = true;
    root.add(terrain);
    terrainChunks++;
  }

  // ---------- מים ----------
  const waterTex = makeWaterTex();
  const water = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ map: waterTex, color: 0xffffff, transparent: true, opacity: 0.82, roughness: 0.25, metalness: 0.1 }));
  water.rotation.x = -Math.PI / 2; water.position.y = -0.3;
  root.add(water);
  const seaFloor = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshBasicMaterial({ color: 0x1a3f4f }));
  seaFloor.rotation.x = -Math.PI / 2; seaFloor.position.y = -12;
  root.add(seaFloor);

  // ---------- קופסאות ממוזגות לפי חומר ונתח ----------
  const byMat = new Map(); // מפתח: חומר|נתח
  const rng = mulberry32(5);
  for (const b of world.boxes) {
    if (SKIP.has(b.m)) continue;
    const key = b.m + '|' + chunkOf((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2);
    let g = byMat.get(key);
    if (!g) byMat.set(key, g = { name: b.m, list: [] });
    g.list.push(b);
  }
  const matCache = {};
  const getMat = (name) => {
    if (matCache[name]) return matCache[name];
    const d = MAT_DEFS[name] || { c: 0xff00ff };
    const m = new THREE.MeshLambertMaterial({ color: d.c, map: matTexture(name) || null, vertexColors: true, transparent: !!d.tr, opacity: d.tr || 1, side: d.tr ? THREE.DoubleSide : THREE.FrontSide, depthWrite: !d.tr });
    if (m.map) m.color.set(0xffffff);
    matCache[name] = m;
    return m;
  };
  for (const { name, list } of byMat.values()) {
    const n = list.length;
    const P = new Float32Array(n * 24 * 3), U = new Float32Array(n * 24 * 2), C = new Float32Array(n * 24 * 3), NN = new Float32Array(n * 24 * 3);
    const I = new Uint32Array(n * 36);
    let v = 0, ii = 0;
    const isTinted = !!MAT_DEFS[name]?.k;
    for (const b of list) {
      const x0 = b.minX, x1 = b.maxX, y0 = b.minY, y1 = b.maxY, z0 = b.minZ, z1 = b.maxZ;
      const vr = 0.92 + rng() * 0.14;
      const faces = [
        // +x
        [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], 'x', 0.86],
        [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], 'x', 0.86],
        [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], 'y', 1.0],
        [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], 'y', 0.55],
        [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], 'z', 0.78],
        [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], 'z', 0.78],
      ];
      for (const f of faces) {
        const ax = f[5];
        for (let k = 0; k < 4; k++) {
          const p = f[k];
          P[v * 3] = p[0]; P[v * 3 + 1] = p[1]; P[v * 3 + 2] = p[2];
          NN[v * 3] = f[4][0]; NN[v * 3 + 1] = f[4][1]; NN[v * 3 + 2] = f[4][2];
          const s = 1 / 4;
          if (ax === 'x') { U[v * 2] = p[2] * s; U[v * 2 + 1] = p[1] * s; }
          else if (ax === 'z') { U[v * 2] = p[0] * s; U[v * 2 + 1] = p[1] * s; }
          else { U[v * 2] = p[0] * s; U[v * 2 + 1] = p[2] * s; }
          C[v * 3] = C[v * 3 + 1] = C[v * 3 + 2] = vr;
          v++;
        }
        const o = v - 4;
        I[ii++] = o; I[ii++] = o + 1; I[ii++] = o + 2; I[ii++] = o; I[ii++] = o + 2; I[ii++] = o + 3;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(NN, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
    g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    g.setIndex(new THREE.BufferAttribute(I, 1));
    const mesh = new THREE.Mesh(g, getMat(name));
    mesh.castShadow = name !== 'glass' && name !== 'fence';
    mesh.receiveShadow = true;
    root.add(mesh);
  }

  // ---------- גגות משופעים ----------
  {
    const byRoof = {};
    for (const gb of world.gables) (byRoof[gb.m] ||= []).push(gb);
    for (const [name, list] of Object.entries(byRoof)) {
      const P = [], U = [];
      const tri = (a, b, c, ua, ub, uc) => { P.push(...a, ...b, ...c); U.push(...ua, ...ub, ...uc); };
      for (const g of list) {
        const { x0, x1, z0, z1, y, h, alongX } = g;
        const my = y + h;
        if (alongX) {
          const zm = (z0 + z1) / 2;
          const A = [x0, y, z0], B = [x1, y, z0], Cc = [x1, my, zm], D = [x0, my, zm];
          const E = [x0, y, z1], F = [x1, y, z1];
          const L = (x1 - x0) / 3, W = Math.hypot(h, (z1 - z0) / 2) / 3;
          tri(A, B, Cc, [0, 0], [L, 0], [L, W]); tri(A, Cc, D, [0, 0], [L, W], [0, W]);
          tri(F, E, D, [0, 0], [L, 0], [L, W]); tri(F, D, Cc, [0, 0], [L, W], [0, W]);
          tri(A, D, E, [0, 0], [1, 1], [2, 0]); tri(B, F, Cc, [0, 0], [2, 0], [1, 1]);
        } else {
          const xm = (x0 + x1) / 2;
          const A = [x0, y, z0], B = [x0, y, z1], Cc = [xm, my, z1], D = [xm, my, z0];
          const E = [x1, y, z0], F = [x1, y, z1];
          const L = (z1 - z0) / 3, W = Math.hypot(h, (x1 - x0) / 2) / 3;
          tri(B, A, D, [0, 0], [L, 0], [L, W]); tri(B, D, Cc, [0, 0], [L, W], [0, W]);
          tri(E, F, Cc, [0, 0], [L, 0], [L, W]); tri(E, Cc, D, [0, 0], [L, W], [0, W]);
          tri(A, E, D, [0, 0], [2, 0], [1, 1]); tri(F, B, Cc, [0, 0], [2, 0], [1, 1]);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
      g.computeVertexNormals();
      const m = new THREE.MeshLambertMaterial({ color: 0xffffff, map: matTexture(name), side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = true; mesh.receiveShadow = true;
      root.add(mesh);
    }
  }

  // ---------- כבישים ----------
  {
    const asphalt = makeAsphalt();
    const P = [], U = [], I = [];
    let base = 0;
    for (let ri = 0; ri < world.roads.length; ri++) {
      const r = world.roads[ri];
      const pts = r.pts;
      let acc = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        let tx = b.x - a.x, tz = b.z - a.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        const nx = -tz, nz = tx, hw = r.w / 2;
        if (i > 0) acc += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
        for (const s of [-1, 1]) {
          const x = p.x + nx * hw * s, z = p.z + nz * hw * s;
          const y = Math.max(world.heightAt(x, z), -0.1) + 0.07 + ri * 0.0015;
          P.push(x, y, z);
          U.push(s < 0 ? 0 : 1, acc / 9);
        }
        if (i > 0) { const o = base + (i - 1) * 2; I.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
      }
      base += pts.length * 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I);
    g.computeVertexNormals();
    const m = new THREE.MeshLambertMaterial({ map: asphalt, color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    root.add(mesh);
  }

  // ---------- עצים, שיחים, סלעים, פנסים ----------
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpE = new THREE.Euler();
  const setInst = (mesh, i, x, y, z, sx, sy, sz, ry) => {
    tmpE.set(0, ry || 0, 0); tmpQ.setFromEuler(tmpE);
    tmpP.set(x, y, z); tmpS.set(sx, sy, sz);
    tmpM.compose(tmpP, tmpQ, tmpS); mesh.setMatrixAt(i, tmpM);
  };
  const jitter = (geo, amt, seed) => {
    const p = geo.attributes.position, r = mulberry32(seed);
    const map = new Map();
    for (let i = 0; i < p.count; i++) {
      const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      let d = map.get(key);
      if (!d) { d = [(r() - 0.5) * amt, (r() - 0.5) * amt, (r() - 0.5) * amt]; map.set(key, d); }
      p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
    }
    geo.computeVertexNormals();
    return geo;
  };
  const inst = (geo, mat, n, shadow = true) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    m.castShadow = shadow; m.receiveShadow = true; m.count = n; root.add(m); return m;
  };
  // מפזר רשימת פריטים לנתחים; בכל נתח InstancedMesh אחד – three חותך אותו כולו כשהוא מחוץ למסך / לחרוט הצל
  let instMeshes = 0;
  const chunkInstances = (list, geo, mat, shadow, place) => {
    const byC = new Map();
    for (const it of list) {
      const c = chunkOf(it.x, it.z);
      let arr = byC.get(c);
      if (!arr) byC.set(c, arr = []);
      arr.push(it);
    }
    for (const arr of byC.values()) {
      const m = inst(geo, mat, arr.length, shadow);
      arr.forEach((it, i) => place(m, i, it));
      instMeshes++;
    }
  };
  const pines = world.trees.filter((t) => t.k === 'pine'), oaks = world.trees.filter((t) => t.k === 'oak');
  {
    const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const cTrunk = new THREE.Color(0x5e4630);
    const cPine1 = new THREE.Color(0x2f5e34), cPine2 = new THREE.Color(0x3a7040);
    const cOak1 = new THREE.Color(0x5e9440), cOak2 = new THREE.Color(0x74a84a);
    const tg1 = new THREE.CylinderGeometry(0.22, 0.38, 6, 6); tg1.translate(0, 3, 0);
    const c1g = jitter(new THREE.ConeGeometry(3.0, 4.6, 8), 0.35, 1); c1g.translate(0, 4.3, 0);
    const c2g = jitter(new THREE.ConeGeometry(2.3, 4.2, 8), 0.3, 2); c2g.translate(0, 6.7, 0);
    const c3g = jitter(new THREE.ConeGeometry(1.5, 3.6, 7), 0.25, 3); c3g.translate(0, 9.0, 0);
    const pineGeo = mergeColored([{ geo: tg1, color: cTrunk }, { geo: c1g, color: cPine1 }, { geo: c2g, color: cPine2 }, { geo: c3g, color: cPine1 }]);
    const placeTree = (m, i, t) => setInst(m, i, t.x, t.y - 0.2, t.z, t.s, t.s, t.s, t.ry);
    chunkInstances(pines, pineGeo, treeMat, true, placeTree);
    const tg2 = new THREE.CylinderGeometry(0.3, 0.5, 5, 6); tg2.translate(0, 2.5, 0);
    const b1 = jitter(new THREE.IcosahedronGeometry(3.0, 1), 0.7, 4); b1.translate(0, 6.6, 0);
    const b2 = jitter(new THREE.IcosahedronGeometry(2.1, 1), 0.6, 5); b2.translate(1.6, 5.2, 0.8);
    const b3 = jitter(new THREE.IcosahedronGeometry(2.0, 1), 0.6, 6); b3.translate(-1.5, 5.4, -0.9);
    const oakGeo = mergeColored([{ geo: tg2, color: cTrunk }, { geo: b1, color: cOak1 }, { geo: b2, color: cOak2 }, { geo: b3, color: cOak1 }]);
    chunkInstances(oaks, oakGeo, treeMat, true, placeTree);
  }
  {
    const bg = jitter(new THREE.IcosahedronGeometry(0.8, 1), 0.3, 7); bg.translate(0, 0.45, 0);
    chunkInstances(world.bushes, bg, new THREE.MeshLambertMaterial({ color: 0x4f8a3a }), false, (m, i, b) => setInst(m, i, b.x, b.y - 0.1, b.z, b.s, b.s * 0.8, b.s, i));
    const rg = jitter(new THREE.DodecahedronGeometry(1, 0), 0.25, 8); rg.translate(0, 0.35, 0);
    chunkInstances(world.rocks, rg, new THREE.MeshLambertMaterial({ color: 0x84817a }), true, (m, i, r) => setInst(m, i, r.x, r.y - 0.2, r.z, r.s * 0.95, r.s * 0.75, r.s * 0.95, r.ry));
    const pole = new THREE.CylinderGeometry(0.07, 0.09, 5.2, 6); pole.translate(0, 2.6, 0);
    const lm = inst(pole, new THREE.MeshLambertMaterial({ color: 0x3b3f44 }), world.lamps.length);
    world.lamps.forEach((l, i) => setInst(lm, i, l.x, l.y, l.z, 1, 1, 1, 0));
    const hg = new THREE.SphereGeometry(0.28, 8, 6); hg.translate(0, 5.3, 0);
    const hm = inst(hg, new THREE.MeshBasicMaterial({ color: 0xfff1c0 }), world.lamps.length, false);
    world.lamps.forEach((l, i) => setInst(hm, i, l.x, l.y, l.z, 1, 1, 1, 0));
    out.lampMesh = hm;
  }

  // ---------- קישוטים ----------
  const wheelDecos = world.decos.filter((d) => d.t === 'wheels');
  if (wheelDecos.length) {
    const wg = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 10); wg.rotateX(Math.PI / 2);
    const wm = inst(wg, new THREE.MeshLambertMaterial({ color: 0x15171a }), wheelDecos.length * 4, false);
    let k = 0;
    for (const d of wheelDecos) {
      const lx = d.alongX ? 1.45 : 0.95, lz = d.alongX ? 0.95 : 1.45;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const px = d.x + (d.alongX ? sx * lx : sx * lx), pz = d.z + (d.alongX ? sz * lz : sz * lz);
        tmpE.set(0, d.alongX ? 0 : Math.PI / 2, 0); tmpQ.setFromEuler(tmpE);
        tmpP.set(px, d.y + 0.38, pz); tmpS.set(1, 1, 1); tmpM.compose(tmpP, tmpQ, tmpS); wm.setMatrixAt(k++, tmpM);
      }
    }
  }
  for (const d of world.decos) {
    if (d.t === 'water') {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(d.r, d.r, 0.08, 20), new THREE.MeshStandardMaterial({ color: 0x3f8fb5, roughness: 0.1, transparent: true, opacity: 0.85 }));
      m.position.set(d.x, d.y, d.z); root.add(m);
    } else if (d.t === 'cone') {
      const m = new THREE.Mesh(new THREE.ConeGeometry(d.r, d.h, 10), getMat(d.m)); m.position.set(d.x, d.y + d.h / 2, d.z); m.castShadow = true; root.add(m);
    } else if (d.t === 'runway') {
      const t = d.taxi ? makeFieldTex(0x4a4c50, false) : makeRunwayTex();
      if (!d.taxi) t.repeat.set(1, 1);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.d), new THREE.MeshLambertMaterial({ map: t, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
      m.rotation.x = -Math.PI / 2; m.position.set(d.x, d.y, d.z); m.receiveShadow = true; root.add(m);
    } else if (d.t === 'tank' || d.t === 'silo') {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(d.r, d.r, d.h, 16), new THREE.MeshLambertMaterial({ color: d.t === 'silo' ? 0xb8bcc0 : 0xd8d4c8 }));
      m.position.set(d.x, d.y + d.h / 2, d.z); m.castShadow = true; m.receiveShadow = true; root.add(m);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(d.r, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x9aa0a6 }));
      cap.position.set(d.x, d.y + d.h, d.z); root.add(cap);
    } else if (d.t === 'helipad') {
      const m = new THREE.Mesh(new THREE.CircleGeometry(d.r, 28), new THREE.MeshLambertMaterial({ color: 0x4a4e52, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
      m.rotation.x = -Math.PI / 2; m.position.set(d.x, d.y, d.z); root.add(m);
      const ring = new THREE.Mesh(new THREE.RingGeometry(d.r * 0.78, d.r * 0.88, 28), new THREE.MeshBasicMaterial({ color: 0xf0f0f0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(d.x, d.y + 0.01, d.z); root.add(ring);
    } else if (d.t === 'field') {
      const t = makeFieldTex(d.c, d.rows);
      if (d.rows) t.repeat.set(d.w / 8, 1);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.d), new THREE.MeshLambertMaterial({ map: t, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
      m.rotation.x = -Math.PI / 2; m.position.set(d.x, Math.max(d.y, world.heightAt(d.x, d.z) + 0.06), d.z); m.receiveShadow = true; root.add(m);
    }
  }

  // ---------- שמיים ----------
  const skyU = { top: { value: new THREE.Color(0x2f7fe0) }, hor: { value: new THREE.Color(0xbfdcf5) }, sunDir: { value: new THREE.Vector3(0.5, 0.7, 0.3) }, sunCol: { value: new THREE.Color(0xfff2dc) }, stars: { value: 0 } };
  const skyMat = new THREE.ShaderMaterial({
    uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }',
    fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol; uniform float stars;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      void main(){ vec3 d = normalize(vP); float t = clamp(d.y, 0.0, 1.0); vec3 c = mix(hor, top, pow(t, 0.55));
        float s = max(dot(d, normalize(sunDir)), 0.0); c += sunCol * (pow(s, 600.0) * 3.0 + pow(s, 12.0) * 0.18);
        if (stars > 0.0 && d.y > 0.0) { vec2 g = floor(d.xz / (d.y + 0.2) * 90.0); float r = h(g); c += vec3(step(0.9965, r)) * stars * smoothstep(0.0, 0.3, d.y); }
        if (d.y < 0.0) c = mix(hor, hor * 0.75, clamp(-d.y * 4.0, 0.0, 1.0));
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2400, 24, 16), skyMat);
  sky.frustumCulled = false; sky.renderOrder = -10;
  scene.add(sky);
  out.sky = sky;

  // ---------- תאורה ----------
  const hemi = new THREE.HemisphereLight(0xbcd8ff, 0x7d8a5a, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.6);
  sun.castShadow = true;
  const sc = sun.shadow.camera;
  const SH = 70; sc.left = -SH; sc.right = SH; sc.top = SH; sc.bottom = -SH; sc.near = 1; sc.far = 400;
  sun.shadow.mapSize.set(opts.shadowSize || 2048, opts.shadowSize || 2048);
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.35;
  scene.add(sun); scene.add(sun.target);
  scene.fog = new THREE.Fog(0xbcd8f0, 200, 1100);
  out.hemi = hemi; out.sun = sun;

  out.setTime = (name, fogOn) => {
    const P = TIME_PRESETS[name] || TIME_PRESETS.day;
    skyU.top.value.set(P.sky[0]); skyU.hor.value.set(P.sky[1]); skyU.sunCol.value.set(P.sun);
    skyU.stars.value = name === 'night' ? 1 : 0;
    scene.fog.color.set(P.fog);
    scene.fog.near = fogOn ? 20 : 220; scene.fog.far = fogOn ? 340 : 1150;
    hemi.color.set(P.hemi[0]); hemi.groundColor.set(P.hemi[1]); hemi.intensity = P.hemi[2];
    sun.color.set(P.sun); sun.intensity = P.sunI;
    out.sunDir.set(...P.dir).normalize();
    skyU.sunDir.value.copy(out.sunDir);
    if (out.lampMesh) out.lampMesh.visible = name !== 'day';
    scene.background = new THREE.Color(P.fog);
    if (renderer) renderer.toneMappingExposure = P.exp;
  };
  out.update = (dt, cam, t) => {
    sky.position.copy(cam.position);
    sun.position.copy(cam.position).addScaledVector(out.sunDir, 180);
    sun.target.position.copy(cam.position);
    sun.target.updateMatrixWorld();
    // מקטינים "שחייה" של הצל לפי פיקסלים
    const stp = (2 * SH) / sun.shadow.mapSize.x;
    sun.position.x = Math.round(sun.position.x / stp) * stp; sun.position.z = Math.round(sun.position.z / stp) * stp;
    sun.target.position.x = Math.round(sun.target.position.x / stp) * stp; sun.target.position.z = Math.round(sun.target.position.z / stp) * stp;
    waterTex.offset.x = t * 0.004; waterTex.offset.y = t * 0.003;
    water.position.x = Math.round(cam.position.x / 50) * 50; water.position.z = Math.round(cam.position.z / 50) * 50;
    seaFloor.position.x = water.position.x; seaFloor.position.z = water.position.z;
  };
  out.setTime(opts.time || 'day', !!opts.fog);
  out.stats = { terrainChunks, boxMeshes: byMat.size, instMeshes };
  return out;
}
