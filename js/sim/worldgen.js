// יצירת המפה (דטרמיניסטית לפי seed), התנגשויות, ריי-קאסט ופיזיקת תנועה.
// אין כאן תלות ב-three: אותו קוד רץ אצל כל השחקנים ואצל ה-host (בוטים, פגיעות).
import { MAP, PHYS } from './data.js';
import { mulberry32, fbm, clamp, lerp, smoothstep, hash2, weighted, pick, rand, randInt } from './util.js';
import { rollLoot } from './loot.js';

export const F_NB = 1; // הכדורים עוברים (לא חוסם ירי)
export const F_NC = 2; // בלי התנגשות (קישוט)
const CELL = 16;
const GN = Math.ceil(MAP.size / CELL);

// ---------- הגדרת היישובים (מפה מקורית) ----------
export const TOWN_DEFS = [
  { id: 'old', name: 'העיר העתיקה', x: -70, z: -50, r: 150, kind: 'town', tier: 1 },
  { id: 'harbor', name: 'הנמל', x: -585, z: 250, r: 105, kind: 'harbor', tier: 2 },
  { id: 'mil', name: 'בסיס צבאי', x: 400, z: -400, r: 135, kind: 'military', tier: 3 },
  { id: 'air', name: 'שדה התעופה', x: 430, z: 300, r: 140, kind: 'airfield', tier: 3 },
  { id: 'hosp', name: 'בית החולים', x: -360, z: -380, r: 95, kind: 'hospital', tier: 3 },
  { id: 'school', name: 'בית הספר', x: 70, z: 280, r: 95, kind: 'school', tier: 2 },
  { id: 'farm', name: 'החוות', x: -250, z: 500, r: 110, kind: 'farm', tier: 2 },
  { id: 'quarry', name: 'המחצבה', x: -600, z: -130, r: 100, kind: 'quarry', tier: 2 },
  { id: 'light', name: 'כפר המגדלור', x: 640, z: -60, r: 75, kind: 'village', tier: 1 },
  { id: 'river', name: 'כפר הנהר', x: 230, z: -80, r: 95, kind: 'village', tier: 1 },
  { id: 'docks', name: 'המזח הצפוני', x: 90, z: -590, r: 90, kind: 'harbor', tier: 2 },
];
const ROAD_LINKS = [
  ['old', 'school'], ['old', 'hosp'], ['old', 'river'], ['river', 'mil'], ['river', 'air'], ['school', 'air'],
  ['old', 'farm'], ['old', 'quarry'], ['harbor', 'quarry'], ['harbor', 'farm'], ['harbor', 'old'], ['light', 'mil'],
  ['light', 'air'], ['docks', 'mil'], ['docks', 'hosp'], ['docks', 'river'], ['school', 'farm'],
];

export class World {
  constructor(seed) {
    this.seed = seed | 0;
    this.rng = mulberry32(this.seed ^ 0x9e3779b9);
    this.N = MAP.seg;
    this.cell = MAP.size / this.N;
    this.hgt = new Float32Array((this.N + 1) * (this.N + 1));
    this.roadMask = new Uint8Array((this.N + 1) * (this.N + 1));
    this.boxes = [];
    this.grid = Array.from({ length: GN * GN }, () => []);
    this.gables = [];
    this.roads = [];   // {pts:[{x,z}], w}
    this.fields = [];
    this.decos = [];   // {t,x,y,z,...}
    this.trees = [];
    this.rocks = [];
    this.bushes = [];
    this.lamps = [];
    this.spots = [];   // נקודות לוט
    this.loot = new Map();
    this.nextLootId = 1;
    this.towns = TOWN_DEFS.map((t) => ({ ...t, padH: 2 }));
    this._mark = 0;
    this._generate();
  }

  // ---------- גובה פני השטח ----------
  rawHeight(x, z) {
    const s = this.seed;
    const d = Math.hypot(x, z);
    const ang = Math.atan2(z, x);
    const coastR = 680 + 55 * (fbm(Math.cos(ang) * 1.6 + 5, Math.sin(ang) * 1.6 + 5, s + 3, 3) - 0.5) * 2;
    const m = 1 - smoothstep(coastR - 70, coastR + 25, d);
    const hills = Math.pow(fbm(x / 340, z / 340, s, 5), 1.6) * 38;
    const detail = (fbm(x / 28, z / 28, s + 9, 3) - 0.5) * 1.6;
    const inland = 3.2 + hills + detail;
    return lerp(-9, inland, m) - (1 - m) * 0;
  }

  heightAt(x, z) {
    const N = this.N, cs = this.cell;
    let fx = (x + MAP.half) / cs, fz = (z + MAP.half) / cs;
    if (fx < 0) fx = 0; else if (fx > N - 0.001) fx = N - 0.001;
    if (fz < 0) fz = 0; else if (fz > N - 0.001) fz = N - 0.001;
    const i = fx | 0, j = fz | 0;
    const u = fx - i, v = fz - j;
    const a = i + j * (N + 1), h = this.hgt;
    if (u + v <= 1) return h[a] + (h[a + 1] - h[a]) * u + (h[a + N + 1] - h[a]) * v;
    return h[a + N + 2] + (h[a + N + 1] - h[a + N + 2]) * (1 - u) + (h[a + 1] - h[a + N + 2]) * (1 - v);
  }

  townAt(x, z) {
    for (const t of this.towns) if (Math.hypot(x - t.x, z - t.z) < t.r) return t;
    return null;
  }

