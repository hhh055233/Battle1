// לוח הזמנים של המשחק: מטוס, אזור קריסה, פיזיקת רימונים. דטרמיניסטי לפי seed, כך שכל הלקוחות מחשבים אותו זהה.
import { mulberry32, lerp, clamp, rand } from './util.js';
import { ZONE_PHASES, ZONE_START_R, ZONE_T0, PLANE, MAP } from './data.js';

export class Timeline {
  constructor(seed, speed = 1) {
    this.speed = speed;
    const rng = mulberry32((seed ^ 0xabcdef) | 0);
    // מסלול המטוס
    const a = rng() * Math.PI * 2;
    const lat = (rng() - 0.5) * 360;
    const L = 1100;
    const ca = Math.cos(a), sa = Math.sin(a);
    this.p0 = { x: ca * L - sa * lat, z: sa * L + ca * lat };
    this.p1 = { x: -ca * L - sa * lat, z: -sa * L + ca * lat };
    const dx = this.p1.x - this.p0.x, dz = this.p1.z - this.p0.z, len = Math.hypot(dx, dz);
    this.dir = { x: dx / len, z: dz / len };
    this.planeDur = len / PLANE.speed;
    // שלבי האזור
    this.phases = [];
    let cx = 0, cz = 0, r = ZONE_START_R, T = ZONE_T0;
    for (const P of ZONE_PHASES) {
      const maxOff = Math.max(0, (r - P.r) * 0.85);
      const ang = rng() * Math.PI * 2, off = Math.sqrt(rng()) * maxOff;
      const ncx = cx + Math.cos(ang) * off, ncz = cz + Math.sin(ang) * off;
      const wait = P.wait / speed, shrink = P.shrink / speed;
      this.phases.push({ pcx: cx, pcz: cz, pr: r, ncx, ncz, nr: P.r, t0: T, ts: T + wait, t1: T + wait + shrink, dps: P.dps });
      cx = ncx; cz = ncz; r = P.r; T += wait + shrink;
    }
    this.endT = T;
  }

  plane(t) {
    const d = PLANE.speed * t;
    return { x: this.p0.x + this.dir.x * d, z: this.p0.z + this.dir.z * d, y: PLANE.alt, dx: this.dir.x, dz: this.dir.z, gone: t > this.planeDur };
  }

  zone(t) {
    if (t < ZONE_T0) return { phase: 0, mode: 'pre', cx: 0, cz: 0, r: ZONE_START_R, tcx: 0, tcz: 0, tr: ZONE_START_R, dps: 0, left: ZONE_T0 - t };
    for (let i = 0; i < this.phases.length; i++) {
      const p = this.phases[i];
      if (t < p.t1) {
        if (t < p.ts) return { phase: i + 1, mode: 'wait', cx: p.pcx, cz: p.pcz, r: p.pr, tcx: p.ncx, tcz: p.ncz, tr: p.nr, dps: i === 0 ? 0 : this.phases[i - 1].dps, left: p.ts - t };
        const u = (t - p.ts) / (p.t1 - p.ts);
        return { phase: i + 1, mode: 'shrink', cx: lerp(p.pcx, p.ncx, u), cz: lerp(p.pcz, p.ncz, u), r: lerp(p.pr, p.nr, u), tcx: p.ncx, tcz: p.ncz, tr: p.nr, dps: p.dps, left: p.t1 - t };
      }
    }
    const l = this.phases[this.phases.length - 1];
    return { phase: this.phases.length, mode: 'end', cx: l.ncx, cz: l.ncz, r: l.nr, tcx: l.ncx, tcz: l.ncz, tr: l.nr, dps: l.dps, left: 0 };
  }

  // נזק לשנייה במיקום (x,z) בזמן t. בתוך האזור: 0
  zoneDps(t, x, z) {
    const Z = this.zone(t);
    if (Z.mode === 'pre') return Math.hypot(x, z) > Z.r ? 0.4 : 0;
    const d = Math.hypot(x - Z.cx, z - Z.cz);
    if (d <= Z.r) return 0;
    return Z.dps || 0.4;
  }
}

// ---------- קליע/רימון ----------
export function stepProjectile(g, dt, world) {
  if (g.rest) return;
  g.vy -= 17 * dt;
  const nx = g.x + g.vx * dt, ny = g.y + g.vy * dt, nz = g.z + g.vz * dt;
  const dx = nx - g.x, dy = ny - g.y, dz = nz - g.z, L = Math.hypot(dx, dy, dz);
  if (L > 1e-6) {
    const h = world.raycast(g.x, g.y, g.z, dx / L, dy / L, dz / L, L + 0.08, true);
    if (h) {
      const dot = g.vx * h.nx + g.vy * h.ny + g.vz * h.nz;
      g.vx -= 1.55 * dot * h.nx; g.vy -= 1.55 * dot * h.ny; g.vz -= 1.55 * dot * h.nz;
      if (h.ny > 0.6) { g.vx *= 0.72; g.vz *= 0.72; }
      g.x = h.x + h.nx * 0.06; g.y = h.y + h.ny * 0.06; g.z = h.z + h.nz * 0.06;
      if (Math.hypot(g.vx, g.vy, g.vz) < 1.6 && h.ny > 0.5) { g.rest = true; g.vx = g.vy = g.vz = 0; }
      return;
    }
  }
  g.x = nx; g.y = ny; g.z = nz;
  const gh = Math.max(world.heightAt(g.x, g.z), MAP.waterFloor);
  if (g.y < gh) { g.y = gh + 0.05; g.vy = Math.abs(g.vy) * 0.3; g.vx *= 0.7; g.vz *= 0.7; if (Math.hypot(g.vx, g.vz) < 0.8 && g.vy < 1) { g.rest = true; g.vx = g.vy = g.vz = 0; } }
}

export function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
