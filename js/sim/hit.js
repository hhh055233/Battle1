// זיהוי פגיעות בשחקנים (כדורי כדור-על-קרן). משותף ללקוח (ירי) ול-host (בוטים).
const STAND = [[0, 1.62, 0.22, 'h'], [0, 1.30, 0.30, 'b'], [0, 0.95, 0.28, 'b'], [0, 0.55, 0.25, 'l'], [0, 0.20, 0.22, 'l']];
const CROUCH = [[0, 1.17, 0.22, 'h'], [0, 0.95, 0.30, 'b'], [0, 0.70, 0.28, 'b'], [0, 0.35, 0.25, 'l'], [0, 0.12, 0.2, 'l']];
const PRONE = [[0.6, 0.30, 0.2, 'h'], [0.2, 0.30, 0.28, 'b'], [-0.2, 0.30, 0.26, 'b'], [-0.6, 0.25, 0.22, 'l'], [-0.9, 0.2, 0.2, 'l']];
const SETS = [STAND, CROUCH, PRONE];

// מחזיר {t, z} של הפגיעה הקרובה ביותר בשחקן, או null
export function rayPlayer(ox, oy, oz, dx, dy, dz, maxT, p) {
  const set = SETS[p.stance | 0] || STAND;
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  let best = null;
  for (const [f, y, r, z] of set) {
    const cx = p.x + fx * f, cy = p.y + y, cz = p.z + fz * f;
    const lx = cx - ox, ly = cy - oy, lz = cz - oz;
    const tca = lx * dx + ly * dy + lz * dz;
    if (tca < -r) continue;
    const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
    if (d2 > r * r) continue;
    const thc = Math.sqrt(r * r - d2);
    let t = tca - thc; if (t < 0) t = tca + thc;
    if (t < 0 || t > maxT) continue;
    if (!best || t < best.t || (Math.abs(t - best.t) < 0.05 && z === 'h')) best = { t, z };
  }
  return best;
}

export function bodyCenter(p) {
  const h = p.stance === 2 ? 0.3 : p.stance === 1 ? 0.9 : 1.25;
  return { x: p.x, y: p.y + h, z: p.z };
}

// נזק לפי נשק, מרחק ואזור (לפני שריון)
export function calcDamage(W, dist, zone) {
  const fall = Math.min(1, Math.max(0, (dist - W.range * 0.5) / (W.range * 1.5)));
  let d = W.dmg * (1 - (1 - W.min) * fall);
  if (zone === 'h') d *= W.hm; else if (zone === 'l') d *= 0.85;
  return d;
}
