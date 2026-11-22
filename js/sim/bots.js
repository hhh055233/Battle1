// בוטים: קופצים מהמטוס, צוחים לנקודת נחיתה, מחפשים לוט, נמלטים מהאזור הכחול ולוחמים.
// כולם רצים על ה-host ומשתמשים באותה פיזיקה של שחקנים.
import { newBody, stepWalk } from './player.js';
import { PHYS, PLANE, WEAPONS, HELMET, VEST, MAP, MEDS, AMMO } from './data.js';
import { clamp, angleDiff, rand, weighted } from './util.js';
import { FL } from './player.js';

const wScore = (id) => {
  const W = WEAPONS[id];
  return (W.dmg * (W.pel || 1) * 0.35 * W.rpm / 60) + (W.cls === 'sr' ? 220 : W.cls === 'dmr' ? 140 : W.cls === 'pistol' ? -150 : 0) + (W.cls === 'sg' ? -60 : 0);
};
const VIEW = { pistol: 50, smg: 80, ar: 150, lmg: 160, dmr: 240, sr: 320, sg: 45 };

export class Bot {
  constructor(host, P, rng) {
    this.h = host; this.p = P; this.rng = rng;
    this.body = newBody();
    this.skill = clamp(host.settings.botSkill * (0.85 + rng() * 0.3), 0.4, 1.3);
    this.mode = 'plane';
    this.wid = null; this.W2 = null; this.mag = 0; this.ammo = 0; this.reload = 0; this.cd = 0; this.flT = 0;
    this.meds = 0; this.nades = 0; this.healing = 0; this.nadeCd = 5;
    this.target = null; this.targetT = 0; this.senseT = rng() * 0.3; this.seeT = 0;
    this.goal = null; this.goalLoot = null; this.repath = 0; this.strafe = 1; this.strafeT = 0; this.stuckT = 0; this.lastX = 0; this.lastZ = 0; this.lastChk = 0;
    this.crouch = false; this.t = 0;
    // יעד נחיתה
    const towns = host.world.towns;
    const T = weighted(rng, towns.map((t) => [t, 1 + t.tier * 1.4]));
    const a = rng() * Math.PI * 2, r = rng() * T.r * 0.6;
    this.land = { x: T.x + Math.cos(a) * r, z: T.z + Math.sin(a) * r };
    // זמן קפיצה: כשהמטוס קרוב מספיק ליעד
    const tl = host.tl, D = rand(rng, 150, 520);
    let jt = null, best = 1e9, bt = 3;
    for (let t = 2; t < tl.planeDur; t += 0.5) {
      const p = tl.plane(t), d = Math.hypot(p.x - this.land.x, p.z - this.land.z);
      if (d < best) { best = d; bt = t; }
      if (jt === null && d < D && Math.hypot(p.x, p.z) < 760) jt = t;
    }
    this.jumpT = jt ?? bt;
    P.pst = 1;
  }

  setWeapon(id) {
    this.wid = id;
    const W = WEAPONS[id];
    this.W2 = { ...W, sp: W.sp * (1.6 / this.skill) };
    this.mag = W.mag; this.reload = 0;
    this.ammo = Math.max(this.ammo, W.mag * 2);
  }

  update(dt, plane) {
    const P = this.p, b = this.body, w = this.h.world;
    this.t += dt;
    this.flT = Math.max(0, this.flT - dt);
    if (this.mode === 'plane') {
      P.pst = 1; P.x = plane.x; P.y = plane.y; P.z = plane.z;
      b.x = P.x; b.y = P.y; b.z = P.z;
      if (this.h.t >= this.jumpT || plane.gone) { this.mode = 'fall'; P.pst = 2; b.vx = plane.dx * 14; b.vz = plane.dz * 14; }
      return;
    }
    if (this.mode === 'fall') {
      const gh = Math.max(w.heightAt(b.x, b.z), MAP.waterFloor);
      const agl = b.y - gh;
      const chute = agl < PLANE.deployAlt + 20;
      P.pst = chute ? 3 : 2;
      const dx = this.land.x - b.x, dz = this.land.z - b.z, d = Math.hypot(dx, dz) || 1;
      const sp = chute ? PLANE.chuteGlide : 30;
      const f = Math.min(1, d / 12);
      b.x += (dx / d) * sp * f * dt; b.z += (dz / d) * sp * f * dt;
      b.y -= (chute ? PLANE.chuteFall : PLANE.freefall) * dt;
      b.yaw = Math.atan2(-dx, -dz); b.pitch = chute ? 0 : -0.9;
      if (b.y <= gh + 0.1) {
        b.y = gh + 0.1; b.vx = b.vy = b.vz = 0; b.onGround = false;
        this.mode = 'ground'; P.pst = 0; this.t = 0;
        this.lootUntil = 55 + this.rng() * 50;
      }
      this.sync();
      return;
    }
    this.think(dt);
    this.sync();
  }