  // ---------- יצירה ----------
  _generate() {
    const N = this.N, cs = this.cell, rng = this.rng;
    // 1. גבהים גולמיים
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      this.hgt[i + j * (N + 1)] = this.rawHeight(-MAP.half + i * cs, -MAP.half + j * cs);
    }
    // גובה משטח לכל יישוב
    for (const t of this.towns) {
      let sum = 0, n = 0;
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        sum += this.rawHeight(t.x + Math.cos(a) * t.r * 0.5, t.z + Math.sin(a) * t.r * 0.5); n++;
      }
      sum += this.rawHeight(t.x, t.z) * 4; n += 4;
      t.padH = Math.max(2.2, sum / n);
      if (t.kind === 'harbor') t.padH = Math.max(1.6, Math.min(t.padH, 3.2));
      if (t.kind === 'airfield') t.padH = Math.max(3, Math.min(t.padH, 7));
    }
    // 2. משטחים (פד) ליישובים, מחצבה כבור
    for (const t of this.towns) {
      const R0 = t.r, R1 = t.r + 55;
      const i0 = Math.max(0, Math.floor((t.x - R1 + MAP.half) / cs)), i1 = Math.min(N, Math.ceil((t.x + R1 + MAP.half) / cs));
      const j0 = Math.max(0, Math.floor((t.z - R1 + MAP.half) / cs)), j1 = Math.min(N, Math.ceil((t.z + R1 + MAP.half) / cs));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = -MAP.half + i * cs, z = -MAP.half + j * cs;
        const d = Math.hypot(x - t.x, z - t.z);
        if (d > R1) continue;
        const w = 1 - smoothstep(R0, R1, d);
        const idx = i + j * (N + 1);
        let target = t.padH;
        if (t.kind === 'quarry') target = t.padH - 11 * (1 - smoothstep(0, 85, d)) ;
        this.hgt[idx] = lerp(this.hgt[idx], target, w);
        if (d < R0) this.roadMask[idx] = 2;
      }
    }
    // 3. כבישים בין יישובים
    const byId = Object.fromEntries(this.towns.map((t) => [t.id, t]));
    for (const [a, b] of ROAD_LINKS) this._carveRoad(byId[a], byId[b]);
    // 4. מבנים ויישובים
    for (const t of this.towns) this._buildTown(t);
    // 5. כבישים פנימיים
    // (נוצרים בתוך _buildTown)
    // 6. טבע
    this._nature();
    // 7. גריד התנגשויות
    this._buildGrid();
    // 8. לוט
    this._spawnLoot();
  }

  _carveRoad(a, b) {
    const rng = this.rng, N = this.N, cs = this.cell;
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
    const n = Math.max(4, Math.ceil(L / 10));
    const nx = -dz / L, nz = dx / L, seedOff = rng() * 100;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const off = (fbm(t * 4 + seedOff, seedOff, this.seed + 77, 3) - 0.5) * 2 * Math.min(70, L * 0.14) * Math.sin(Math.PI * t);
      let x = a.x + dx * t + nx * off, z = a.z + dz * t + nz * off;
      const d = Math.hypot(x, z);
      if (d > 635) { x *= 635 / d; z *= 635 / d; }
      pts.push({ x, z });
    }
    // גבהי כביש מוחלקים
    let hs = pts.map((p) => this.heightAt(p.x, p.z));
    for (let pass = 0; pass < 10; pass++) {
      const nh = hs.slice();
      for (let i = 1; i < hs.length - 1; i++) {
        const lo = Math.max(0, i - 3), hi = Math.min(hs.length - 1, i + 3);
        let s = 0; for (let k = lo; k <= hi; k++) s += hs[k];
        nh[i] = s / (hi - lo + 1);
      }
      hs = nh;
    }
    for (let i = 0; i < pts.length; i++) pts[i].h = hs[i];
    for (let s = 0; s < pts.length - 1; s++) {
      const p0 = pts[s], p1 = pts[s + 1];
      const mnx = Math.min(p0.x, p1.x) - 16, mxx = Math.max(p0.x, p1.x) + 16;
      const mnz = Math.min(p0.z, p1.z) - 16, mxz = Math.max(p0.z, p1.z) + 16;
      const i0 = Math.max(0, Math.floor((mnx + MAP.half) / cs)), i1 = Math.min(N, Math.ceil((mxx + MAP.half) / cs));
      const j0 = Math.max(0, Math.floor((mnz + MAP.half) / cs)), j1 = Math.min(N, Math.ceil((mxz + MAP.half) / cs));
      const sx = p1.x - p0.x, sz = p1.z - p0.z, sl = sx * sx + sz * sz;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = -MAP.half + i * cs, z = -MAP.half + j * cs;
        let t = ((x - p0.x) * sx + (z - p0.z) * sz) / sl; t = clamp(t, 0, 1);
        const d = Math.hypot(x - (p0.x + sx * t), z - (p0.z + sz * t));
        if (d > 16) continue;
        const idx = i + j * (N + 1);
        // לא לחתוך בתוך משטח יישוב
        if (this.roadMask[idx] === 2) continue;
        const w = 1 - smoothstep(4.5, 15, d);
        this.hgt[idx] = lerp(this.hgt[idx], lerp(p0.h, p1.h, t), w);
        if (d < 12 && this.roadMask[idx] < 1) this.roadMask[idx] = 1;
      }
    }
    this.roads.push({ pts, w: 7, main: true });
  }

  // ---------- בונה קופסאות ----------
  box(x0, y0, z0, x1, y1, z1, m, f = 0) {
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (z1 < z0) [z0, z1] = [z1, z0];
    const b = { minX: x0, minY: y0, minZ: z0, maxX: x1, maxY: y1, maxZ: z1, m, f, id: this.boxes.length };
    this.boxes.push(b);
    return b;
  }

  // קיר לאורך ציר עם פתחים. axis 'x' => הקיר נמתח לאורך x במיקום z=[p0,p1]
  wall(axis, p0, p1, a0, a1, yb, h, openings, m, thick = true) {
    const ops = openings.slice().sort((u, v) => u.c - v.c);
    const put = (s0, s1, y0, y1, mm, f = 0) => {
      if (s1 - s0 < 0.02 || y1 - y0 < 0.02) return;
      if (axis === 'x') this.box(s0, y0, p0, s1, y1, p1, mm, f);
      else this.box(p0, y0, s0, p1, y1, s1, mm, f);
    };
    let cur = a0;
    for (const o of ops) {
      const s0 = Math.max(a0, o.c - o.w / 2), s1 = Math.min(a1, o.c + o.w / 2);
      put(cur, s0, yb, yb + h, m);
      if (o.s > 0) put(s0, s1, yb, yb + o.s, m);
      if (o.t < h) put(s0, s1, yb + o.t, yb + h, m);
      if (o.glass) {
        const mid = (p0 + p1) / 2;
        if (axis === 'x') this.box(s0, yb + o.s, mid - 0.02, s1, yb + o.t, mid + 0.02, 'glass', F_NB | F_NC);
        else this.box(mid - 0.02, yb + o.s, s0, mid + 0.02, yb + o.t, s1, 'glass', F_NB | F_NC);
      }
      cur = s1;
    }
    put(cur, a1, yb, yb + h, m);
  }

  // בניין כללי: מרכז (cx,cz) מידות w×d (x,z), floors קומות
  building(o) {
    const rng = this.rng;
    const { cx, cz, w, d, y0 } = o;
    const F = o.floors || 1, FH = o.floorH || 3, t = 0.28;
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const wm = o.wall || 'wallA';
    const yf = y0 + 0.12; // רצפת קומת קרקע
    const fy = (f) => yf + FH * f;
    // יסוד ורצפה
    this.box(x0, y0 - 1.2, z0, x1, yf, z1, 'floor');
    const doorSide = o.doorSide ?? randInt(rng, 0, 3); // 0=צפון(z0) 1=מזרח 2=דרום 3=מערב
    const doors = o.doors || [doorSide];
    const winGap = o.winGap || 3.6;
    const bigWin = !!o.bigWin;
    const sides = [
      { axis: 'x', p0: z0, p1: z0 + t, a0: x0, a1: x1, len: w, side: 0 },
      { axis: 'x', p0: z1 - t, p1: z1, a0: x0, a1: x1, len: w, side: 2 },
      { axis: 'z', p0: x1 - t, p1: x1, a0: z0 + t, a1: z1 - t, len: d - 2 * t, side: 1 },
      { axis: 'z', p0: x0, p1: x0 + t, a0: z0 + t, a1: z1 - t, len: d - 2 * t, side: 3 },
    ];
    // הצעדים על הקירות הצפוניים בנויים לאורך קיר z0 – אין חלונות בקטע המדרגות בקומות העליונות (לא בעייתי)
    const stairs = [];
    for (let f = 0; f < F; f++) {
      const wallH = FH - (f < F - 1 ? 0.2 : 0.2);
      for (const S of sides) {
        const ops = [];
        const mid = (S.a0 + S.a1) / 2;
        if (f === 0 && doors.includes(S.side)) ops.push({ c: mid + (o.doorOff || 0), w: o.doorW || 1.7, s: 0, t: Math.min(2.5, wallH - 0.3) });
        // חלונות
        const nW = Math.max(0, Math.floor((S.len - 3.5) / winGap));
        for (let k = 0; k < nW; k++) {
          const c = S.a0 + (S.len / (nW + 1)) * (k + 1) + (S.axis === 'z' ? 0 : 0);
          if (ops.some((p) => Math.abs(p.c - c) < 1.9)) continue;
          if (rng() < 0.12 && !bigWin) continue;
          ops.push({ c, w: bigWin ? 2.4 : 1.3, s: bigWin ? 0.9 : 1.0, t: bigWin ? 2.3 : 2.1, glass: true });
        }
        if (o.extraOpen && f === 0 && o.extraOpen.includes(S.side)) ops.push({ c: mid, w: Math.min(S.len - 2, o.extraW || 6), s: 0, t: Math.min(4.2, wallH - 0.3) });
        this.wall(S.axis, S.p0, S.p1, S.a0, S.a1, fy(f), wallH, ops, wm);
      }
    }
    // תקרות/רצפות ביניים עם חור למדרגות
    const stairW = 1.25, stairRun = 3.7;
    const holes = [];
    if (F > 1) {
      for (let k = 0; k < F - 1; k++) {
        const east = k % 2 === 1;
        const sx0 = east ? x1 - t - 0.1 - stairRun : x0 + t + 0.1;
        const sz0 = z0 + t + 0.05;
        const n = 8, rise = FH / n, depth = stairRun / n;
        for (let i = 0; i < n; i++) {
          // מדרגה i: מוצקה מהתחלה עד קצה המדרגה
          // מדרגה i גבוהה יותר ככל שמתרחקים מהקצה התחתון; הקצה הגבוה של המסלול הוא במזרח (או במערב כשהמסלול 'מזרחי')
          if (east) this.box(sx0, fy(k), sz0, sx0 + stairRun - i * depth, fy(k) + (i + 1) * rise, sz0 + stairW, 'concrete');
          else this.box(sx0 + i * depth, fy(k), sz0, sx0 + stairRun, fy(k) + (i + 1) * rise, sz0 + stairW, 'concrete');
        }
        // חור בתקרת קומה k+1
        const hx0 = sx0 - 0.05, hx1 = sx0 + stairRun + 0.05;
        holes[k + 1] = { x0: hx0, x1: hx1, z0: z0 + t, z1: sz0 + stairW + 0.1 };
      }
    }
    for (let f = 1; f <= F; f++) {
      const top = fy(f) ; // פני התקרה/רצפה של קומה f (קומה F = גג)
      const slabY0 = top - 0.2;
      const H = holes[f];
      if (!H || f === F) {
        this.box(x0, slabY0, z0, x1, top, z1, f === F ? 'roof' : 'floor');
      } else {
        this.box(x0, slabY0, z0, H.x0, top, z1, 'floor');
        this.box(H.x1, slabY0, z0, x1, top, z1, 'floor');
        this.box(H.x0, slabY0, H.z1, H.x1, top, z1, 'floor');
        this.box(H.x0, slabY0, z0, H.x1, top, H.z0, 'floor');
      }
    }
    // גג משופע ויזואלי
    const roofTop = fy(F);
    if (o.roof !== 'flat') {
      const alongX = w >= d;
      this.gables.push({ x0: x0 - 0.3, x1: x1 + 0.3, z0: z0 - 0.3, z1: z1 + 0.3, y: roofTop, h: Math.min(w, d) * 0.28, alongX, m: o.roofMat || 'roofA' });
    } else {
      this.box(x0 - 0.05, roofTop, z0 - 0.05, x1 + 0.05, roofTop + 0.5, z0 + 0.2, 'concrete');
      this.box(x0 - 0.05, roofTop, z1 - 0.2, x1 + 0.05, roofTop + 0.5, z1 + 0.05, 'concrete');
      this.box(x0 - 0.05, roofTop, z0 + 0.2, x0 + 0.2, roofTop + 0.5, z1 - 0.2, 'concrete');
      this.box(x1 - 0.2, roofTop, z0 + 0.2, x1 + 0.05, roofTop + 0.5, z1 - 0.2, 'concrete');
    }
    // מחיצה פנימית
    if (o.partition !== false && w > 8.5 && d > 6.5 && F >= 1 && !o.hangar) {
      for (let f = 0; f < F; f++) {
        const px = x0 + w * rand(rng, 0.42, 0.62);
        const px0 = Math.max(px, (holes[f + 1] ? holes[f + 1].x1 + 0.5 : px));
        const xx = holes[f + 1] || (f > 0 && holes[f]) ? Math.max(px, holes[f] ? holes[f].x1 + 0.5 : px, holes[f + 1] ? holes[f + 1].x1 + 0.5 : px) : px;
        if (xx > x1 - 3) continue;
        const dc = rand(rng, z0 + 3.5, z1 - 3.5);
        this.wall('z', xx, xx + 0.2, z0 + t, z1 - t, fy(f), FH - 0.2, [{ c: dc, w: 1.5, s: 0, t: 2.3 }], 'wallB');
      }
    }
    // ריהוט ולוט
    this._furnish(o, x0 + t, x1 - t, z0 + t, z1 - t, fy, F, holes);
    return { x0, x1, z0, z1, F };
  }

  _furnish(o, x0, x1, z0, z1, fy, F, holes) {
    const rng = this.rng;
    const tag = o.tag || 'house';
    for (let f = 0; f < F; f++) {
      const y = fy(f);
      const nF = o.noFurn ? 0 : Math.round((x1 - x0) * (z1 - z0) / 40);
      let placed = 0, tries = 0;
      while (placed < nF && tries++ < nF * 6) {
        const kind = pick(rng, ['table', 'cab', 'bed', 'sofa', 'crate']);
        const sw = { table: [1.3, 0.8, 0.78], cab: [0.9, 0.5, 1.9], bed: [2.0, 1.0, 0.5], sofa: [1.8, 0.8, 0.85], crate: [0.9, 0.9, 0.9] }[kind];
        const onX = rng() < 0.5;
        const wx = onX ? sw[0] : sw[1], wz = onX ? sw[1] : sw[0];
        // לצד קיר
        const px = rng() < 0.5 ? x0 + 0.1 + wx / 2 : x1 - 0.1 - wx / 2;
        const pz = rand(rng, z0 + 0.3 + wz / 2, z1 - 0.3 - wz / 2);
        if (this._blocked(px, pz, wx, wz, holes, f)) continue;
        // להשאיר מרווח בדלת (קומה 0 בלבד)
        const mat = kind === 'sofa' ? 'fabric' : kind === 'bed' ? 'fabric' : 'wood';
        this.box(px - wx / 2, y, pz - wz / 2, px + wx / 2, y + sw[2], pz + wz / 2, mat);
        placed++;
      }
      // נקודות לוט
      const nSpots = o.spots != null ? o.spots : Math.max(2, Math.round((x1 - x0) * (z1 - z0) / 28));
      let ps = 0, tr = 0;
      while (ps < nSpots && tr++ < nSpots * 8) {
        const sx = rand(rng, x0 + 0.8, x1 - 0.8), sz = rand(rng, z0 + 0.8, z1 - 0.8);
        if (this._blocked(sx, sz, 0.6, 0.6, holes, f)) continue;
        this.spots.push({ x: sx, y: y + 0.05, z: sz, tag, tier: o.tier || 1 });
        ps++;
      }
    }
  }

  _blocked(px, pz, wx, wz, holes, f) {
    for (const h of [holes[f], holes[f + 1]]) {
      if (h && px + wx / 2 > h.x0 - 0.8 && px - wx / 2 < h.x1 + 0.8 && pz + wz / 2 > h.z0 - 0.4 && pz - wz / 2 < h.z1 + 1.0) return true;
    }
    return false;
  }

  // ---------- יישובים ----------
  _buildTown(t) {
    const rng = this.rng;
    const y0 = t.padH;
    switch (t.kind) {
      case 'town': this._lattice(t, { cs: 38, dens: 0.85, kinds: [['house', 5], ['house2', 4], ['shop', 3], ['apart', 1.6]], streets: true }); this._plaza(t); break;
      case 'village': this._lattice(t, { cs: 40, dens: 0.55, kinds: [['house', 6], ['house2', 2], ['shop', 1]], streets: true }); if (t.id === 'light') this._lighthouse(t); break;
      case 'harbor': this._harbor(t); break;
      case 'military': this._military(t); break;
      case 'airfield': this._airfield(t); break;
      case 'hospital': this._hospital(t); break;
      case 'school': this._school(t); break;
      case 'farm': this._farm(t); break;
      case 'quarry': this._quarry(t); break;
    }
    // כמה מכוניות ליד כבישים בתוך היישוב
    for (let i = 0; i < 4 + (t.tier * 2); i++) {
      const a = rng() * Math.PI * 2, rr = rng() * t.r * 0.8;
      this._car(t.x + Math.cos(a) * rr, t.z + Math.sin(a) * rr, rng() < 0.5);
    }
  }

  _street(x0, z0, x1, z1, w = 7) {
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.ceil(L / 8));
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push({ x: lerp(x0, x1, i / n), z: lerp(z0, z1, i / n) });
    this.roads.push({ pts, w, main: false });
  }

  _lattice(t, o) {
    const rng = this.rng, y0 = t.padH, cs = o.cs;
    const n = Math.ceil(t.r / cs);
    // רחובות
    if (o.streets) {
      for (let k = -n; k <= n; k++) {
        const off = (k + 0.5) * cs;
        const hl = Math.sqrt(Math.max(0, (t.r - 8) ** 2 - off * off));
        if (hl < 12) continue;
        this._street(t.x - hl, t.z + off, t.x + hl, t.z + off);
        this._street(t.x + off, t.z - hl, t.x + off, t.z + hl);
      }
    }
    for (let gi = -n; gi < n; gi++) for (let gj = -n; gj < n; gj++) {
      // הרחובות נמצאים ב-(k+0.5)*cs, ולכן מרכז הבלוק בין שני רחובות הוא ב-(k+1)*cs
      const bcx = t.x + (gi + 0.5) * cs + cs / 2, bcz = t.z + (gj + 0.5) * cs + cs / 2;
      if (Math.hypot(bcx - t.x, bcz - t.z) > t.r - 22) continue;
      if (rng() > o.dens) continue;
      const kind = weighted(rng, o.kinds);
      let w, d, floors = 1, extra = {};
      if (kind === 'house') { w = randInt(rng, 8, 12); d = randInt(rng, 7, 10); }
      else if (kind === 'house2') { w = randInt(rng, 10, 13); d = randInt(rng, 8, 11); floors = 2; }
      else if (kind === 'shop') { w = randInt(rng, 13, 18); d = randInt(rng, 9, 12); extra = { bigWin: true, wall: 'wallC', tag: 'shop', tier: Math.max(2, t.tier), roof: 'flat' }; }
      else { w = 14; d = 12; floors = randInt(rng, 3, 4); extra = { wall: 'wallC', roof: 'flat', tag: 'apart', tier: 2 }; }
      const jx = rand(rng, -2, 2), jz = rand(rng, -2, 2);
      const doorSide = Math.floor(rng() * 4);
      this.building({ cx: bcx + jx, cz: bcz + jz, w, d, y0, floors, tier: t.tier, doorSide, wall: pick(rng, ['wallA', 'wallB', 'wallC']), roofMat: pick(rng, ['roofA', 'roofB']), tag: 'house', ...extra });
      // גינה/גדר קטנה לעיתים
      if (rng() < 0.25) this._tree(bcx + jx + w / 2 + 2.5, bcz + jz + rand(rng, -d / 3, d / 3), rng() < 0.5 ? 'oak' : 'pine', true);
    }
    // פנסי רחוב
    for (let k = -n; k <= n; k++) for (let m = -n; m <= n; m++) {
      const lx = t.x + (k + 0.5) * cs + 4.2, lz = t.z + (m + 0.5) * cs + 4.2;
      if (Math.hypot(lx - t.x, lz - t.z) < t.r - 14 && rng() < 0.7) this.lamps.push({ x: lx, z: lz, y: y0 });
    }
  }

  _plaza(t) {
    const y0 = t.padH;
    // מזרקה במרכז
    this.box(t.x - 3.5, y0, t.z - 3.5, t.x + 3.5, y0 + 0.7, t.z + 3.5, 'concrete');
    this.box(t.x - 0.5, y0, t.z - 0.5, t.x + 0.5, y0 + 2.6, t.z + 0.5, 'concrete');
    this.decos.push({ t: 'water', x: t.x, y: y0 + 0.65, z: t.z, r: 3.1 });
  }

  _lighthouse(t) {
    const y0 = t.padH, x = t.x + 40, z = t.z - 30;
    this.box(x - 2.5, y0, z - 2.5, x + 2.5, y0 + 24, z + 2.5, 'wallLight');
    this.box(x - 3.5, y0 + 24, z - 3.5, x + 3.5, y0 + 25, z + 3.5, 'concrete');
    this.box(x - 1.7, y0 + 25, z - 1.7, x + 1.7, y0 + 28, z + 1.7, 'glass', F_NB);
    this.decos.push({ t: 'cone', x, y: y0 + 28, z, r: 2.6, h: 3, m: 'roofB' });
  }

  _harbor(t) {
    const rng = this.rng, y0 = t.padH;
    // כיוון הים: לכיוון מחוץ לאי
    const ang = Math.atan2(t.z, t.x);
    const dx = Math.cos(ang), dz = Math.sin(ang);
    // מחסנים וקונטיינרים
    const wx = t.x - dx * 25, wz = t.z - dz * 25;
    for (let k = 0; k < 3; k++) {
      const ox = -dz * (k - 1) * 38, oz = dx * (k - 1) * 38;
      this.building({ cx: wx + ox, cz: wz + oz, w: 26, d: 16, y0, floors: 1, floorH: 6, hangar: true, partition: false, wall: 'wallMetal', roofMat: 'roofMetal', tag: 'harbor', tier: 2, extraOpen: [0, 1, 2, 3].slice(0, 2), extraW: 5, doors: [0, 2], spots: 7, noFurn: false });
    }
    // בניין משרדים
    this.building({ cx: wx - dx * 45 + dz * 40, cz: wz - dz * 45 - dx * 40, w: 12, d: 10, y0, floors: 2, tier: 2, wall: 'wallC', tag: 'harbor' });
    this.building({ cx: wx - dx * 45 - dz * 40, cz: wz - dz * 45 + dx * 40, w: 11, d: 9, y0, floors: 2, tier: 2, wall: 'wallB', tag: 'harbor' });
    // ערימות קונטיינרים
    const cols = ['containerR', 'containerB', 'containerG', 'containerY'];
    for (let k = 0; k < 14; k++) {
      const px = t.x + dx * rand(rng, 25, 60) - dz * rand(rng, -55, 55), pz = t.z + dz * rand(rng, 25, 60) + dx * rand(rng, -55, 55);
      const along = rng() < 0.5;
      const h = 2.6, lx = along ? 6.1 : 2.45, lz = along ? 2.45 : 6.1;
      this.box(px - lx, y0, pz - lz, px + lx, y0 + h, pz + lz, pick(rng, cols));
      if (rng() < 0.4) this.box(px - lx, y0 + h, pz - lz, px + lx, y0 + h * 2, pz + lz, pick(rng, cols));
      if (rng() < 0.5) this.spots.push({ x: px + (along ? 0 : 3.5), y: y0 + 0.1, z: pz + (along ? 3.5 : 0), tag: 'harbor', tier: 2 });
    }
    // רציפים
    for (let k = -1; k <= 1; k++) {
      const sx = t.x + dx * 58 - dz * k * 36, sz = t.z + dz * 58 + dx * k * 36;
      const px0 = Math.abs(dx) > Math.abs(dz) ? sx : sx - 3, pz0 = Math.abs(dx) > Math.abs(dz) ? sz - 3 : sz;
      const len = 46;
      if (Math.abs(dx) > Math.abs(dz)) {
        const s = Math.sign(dx);
        this.box(Math.min(sx, sx + s * len), y0 - 0.6, sz - 3, Math.max(sx, sx + s * len), y0 + 0.2, sz + 3, 'wood');
        for (let q = 0; q < 6; q++) this.box(sx + s * (q * 8) - 0.3, -6, sz - 3, sx + s * (q * 8) + 0.3, y0 - 0.6, sz - 2.6, 'wood', F_NB | F_NC);
      } else {
        const s = Math.sign(dz);
        this.box(sx - 3, y0 - 0.6, Math.min(sz, sz + s * len), sx + 3, y0 + 0.2, Math.max(sz, sz + s * len), 'wood');
      }
      this.spots.push({ x: sx + dx * 10, y: y0 + 0.25, z: sz + dz * 10, tag: 'harbor', tier: 2 });
      this.spots.push({ x: sx + dx * 25, y: y0 + 0.25, z: sz + dz * 25, tag: 'harbor', tier: 2 });
    }
    this._street(t.x - dx * 70 - dz * 80, t.z - dz * 70 + dx * 80, t.x - dx * 70 + dz * 80, t.z - dz * 70 - dx * 80, 8);
    // מנוף
    const cx = t.x + dx * 40 + dz * 70, cz = t.z + dz * 40 - dx * 70;
    this.box(cx - 1, y0, cz - 1, cx + 1, y0 + 26, cz + 1, 'metal');
    this.box(cx - 12, y0 + 24, cz - 1, cx + 12, y0 + 26, cz + 1, 'metal', F_NB);
  }

  _military(t) {
    const rng = this.rng, y0 = t.padH, R = t.r - 20;
    // גדר מסביב עם שער
    const f = R;
    const fenceH = 2.4;
    const seg = (x0, z0, x1, z1, gap) => {
      const horiz = Math.abs(z1 - z0) < 1e-6;
      if (horiz) {
        if (gap) { this.box(x0, y0, z0 - 0.1, gap - 5, y0 + fenceH, z0 + 0.1, 'fence', F_NB); this.box(gap + 5, y0, z0 - 0.1, x1, y0 + fenceH, z0 + 0.1, 'fence', F_NB); }
        else this.box(x0, y0, z0 - 0.1, x1, y0 + fenceH, z0 + 0.1, 'fence', F_NB);
      } else this.box(x0 - 0.1, y0, z0, x0 + 0.1, y0 + fenceH, z1, 'fence', F_NB);
    };
    seg(t.x - f, t.z - f, t.x + f, t.z - f, null);
    seg(t.x - f, t.z + f, t.x + f, t.z + f, t.x);
    seg(t.x - f, t.z - f, t.x - f, t.z + f);
    seg(t.x + f, t.z - f, t.x + f, t.z + f);
    // מפקדה
    this.building({ cx: t.x, cz: t.z - 30, w: 22, d: 14, y0, floors: 3, tier: 3, wall: 'wallMil', tag: 'military', roof: 'flat', doors: [2], spots: 6 });
    // מגורים
    for (let k = 0; k < 4; k++) this.building({ cx: t.x - 70 + k * 46, cz: t.z + 45, w: 26, d: 9, y0, floors: 1, tier: 3, wall: 'wallMil', tag: 'military', roof: 'flat', doors: [0], spots: 4, partition: true });
    // האנגרים
    for (let k = 0; k < 2; k++) this.building({ cx: t.x - 50 + k * 100, cz: t.z - 80, w: 28, d: 18, y0, floors: 1, floorH: 7, hangar: true, partition: false, wall: 'wallMetal', roofMat: 'roofMetal', tag: 'military', tier: 3, extraOpen: [2], extraW: 9, doors: [1], spots: 8 });
    // מגדלי שמירה
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const px = t.x + sx * (f - 6), pz = t.z + sz * (f - 6);
      this.building({ cx: px, cz: pz, w: 6, d: 6, y0, floors: 3, tier: 3, wall: 'wallMil', tag: 'military', roof: 'flat', doors: [sx > 0 ? 3 : 1], spots: 2, partition: false, noFurn: true, bigWin: true });
    }
    // בונקרים
    for (let k = 0; k < 3; k++) {
      const a = rng() * Math.PI * 2, px = t.x + Math.cos(a) * 40, pz = t.z + Math.sin(a) * 20 + 10;
      this.building({ cx: px, cz: pz, w: 9, d: 7, y0, floors: 1, floorH: 2.8, tier: 3, wall: 'concrete', tag: 'military', roof: 'flat', doors: [Math.floor(rng() * 4)], spots: 3, partition: false, noFurn: true });
    }
    // שקי חול וארגזים
    for (let k = 0; k < 26; k++) {
      const a = rng() * Math.PI * 2, rr = rand(rng, 10, R - 14);
      const px = t.x + Math.cos(a) * rr, pz = t.z + Math.sin(a) * rr;
      if (this._nearBuilding(px, pz, 4)) continue;
      const along = rng() < 0.5;
      this.box(px - (along ? 2 : 0.5), y0, pz - (along ? 0.5 : 2), px + (along ? 2 : 0.5), y0 + 0.95, pz + (along ? 0.5 : 2), 'sand');
      if (rng() < 0.4) this.spots.push({ x: px + 1.2, y: y0 + 0.1, z: pz + 1.2, tag: 'military', tier: 3 });
    }
    for (let k = 0; k < 8; k++) {
      const px = t.x + rand(rng, -R + 12, R - 12), pz = t.z + rand(rng, 20, R - 12);
      if (this._nearBuilding(px, pz, 8)) continue;
      this.box(px - 6.1, y0, pz - 2.45, px + 6.1, y0 + 2.6, pz + 2.45, pick(rng, ['containerG', 'containerG', 'containerB']));
    }
    this._street(t.x, t.z + R, t.x, t.z - R, 8);
    this._street(t.x - R, t.z + 20, t.x + R, t.z + 20, 8);
  }

  _airfield(t) {
    const rng = this.rng, y0 = t.padH;
    // מסלול נחיתה (קישוט) לאורך ציר x
    this.decos.push({ t: 'runway', x: t.x, y: y0 + 0.06, z: t.z + 28, w: 340, d: 34 });
    this.decos.push({ t: 'runway', x: t.x, y: y0 + 0.07, z: t.z + 66, w: 220, d: 12, taxi: true });
    // האנגרים
    for (let k = 0; k < 3; k++) this.building({ cx: t.x - 80 + k * 55, cz: t.z - 40, w: 30, d: 22, y0, floors: 1, floorH: 8, hangar: true, partition: false, wall: 'wallMetal', roofMat: 'roofMetal', tag: 'airfield', tier: 3, extraOpen: [2], extraW: 12, doors: [0], spots: 8 });
    // מגדל פיקוח
    this.building({ cx: t.x + 100, cz: t.z - 30, w: 8, d: 8, y0, floors: 4, tier: 3, wall: 'wallC', tag: 'airfield', roof: 'flat', doors: [3], spots: 3, partition: false, bigWin: true });
    // מסוף
    this.building({ cx: t.x + 70, cz: t.z - 75, w: 30, d: 14, y0, floors: 2, tier: 3, wall: 'wallC', tag: 'airfield', roof: 'flat', doors: [2], bigWin: true, spots: 8 });
    // מכלי דלק
    for (let k = 0; k < 3; k++) {
      const px = t.x - 110, pz = t.z - 85 + k * 14;
      this.box(px - 4, y0, pz - 4, px + 4, y0 + 5, pz + 4, 'metal');
      this.decos.push({ t: 'tank', x: px, y: y0, z: pz, r: 4.2, h: 5 });
    }
    // מטוסים חונים (קישוט עם התנגשות פשוטה)
    for (let k = 0; k < 3; k++) this._plane(t.x - 70 + k * 40, y0, t.z + 62);
    // ארגזים
    for (let k = 0; k < 14; k++) {
      const px = t.x + rand(rng, -110, 110), pz = t.z + rand(rng, -90, 10);
      if (this._nearBuilding(px, pz, 6)) continue;
      this.box(px - 1.2, y0, pz - 1.2, px + 1.2, y0 + 1.6, pz + 1.2, 'crate');
      if (rng() < 0.6) this.spots.push({ x: px + 2, y: y0 + 0.1, z: pz, tag: 'airfield', tier: 3 });
    }
    this._street(t.x - 130, t.z - 15, t.x + 130, t.z - 15, 8);
  }

  _plane(x, y0, z) {
    this.box(x - 7, y0 + 1.2, z - 1.3, x + 7, y0 + 3.2, z + 1.3, 'planeBody');
    this.box(x - 1.4, y0 + 1.8, z - 9, x + 1.4, y0 + 2.3, z + 9, 'planeBody', F_NB);
    this.box(x + 5.8, y0 + 1.6, z - 0.15, x + 7.3, y0 + 4.5, z + 0.15, 'planeBody', F_NB);
  }

  _hospital(t) {
    const y0 = t.padH;
    this.building({ cx: t.x, cz: t.z - 5, w: 46, d: 18, y0, floors: 3, tier: 3, wall: 'wallLight', tag: 'hospital', roof: 'flat', doors: [2, 2], doorOff: 0, bigWin: true, spots: 14, partition: true });
    this.building({ cx: t.x - 36, cz: t.z + 32, w: 14, d: 10, y0, floors: 1, tier: 3, wall: 'wallLight', tag: 'hospital', roof: 'flat', doors: [0], spots: 5 });
    this.building({ cx: t.x + 36, cz: t.z + 32, w: 14, d: 10, y0, floors: 1, tier: 3, wall: 'wallLight', tag: 'hospital', roof: 'flat', doors: [0], spots: 5 });
    this.decos.push({ t: 'helipad', x: t.x, y: y0 + 0.06, z: t.z + 45, r: 12 });
    this._street(t.x - 60, t.z + 20, t.x + 60, t.z + 20, 8);
    for (let k = 0; k < 3; k++) this._car(t.x - 30 + k * 30, t.z + 15, true, 'ambulance');
  }

  _school(t) {
    const y0 = t.padH;
    this.building({ cx: t.x, cz: t.z - 12, w: 34, d: 14, y0, floors: 2, tier: 2, wall: 'wallB', tag: 'school', roof: 'flat', doors: [2], bigWin: true, spots: 10 });
    this.building({ cx: t.x + 38, cz: t.z + 12, w: 20, d: 16, y0, floors: 1, floorH: 6, hangar: true, partition: false, tier: 2, wall: 'wallC', tag: 'school', roof: 'flat', doors: [3], spots: 6 });
    this.decos.push({ t: 'field', x: t.x - 20, y: y0 + 0.05, z: t.z + 28, w: 40, d: 28, c: 0x3f8a43, track: true });
    const f = 62, h = 2.2;
    this.box(t.x - f, y0, t.z - 35, t.x + f, y0 + h, t.z - 34.8, 'fence', F_NB);
    this.box(t.x - f, y0, t.z + 45, t.x - 8, y0 + h, t.z + 45.2, 'fence', F_NB);
    this.box(t.x + 8, y0, t.z + 45, t.x + f, y0 + h, t.z + 45.2, 'fence', F_NB);
    this.box(t.x - f, y0, t.z - 35, t.x - f + 0.2, y0 + h, t.z + 45, 'fence', F_NB);
    this.box(t.x + f, y0, t.z - 35, t.x + f + 0.2, y0 + h, t.z + 45, 'fence', F_NB);
    this._street(t.x, t.z + 45, t.x, t.z + 90, 7);
  }

  _farm(t) {
    const rng = this.rng, y0 = t.padH;
    this.building({ cx: t.x - 20, cz: t.z - 10, w: 20, d: 12, y0, floors: 1, floorH: 5, hangar: true, partition: false, wall: 'wood', roofMat: 'roofB', tag: 'farm', tier: 2, extraOpen: [2], extraW: 6, doors: [0], spots: 7 });
    this.building({ cx: t.x + 28, cz: t.z - 20, w: 11, d: 9, y0, floors: 2, tier: 2, wall: 'wallA', tag: 'farm' });
    this.building({ cx: t.x + 26, cz: t.z + 25, w: 9, d: 8, y0, floors: 1, tier: 2, wall: 'wallB', tag: 'farm' });
    // סילו
    this.box(t.x + 5, y0, t.z - 30, t.x + 11, y0 + 14, t.z - 24, 'metal');
    this.decos.push({ t: 'silo', x: t.x + 8, y: y0, z: t.z - 27, r: 3.2, h: 14 });
    // בלות חציר ושדות
    for (let k = 0; k < 10; k++) {
      const px = t.x + rand(rng, -60, 60), pz = t.z + rand(rng, 25, 70);
      if (Math.hypot(px - t.x, pz - t.z) > t.r - 10) continue;
      this.box(px - 1.0, y0, pz - 0.8, px + 1.0, y0 + 1.5, pz + 0.8, 'hay');
      if (rng() < 0.4) this.spots.push({ x: px, y: y0 + 0.1, z: pz + 2, tag: 'farm', tier: 2 });
    }
    const cols = [0x6a9a3a, 0xc4b04a, 0x4b8a42, 0x8a6a3a];
    for (let k = 0; k < 6; k++) {
      this.decos.push({ t: 'field', x: t.x - 70 + (k % 3) * 55, y: y0 + 0.05, z: t.z + 60 + Math.floor(k / 3) * 40, w: 50, d: 34, c: cols[k % 4], rows: true });
    }
    this._tractor(t.x - 5, y0, t.z + 15);
    this._street(t.x - 60, t.z, t.x + 70, t.z, 6);
  }

  _tractor(x, y0, z) {
    this.box(x - 1.4, y0 + 0.5, z - 0.9, x + 1.8, y0 + 1.6, z + 0.9, 'tractor');
    this.box(x - 0.6, y0 + 1.6, z - 0.8, x + 0.8, y0 + 2.6, z + 0.8, 'tractor');
  }

  _quarry(t) {
    const rng = this.rng, y0 = t.padH - 11;
    for (let k = 0; k < 10; k++) {
      const a = rng() * Math.PI * 2, rr = rand(rng, 15, 55);
      const px = t.x + Math.cos(a) * rr, pz = t.z + Math.sin(a) * rr;
      const gy = this.heightAt(px, pz);
      const along = rng() < 0.5;
      const lx = along ? 6.1 : 2.45, lz = along ? 2.45 : 6.1;
      this.box(px - lx, gy - 0.1, pz - lz, px + lx, gy + 2.6, pz + lz, pick(rng, ['containerR', 'containerB', 'containerG', 'containerY']));
      this.spots.push({ x: px + (along ? 0 : 3.6), y: gy + 0.1, z: pz + (along ? 3.6 : 0), tag: 'quarry', tier: 2 });
    }
    // בקתת פיקוד על שפת הבור
    const hy = t.padH;
    this.building({ cx: t.x + 85, cz: t.z - 20, w: 12, d: 9, y0: this.heightAt(t.x + 85, t.z - 20), floors: 1, tier: 2, wall: 'wallMetal', tag: 'quarry', roof: 'flat' });
    this.building({ cx: t.x - 80, cz: t.z + 30, w: 10, d: 8, y0: this.heightAt(t.x - 80, t.z + 30), floors: 1, tier: 2, wall: 'wallB', tag: 'quarry' });
    for (let k = 0; k < 12; k++) {
      const a = rng() * Math.PI * 2, rr = rand(rng, 20, 80);
      this.rocks.push({ x: t.x + Math.cos(a) * rr, z: t.z + Math.sin(a) * rr, s: rand(rng, 1.5, 4), ry: rng() * 6 });
    }
  }

  _car(x, z, alongX, kind = 'car') {
    const rng = this.rng;
    const y = this.heightAt(x, z);
    if (y < 0.4) return;
    if (this._nearBuilding(x, z, 4)) return;
    const lx = alongX ? 2.3 : 1.0, lz = alongX ? 1.0 : 2.3;
    const col = kind === 'ambulance' ? 'carWhite' : pick(rng, ['carRed', 'carBlue', 'carWhite', 'carGrey', 'carGreen']);
    this.box(x - lx, y + 0.35, z - lz, x + lx, y + 1.05, z + lz, col);
    const cx = alongX ? 1.3 : 0.9, cz = alongX ? 0.9 : 1.3;
    this.box(x - cx, y + 1.05, z - cz, x + cx, y + 1.65, z + cz, 'carGlass');
    this.spots.push({ x: x + (alongX ? 0 : 2), y: y + 0.1, z: z + (alongX ? 2 : 0), tag: 'car', tier: 1 });
    this.decos.push({ t: 'wheels', x, y, z, alongX });
  }

  _nearBuilding(x, z, m) {
    for (const b of this.boxes) {
      if (b.maxY - b.minY > 1.2 && x > b.minX - m && x < b.maxX + m && z > b.minZ - m && z < b.maxZ + m) return true;
    }
    return false;
  }

  _tree(x, z, kind, force = false) {
    const y = this.heightAt(x, z);
    if (y < 0.6) return;
    const rng = this.rng;
    const s = rand(rng, 0.85, 1.4);
    this.trees.push({ x, y, z, k: kind, s, ry: rng() * 6.28 });
    this.box(x - 0.35, y - 0.3, z - 0.35, x + 0.35, y + 9 * s, z + 0.35, 'trunk', F_NB * 0);
  }

  _nature() {
    const rng = this.rng, s = this.seed;
    const near = (x, z) => {
      for (const t of this.towns) if (Math.hypot(x - t.x, z - t.z) < t.r + 12) return true;
      return false;
    };
    const N = this.N, cs = this.cell;
    const onRoad = (x, z) => {
      const i = Math.round((x + MAP.half) / cs), j = Math.round((z + MAP.half) / cs);
      if (i < 0 || j < 0 || i > N || j > N) return true;
      return this.roadMask[i + j * (N + 1)] > 0;
    };
    // עצים
    let tries = 0, placed = 0;
    while (placed < 2600 && tries++ < 20000) {
      const x = rand(rng, -700, 700), z = rand(rng, -700, 700);
      if (Math.hypot(x, z) > 690) continue;
      const f = fbm(x / 120, z / 120, s + 31, 3);
      if (f < 0.46 && rng() < 0.9) continue;
      if (near(x, z) || onRoad(x, z)) continue;
      const hh = this.heightAt(x, z);
      if (hh < 1.2) continue;
      this._tree(x, z, hh > 22 || f > 0.62 ? 'pine' : (rng() < 0.45 ? 'pine' : 'oak'));
      placed++;
    }
    // סלעים
    for (let i = 0; i < 360; i++) {
      const x = rand(rng, -720, 720), z = rand(rng, -720, 720);
      if (near(x, z) || onRoad(x, z)) continue;
      const hh = this.heightAt(x, z);
      if (hh < -0.5) continue;
      const sc = rand(rng, 0.8, 3.6);
      this.rocks.push({ x, z, s: sc, ry: rng() * 6.28 });
    }
    for (const r of this.rocks) {
      const y = this.heightAt(r.x, r.z);
      r.y = y;
      this.box(r.x - r.s * 0.7, y - 0.6, r.z - r.s * 0.7, r.x + r.s * 0.7, y + r.s * 0.9, r.z + r.s * 0.7, 'rock');
    }
    // שיחים (קישוט)
    for (let i = 0; i < 1400; i++) {
      const x = rand(rng, -720, 720), z = rand(rng, -720, 720);
      if (onRoad(x, z) || this.townAt(x, z)) continue;
      const hh = this.heightAt(x, z);
      if (hh < 0.8) continue;
      this.bushes.push({ x, y: hh, z, s: rand(rng, 0.7, 1.6) });
    }
    // כמה מכוניות על כבישים ראשיים
    for (const r of this.roads) {
      if (!r.main) continue;
      for (let k = 0; k < 2; k++) {
        const p = r.pts[Math.floor(rng() * r.pts.length)];
        if (this.townAt(p.x, p.z)) continue;
        this._car(p.x + rand(rng, -2, 2), p.z + rand(rng, -2, 2), rng() < 0.5);
      }
    }
  }

  _buildGrid() {
    for (const b of this.boxes) {
      if (b.f & F_NC) continue;
      const i0 = clamp(Math.floor((b.minX + MAP.half) / CELL), 0, GN - 1), i1 = clamp(Math.floor((b.maxX + MAP.half) / CELL), 0, GN - 1);
      const j0 = clamp(Math.floor((b.minZ + MAP.half) / CELL), 0, GN - 1), j1 = clamp(Math.floor((b.maxZ + MAP.half) / CELL), 0, GN - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.grid[i + j * GN].push(b);
    }
  }

  // ---------- לוט ----------
  _spawnLoot() {
    const rng = mulberry32(this.seed ^ 0x51ed270b);
    for (const sp of this.spots) {
      if (rng() < 0.12) continue;
      const items = rollLoot(rng, sp.tag, sp.tier);
      let k = 0;
      for (const it of items) {
        const a = rng() * Math.PI * 2, rr = k === 0 ? 0 : 0.5 + rng() * 0.5;
        this.addLoot(it.k, it.c, sp.x + Math.cos(a) * rr, sp.y, sp.z + Math.sin(a) * rr);
        k++;
      }
    }
  }
  addLoot(k, c, x, y, z, id) {
    const L = { id: id ?? this.nextLootId++, k, c, x, y, z };
    this.loot.set(L.id, L);
    return L;
  }

  // ---------- שאילתות ----------
  _cellsBox(x0, z0, x1, z1, fn) {
    const i0 = clamp(Math.floor((x0 + MAP.half) / CELL), 0, GN - 1), i1 = clamp(Math.floor((x1 + MAP.half) / CELL), 0, GN - 1);
    const j0 = clamp(Math.floor((z0 + MAP.half) / CELL), 0, GN - 1), j1 = clamp(Math.floor((z1 + MAP.half) / CELL), 0, GN - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(this.grid[i + j * GN]);
  }

  groundAt(x, z, y, r = 0.3) {
    let g = Math.max(this.heightAt(x, z), MAP.waterFloor);
    const lim = y + PHYS.STEP + 0.02;
    this._cellsBox(x - r, z - r, x + r, z + r, (cell) => {
      for (const b of cell) {
        if (b.maxY > g && b.maxY <= lim && x + r * 0.7 > b.minX && x - r * 0.7 < b.maxX && z + r * 0.7 > b.minZ && z - r * 0.7 < b.maxZ) g = b.maxY;
      }
    });
    return g;
  }

  // move body: {x,y,z,vx,vy,vz,r,h,onGround}
  moveBody(b, dt) {
    const sp = Math.hypot(b.vx, b.vz) * dt;
    const n = Math.max(1, Math.ceil(sp / 0.22));
    const sdt = dt / n;
    for (let i = 0; i < n; i++) {
      b.x += b.vx * sdt; b.z += b.vz * sdt;
      this._resolveH(b);
    }
    const wasGround = b.onGround;
    b.vy -= PHYS.G * dt;
    const oy = b.y;
    b.y += b.vy * dt;
    // תקרה
    if (b.vy > 0) {
      const top = b.y + b.h;
      this._cellsBox(b.x - b.r, b.z - b.r, b.x + b.r, b.z + b.r, (cell) => {
        for (const bx of cell) {
          if (bx.minY >= oy + b.h - 0.05 && bx.minY < top + 0.02 && b.x + b.r > bx.minX && b.x - b.r < bx.maxX && b.z + b.r > bx.minZ && b.z - b.r < bx.maxZ) {
            b.y = bx.minY - b.h - 0.01; b.vy = 0;
          }
        }
      });
    }
    const g = this.groundAt(b.x, b.z, Math.max(oy, b.y), b.r);
    if (b.y <= g + 0.0001) {
      b.y = g; if (b.vy < 0) b.vy = 0; b.onGround = true;
    } else if (wasGround && b.vy <= 0 && b.y - g < 0.55 && oy - g < 0.55) {
      b.y = g; b.vy = 0; b.onGround = true;
    } else b.onGround = false;
  }

  _resolveH(b) {
    const r = b.r, y = b.y, top = y + b.h;
    this._cellsBox(b.x - r, b.z - r, b.x + r, b.z + r, (cell) => {
      for (const bx of cell) {
        if (bx.maxY <= y + PHYS.STEP) continue;
        if (bx.minY >= top) continue;
        const cx = clamp(b.x, bx.minX, bx.maxX), cz = clamp(b.z, bx.minZ, bx.maxZ);
        const dx = b.x - cx, dz = b.z - cz, d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2), k = (r - d) / d;
          b.x += dx * k; b.z += dz * k;
        } else {
          const l = b.x - bx.minX, rr = bx.maxX - b.x, u = b.z - bx.minZ, dn = bx.maxZ - b.z;
          const m = Math.min(l, rr, u, dn);
          if (m === l) b.x = bx.minX - r; else if (m === rr) b.x = bx.maxX + r;
          else if (m === u) b.z = bx.minZ - r; else b.z = bx.maxZ + r;
        }
      }
    });
  }

  // ריי-קאסט: מחזיר {t,x,y,z,nx,ny,nz,kind,box} או null
  raycast(ox, oy, oz, dx, dy, dz, maxD, skipNB = true) {
    let best = null, bt = maxD;
    // קופסאות לאורך הקרן
    this._mark++;
    const mk = this._mark;
    const stepL = CELL * 0.8;
    const steps = Math.ceil(Math.min(maxD, 1500) / stepL);
    let lastI = -1, lastJ = -1;
    for (let s = 0; s <= steps; s++) {
      const tt = Math.min(maxD, s * stepL);
      const px = ox + dx * tt, pz = oz + dz * tt;
      if (px < -MAP.half - 40 || px > MAP.half + 40 || pz < -MAP.half - 40 || pz > MAP.half + 40) break;
      const ci = clamp(Math.floor((px + MAP.half) / CELL), 0, GN - 1), cj = clamp(Math.floor((pz + MAP.half) / CELL), 0, GN - 1);
      // בדיקת התא ושכנים (הקרן יכולה לחצות תאים בין הדגימות)
      for (let jj = cj - 1; jj <= cj + 1; jj++) for (let ii = ci - 1; ii <= ci + 1; ii++) {
        if (ii < 0 || jj < 0 || ii >= GN || jj >= GN) continue;
        for (const bx of this.grid[ii + jj * GN]) {
          if (bx._m === mk) continue;
          bx._m = mk;
          if (skipNB && (bx.f & F_NB)) continue;
          const h = rayBox(ox, oy, oz, dx, dy, dz, bx, bt);
          if (h && h.t < bt) { bt = h.t; best = { t: h.t, nx: h.nx, ny: h.ny, nz: h.nz, kind: 'box', box: bx }; }
        }
      }
      if (tt >= bt) break;
    }
    // שטח
    let t = 0.5, prevAbove = true;
    const lim = Math.min(bt, maxD);
    let pt = 0;
    while (t < lim) {
      const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
      const gh = this.heightAt(x, z);
      if (y < gh) {
        // מצמצמים בין pt ל-t
        let a = pt, c = t;
        for (let k = 0; k < 8; k++) {
          const m = (a + c) / 2;
          const hy = oy + dy * m, hh = this.heightAt(ox + dx * m, oz + dz * m);
          if (hy < hh) c = m; else a = m;
        }
        const hx = ox + dx * c, hz = oz + dz * c;
        const e = 0.6;
        const nx = this.heightAt(hx - e, hz) - this.heightAt(hx + e, hz), nz = this.heightAt(hx, hz - e) - this.heightAt(hx, hz + e);
        const nl = Math.hypot(nx, 2 * e, nz);
        if (c < bt) { bt = c; best = { t: c, nx: nx / nl, ny: 2 * e / nl, nz: nz / nl, kind: 'terrain', box: null }; }
        break;
      }
      pt = t;
      t += Math.max(0.8, Math.min(8, t * 0.025));
    }
    if (best) { best.x = ox + dx * best.t; best.y = oy + dy * best.t; best.z = oz + dz * best.t; }
    return best;
  }

  // קו ראיה בין שתי נקודות
  los(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const L = Math.hypot(dx, dy, dz);
    if (L < 0.01) return true;
    return !this.raycast(ax, ay, az, dx / L, dy / L, dz / L, L - 0.3);
  }
}