  sync() {
    const P = this.p, b = this.body;
    P.x = b.x; P.y = b.y; P.z = b.z; P.yaw = b.yaw; P.pitch = b.pitch; P.stance = b.stance;
    P.wid = this.wid;
    P.fl = ((Math.hypot(b.vx, b.vz) > 0.5) ? FL.MOVING : 0) | (this.flT > 0 ? FL.FIRE : 0) | (this.reload > 0 ? FL.RELOAD : 0);
  }

  eye() { const b = this.body; return { x: b.x, y: b.y + PHYS.eye[b.stance] - 0.05, z: b.z }; }

  // ---------- חשיבה ----------
  think(dt) {
    const P = this.p, b = this.body, h = this.h, w = h.world;
    this.cd -= dt;
    if (this.reload > 0) {
      this.reload -= dt;
      if (this.reload <= 0) { const W = WEAPONS[this.wid]; const need = Math.min(W.mag - this.mag, this.ammo); this.mag += need; this.ammo -= need; }
    }
    this.senseT -= dt;
    if (this.senseT <= 0) { this.senseT = 0.22 + this.rng() * 0.12; this.sense(); }
    if (this.target && !this.target.alive) this.target = null;

    // ריפוי כשהכל שקט
    if (this.healing > 0) {
      this.healing -= dt;
      if (this.target) this.healing = 0;
      else if (this.healing <= 0) { this.meds--; h.onMed(P, { m: 'aid' }); }
      else { b.vx *= 0.5; b.vz *= 0.5; stepWalk(b, { f: 0, s: 0, stance: 1 }, dt, w); return; }
    } else if (!this.target && P.hp < 50 && this.meds > 0) this.healing = 4.5;
    if (!this.target) this.reloadIfNeeded();

    let inp;
    if (this.target && this.wid) inp = this.combat(dt);
    else inp = this.roam(dt);
    stepWalk(b, inp, dt, w);
    // תקיעה
    this.lastChk += dt;
    if (this.lastChk > 0.7) {
      const moved = Math.hypot(b.x - this.lastX, b.z - this.lastZ);
      if (inp.f !== 0 && moved < 0.5) { this.stuckT = 0.9; this.strafe = Math.random() < 0.5 ? -1 : 1; this.repath = 0; }
      this.lastX = b.x; this.lastZ = b.z; this.lastChk = 0;
    }
    if (this.stuckT > 0) this.stuckT -= dt;
  }

  reloadIfNeeded() {
    if (!this.wid || this.reload > 0) return;
    const W = WEAPONS[this.wid];
    if (this.mag < W.mag * 0.5 && this.ammo > 0) this.reload = W.rl;
  }