function rayBox(ox, oy, oz, dx, dy, dz, b, maxT) {
  let tmin = 0, tmax = maxT, nx = 0, ny = 0, nz = 0;
  // X
  if (Math.abs(dx) < 1e-9) { if (ox < b.minX || ox > b.maxX) return null; }
  else {
    let t1 = (b.minX - ox) / dx, t2 = (b.maxX - ox) / dx, n1 = -1;
    if (t1 > t2) { const q = t1; t1 = t2; t2 = q; n1 = 1; }
    if (t1 > tmin) { tmin = t1; nx = n1; ny = 0; nz = 0; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (Math.abs(dy) < 1e-9) { if (oy < b.minY || oy > b.maxY) return null; }
  else {
    let t1 = (b.minY - oy) / dy, t2 = (b.maxY - oy) / dy, n1 = -1;
    if (t1 > t2) { const q = t1; t1 = t2; t2 = q; n1 = 1; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = n1; nz = 0; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (Math.abs(dz) < 1e-9) { if (oz < b.minZ || oz > b.maxZ) return null; }
  else {
    let t1 = (b.minZ - oz) / dz, t2 = (b.maxZ - oz) / dz, n1 = -1;
    if (t1 > t2) { const q = t1; t1 = t2; t2 = q; n1 = 1; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = 0; nz = n1; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmin <= 0 && !(nx || ny || nz)) return null; // מתחילים בתוך הקופסה
  return { t: tmin, nx, ny, nz };
}