  sense() {
    const P = this.p, h = this.h, w = h.world, b = this.body;
    const range = this.wid ? (VIEW[WEAPONS[this.wid].cls] || 100) : 40;
    const eye = this.eye();
    let best = null, bd = 1e9;
    for (const V of h.players.values()) {
      if (V === P || !V.alive || V.gone || V.pst !== 0) continue;
      const dx = V.x - b.x, dz = V.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d > range * 1.15 || d >= bd) continue;
      // שדה ראייה רחב; שמיעה קרובה
      const ang = Math.abs(angleDiff(b.yaw, Math.atan2(-dx, -dz)));
      if (ang > 1.9 && d > 14 && this.target !== V) continue;
      const ty = V.y + (V.stance === 2 ? 0.4 : V.stance === 1 ? 1.0 : 1.4);
      if (!w.los(eye.x, eye.y, eye.z, V.x, ty, V.z)) continue;
      best = V; bd = d;
    }
    if (best) { this.target = best; this.targetT = 3.5; this.seeT = 0.3; }
    else if (this.target) {
      this.targetT -= 0.25;
      if (this.targetT <= 0) this.target = null;
    }
    if (this.seeT > 0) this.seeT -= 0.25;
  }

  combat(dt) {
    const b = this.body, V = this.target, W = WEAPONS[this.wid], h = this.h;
    const eye = this.eye();
    const aimY = V.y + (V.stance === 2 ? 0.35 : V.stance === 1 ? 0.95 : (this.rng() < 0.002 ? 1.62 : 1.3));
    const dx = V.x - b.x, dz = V.z - b.z, dy = aimY - eye.y;
    const hd = Math.hypot(dx, dz) || 0.01;
    const wy = Math.atan2(-dx, -dz), wp = Math.atan2(dy, hd);
    const rate = 4.2 * this.skill;
    b.yaw += clamp(angleDiff(b.yaw, wy), -rate * dt, rate * dt);
    b.pitch += clamp(wp - b.pitch, -rate * dt, rate * dt);
    const err = Math.abs(angleDiff(b.yaw, wy)) + Math.abs(wp - b.pitch);
    // טווח אידיאלי
    const ideal = { pistol: 18, smg: 22, ar: 45, lmg: 55, dmr: 85, sr: 130, sg: 8 }[W.cls] || 40;
    let f = 0;
    if (hd > ideal * 1.4) f = 1; else if (hd < ideal * 0.5) f = -1;
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafe = Math.random() < 0.5 ? -1 : 1; this.strafeT = 0.8 + Math.random() * 1.6; if (Math.random() < 0.25) this.crouch = !this.crouch; }
    // ירי
    const canSee = this.seeT > -0.2 && h.world.los(eye.x, eye.y, eye.z, V.x, aimY, V.z);
    if (this.mag <= 0 && this.reload <= 0 && this.ammo > 0) this.reload = W.rl;
    if (canSee) {
      this.seeT = 0.3;
      if (err < 0.05 + hd * 0.0006 && this.cd <= 0 && this.mag > 0 && this.reload <= 0) {
        const pitch = b.pitch, yaw = b.yaw;
        const ux = -Math.sin(yaw) * Math.cos(pitch), uy = Math.sin(pitch), uz = -Math.cos(yaw) * Math.cos(pitch);
        h.botShoot(this, this.W2, this.wid, eye.x, eye.y, eye.z, ux, uy, uz);
        this.mag--; this.flT = 0.15;
        const cyc = 60 / W.rpm;
        this.cd = W.auto ? cyc : Math.max(cyc, 0.22 + Math.random() * 0.25 / this.skill);
        if (W.bolt) this.cd = 60 / W.rpm + 0.2;
      }
      // רימון
      this.nadeCd -= dt;
      if (this.nades > 0 && this.nadeCd <= 0 && hd > 9 && hd < 26) {
        this.nadeCd = 9 + Math.random() * 6;
        this.nades--;
        const v = Math.sqrt(hd * 17) * 1.02, ca = Math.SQRT1_2;
        h.addGrenade(this.p, 'frag', eye.x, eye.y - 0.1, eye.z, (dx / hd) * v * ca, v * ca, (dz / hd) * v * ca, 2.6, false);
      }
    }
    return { f, s: this.strafe * (hd < ideal * 2.2 ? 1 : 0.2), sprint: false, jump: Math.random() < 0.004, stance: this.crouch && hd > 25 ? 1 : 0, mul: 0.92 };
  }

  roam(dt) {
    const b = this.body, h = this.h, w = h.world, P = this.p;
    this.repath -= dt;
    const Z = h.tl.zone(h.t);
    const dz0 = Math.hypot(b.x - Z.cx, b.z - Z.cz);
    const dzt = Math.hypot(b.x - Z.tcx, b.z - Z.tcz);
    const outside = dz0 > Z.r - 30 || (Z.mode !== 'pre' && dzt > Z.tr - 25 && Z.left < 50 + Z.tr * 0.2);
    // יעד
    if (this.repath <= 0 || !this.goal) {
      this.repath = 4 + Math.random() * 4;
      this.goalLoot = null;
      if (outside && h.t > 60) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * Z.tr * 0.7;
        this.goal = { x: Z.tcx + Math.cos(a) * r, z: Z.tcz + Math.sin(a) * r, run: true };
      } else {
        const L = this.findLoot(95);
        if (L) { this.goalLoot = L; this.goal = { x: L.x, z: L.z, run: false }; }
        else if (this.t < (this.lootUntil || 60)) {
          const T = this.nearTown();
          this.goal = { x: T.x + (Math.random() - 0.5) * T.r * 1.2, z: T.z + (Math.random() - 0.5) * T.r * 1.2, run: false };
        } else {
          const a = Math.random() * Math.PI * 2, r = Math.random() * Math.max(10, Z.tr * 0.8);
          this.goal = { x: Z.tcx + Math.cos(a) * r, z: Z.tcz + Math.sin(a) * r, run: false };
        }
        if (w.heightAt(this.goal.x, this.goal.z) < 0.4) this.repath = 0.2;
      }
    }
    const dx = this.goal.x - b.x, dz = this.goal.z - b.z, d = Math.hypot(dx, dz);
    // איסוף
    if (this.goalLoot) {
      const L = this.goalLoot;
      if (!w.loot.has(L.id)) { this.goalLoot = null; this.repath = 0; }
      else if (d < 1.6 && Math.abs(L.y - b.y) < 2.4) { this.take(L); this.goalLoot = null; this.repath = 0.1; }
    }
    if (d < 3 && !this.goalLoot) this.repath = Math.min(this.repath, 0.3);
    const want = Math.atan2(-dx, -dz);
    const rate = 4.0;
    b.yaw += clamp(angleDiff(b.yaw, want), -rate * dt, rate * dt);
    b.pitch += (0 - b.pitch) * Math.min(1, 4 * dt);
    const stuck = this.stuckT > 0;
    return { f: d > 0.6 ? 1 : 0, s: stuck ? this.strafe : 0, sprint: this.goal.run || d > 35, jump: stuck && Math.random() < 0.15, stance: 0, mul: 1 };
  }

  nearTown() {
    const h = this.h, b = this.body;
    let best = null, bd = 1e9;
    for (const t of h.world.towns) {
      const d = Math.hypot(t.x - b.x, t.z - b.z) + Math.random() * 180;
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  want(L) {
    const [a, id] = L.k.split(':');
    const P = this.p;
    if (a === 'w') return !this.wid ? true : wScore(id) > wScore(this.wid) + 25;
    if (a === 'a') return !!this.wid && AMMO[id] && id === WEAPONS[this.wid].ammo && this.ammo < 180;
    if (a === 'm') return id === 'aid' || id === 'kit' || id === 'band';
    if (a === 't') return id === 'frag' && this.nades < 4;
    if (L.k[0] === 'h') return +L.k[1] > P.helm.l;
    if (L.k[0] === 'v') return +L.k[1] > P.vest.l;
    if (L.k[0] === 'p') return +L.k[1] > P.pack;
    return false;
  }

  findLoot(range) {
    const w = this.h.world, b = this.body;
    let best = null, bd = range;
    for (const L of w.loot.values()) {
      const dx = L.x - b.x; if (dx > bd || dx < -bd) continue;
      const dz = L.z - b.z; if (dz > bd || dz < -bd) continue;
      const d = Math.hypot(dx, dz);
      if (d >= bd || Math.abs(L.y - b.y) > 7) continue;
      if (!this.want(L)) continue;
      best = L; bd = d;
    }
    return best;
  }

  take(L) {
    const h = this.h, P = this.p;
    if (!h.removeLoot(L.id)) return;
    const [a, id] = L.k.split(':');
    if (a === 'w') {
      if (this.wid) h.spawnLootNear([{ k: 'w:' + this.wid, c: 1 }], this.body.x, this.body.y + 0.05, this.body.z);
      this.setWeapon(id);
    } else if (a === 'a') this.ammo += L.c;
    else if (a === 'm') this.meds += id === 'band' ? 0.4 * L.c : L.c;
    else if (a === 't') this.nades += L.c;
    else if (L.k[0] === 'h') { P.helm = { l: +L.k[1], d: HELMET[+L.k[1]].dur }; P.dirty = true; }
    else if (L.k[0] === 'v') { P.vest = { l: +L.k[1], d: VEST[+L.k[1]].dur }; P.dirty = true; }
    else if (L.k[0] === 'p') P.pack = +L.k[1];
  }

  dropAll() {
    const P = this.p, items = [];
    if (this.wid) items.push({ k: 'w:' + this.wid, c: 1 }, { k: 'a:' + WEAPONS[this.wid].ammo, c: Math.max(10, this.ammo + this.mag | 0) });
    if (P.helm.l && P.helm.d > 0) items.push({ k: 'h' + P.helm.l, c: 1 });
    if (P.vest.l && P.vest.d > 0) items.push({ k: 'v' + P.vest.l, c: 1 });
    if (P.pack) items.push({ k: 'p' + P.pack, c: 1 });
    if (this.meds >= 1) items.push({ k: 'm:aid', c: Math.floor(this.meds) });
    if (this.nades > 0) items.push({ k: 't:frag', c: this.nades });
    this.h.spawnLootNear(items, this.body.x, this.body.y + 0.1, this.body.z);
  }
}
