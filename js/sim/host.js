// ה-host: מנהל החדר, הסמכות של המשחק (נזק, לוט, אזור, מטוס, אספקות, רימונים) והבוטים.
// הקוד לא תלוי ב-three וב-DOM. התקשורת עוברת דרך אובייקט io שמסופק מבחוץ.
import { World } from './worldgen.js';
import { Timeline, stepProjectile } from './match.js';
import { newBody, stepWalk, packSnapshot, unpackState } from './player.js';
import { rayPlayer, calcDamage, bodyCenter } from './hit.js';
import { airdropContents } from './loot.js';
import { Bot } from './bots.js';
import { sanitizeLook, randomLook } from './look.js';
import { mulberry32, rand, hash2 } from './util.js';
import { HELMET, VEST, PACK, MEDS, THROWS, WEAPONS, PLANE, ZONE_T0, MAX_PLAYERS, COLORS, itemInfo } from './data.js';

export const DEFAULT_SETTINGS = { maxPlayers: 50, bots: 20, speed: 1, view: 'both', botSkill: 1, time: 'day', fog: 0 };

const BOT_NAMES = ['Ace', 'Viper', 'Rogue', 'Nova', 'Titan', 'Ghost', 'Blaze', 'Echo', 'Falcon', 'Hunter', 'Jester', 'Kodiak', 'Lynx', 'Maverick', 'Nomad', 'Onyx', 'Phantom', 'Raven', 'Saber', 'Tango', 'Vandal', 'Wolf', 'Zephyr', 'Cobra', 'Dagger', 'Eagle', 'Frost', 'Gator', 'Havoc', 'Iron', 'Jinx', 'Kilo', 'Mamba', 'Ninja', 'Orca', 'Pixel', 'Quake', 'Rhino', 'Storm', 'Tiger', 'Ultra', 'Venom', 'Warden', 'Xeno', 'Yeti', 'Zulu', 'Bravo', 'Delta', 'Omega'];

export class Host {
  // io: {all(msg, exceptIdx), one(idx, msg), bin(idx, buf)}
  constructor(io, hostName = 'Host', hostLook = null) {
    this.io = io;
    this.settings = { ...DEFAULT_SETTINGS };
    this.state = 'lobby'; // lobby | loading | playing | ended
    this.players = new Map();
    this.nextIdx = 0;
    this.t = 0;
    this.world = null;
    this.tl = null;
    this.grenades = [];
    this.fires = [];
    this.drops = [];
    this.nextGrenade = 1;
    this.acc = { snap: 0, hp: 0, sec: 0 };
    this.snapTick = 0;
    this.nextLootId = 0;
    this.hostIdx = this.addHuman(hostName, true, hostLook);
  }

  // ---------- חדר ----------
  addHuman(name, silent = false, lk = null) {
    if (this.state !== 'lobby') return -1;
    if (this.humans().length >= this.settings.maxPlayers) return -1;
    let idx = 0; while (this.players.has(idx)) idx++;
    const P = this.makePlayer(idx, String(name || 'Player').slice(0, 14), false, lk);
    this.players.set(idx, P);
    if (!silent) this.broadcastLobby();
    return idx;
  }
  removeHuman(idx) {
    const P = this.players.get(idx);
    if (!P) return;
    if (this.state === 'lobby') { this.players.delete(idx); this.broadcastLobby(); return; }
    if (P.alive) { P.left = true; this.kill(P, null, 'left', null); }
    P.gone = true;
  }
  humans() { return [...this.players.values()].filter((p) => !p.bot && !p.gone); }
  makePlayer(idx, name, bot, lk) {
    return {
      idx, n: name, c: COLORS[idx % COLORS.length], lk: bot ? randomLook() : sanitizeLook(lk), bot, alive: true, left: false, gone: false, ready: false,
      hp: 100, boost: 0, helm: { l: 0, d: 0 }, vest: { l: 0, d: 0 }, pack: 0,
      x: 0, y: 300, z: 0, yaw: 0, pitch: 0, stance: 0, fl: 0, wid: null, pst: 1,
      kills: 0, place: 0, dirty: true, lastSnap: 0, dmgDealt: 0, survived: 0,
    };
  }
  lobbyInfo() {
    return {
      t: 'lobby', s: this.settings,
      players: [...this.players.values()].filter((p) => !p.gone).map((p) => ({ i: p.idx, n: p.n, c: p.c, k: p.lk, h: p.idx === this.hostIdx })),
    };
  }
  broadcastLobby() { this.io.all(this.lobbyInfo()); }
  setSettings(s) {
    if (this.state !== 'lobby') return;
    const o = this.settings;
    o.maxPlayers = Math.max(2, Math.min(MAX_PLAYERS, s.maxPlayers | 0 || o.maxPlayers));
    o.bots = Math.max(0, Math.min(MAX_PLAYERS - 1, s.bots ?? o.bots));
    o.speed = [1, 1.5, 2, 3].includes(+s.speed) ? +s.speed : o.speed;
    o.view = ['both', 'fpp', 'tpp'].includes(s.view) ? s.view : o.view;
    o.botSkill = [0.6, 0.85, 1.1].includes(+s.botSkill) ? +s.botSkill : o.botSkill;
    o.time = ['day', 'dusk', 'night'].includes(s.time) ? s.time : o.time;
    o.fog = [0, 1].includes(+s.fog) ? +s.fog : o.fog;
    this.broadcastLobby();
  }

  resetToLobby() {
    for (const [i, p] of [...this.players]) { if (p.bot || p.gone) this.players.delete(i); }
    for (const p of this.players.values()) Object.assign(p, this.makePlayer(p.idx, p.n, false, p.lk));
    this.grenades = []; this.fires = []; this.drops = []; this.t = 0; this.noHumanT = 0; this.state = 'lobby'; this.world = null; this.tl = null;
    this.broadcastLobby();
  }

  // ---------- התחלת משחק ----------
  startMatch(seed) {
    if (this.state !== 'lobby') return;
    this.seed = (seed ?? (Math.random() * 0xffffffff)) | 0;
    this.world = new World(this.seed);
    this.nextLootId = this.world.nextLootId + 1000;
    this.tl = new Timeline(this.seed, this.settings.speed);
    const humans = this.humans();
    const nb = Math.max(0, Math.min(this.settings.bots, this.settings.maxPlayers - humans.length));
    const rng = mulberry32(this.seed ^ 0x77);
    for (let i = 0; i < nb; i++) {
      let idx = 0; while (this.players.has(idx)) idx++;
      const P = this.makePlayer(idx, BOT_NAMES[i % BOT_NAMES.length] + (i >= BOT_NAMES.length ? i : ''), true);
      this.players.set(idx, P);
      P.ai = new Bot(this, P, rng);
    }
    for (const P of this.players.values()) { P.ready = P.bot; P.pst = 1; } // גם המנהל מאשר 'ready' רק אחרי שהמפה שלו נבנתה
    this.state = 'loading';
    this.loadT = 0;
    this.io.all({
      t: 'start', seed: this.seed, s: this.settings,
      players: [...this.players.values()].map((p) => ({ i: p.idx, n: p.n, c: p.c, k: p.lk, b: p.bot ? 1 : 0 })),
    });
  }

  go() {
    this.state = 'playing';
    this.t = 0;
    this.alive0 = [...this.players.values()].filter((p) => !p.gone).length;
    this.io.all({ t: 'go' });
    // תזמון חבילות אספקה
    const sp = this.settings.speed;
    this.dropTimes = [];
    for (let k = 0; k < 6; k++) this.dropTimes.push(ZONE_T0 + 35 / sp + k * 105 / sp);
    this.dropIdx = 0;
  }

  // ---------- עדכון ----------
  update(dt) {
    if (this.state === 'loading') {
      this.loadT += dt;
      const allReady = [...this.players.values()].every((p) => p.ready || p.gone);
      if (allReady || this.loadT > 40) this.go();
      return;
    }
    if (this.state !== 'playing' && this.state !== 'ended') return;
    if (this.state === 'ended') return;
    this.t += dt;
    const plane = this.tl.plane(this.t);
    // מטוס: כל מי שעדיין בו ומחוץ לאי נזרק
    for (const P of this.players.values()) {
      if (!P.alive || P.gone) continue;
      P.survived = this.t;
      if (P.bot) P.ai.update(dt, plane);
      else if (P.pst === 1) { // במטוס
        P.x = plane.x; P.z = plane.z; P.y = plane.y;
      }
    }
    // גרנדות
    this.updateGrenades(dt);
    this.updateFires(dt);
    this.updateDrops();
    // כל שנייה: אזור וריפוי
    this.acc.sec += dt;
    while (this.acc.sec >= 1) {
      this.acc.sec -= 1;
      this.secondTick();
    }
    this.acc.hp += dt;
    if (this.acc.hp >= 0.25) { this.acc.hp = 0; this.sendHp(); }
    this.acc.snap += dt;
    if (this.acc.snap >= 0.1) { this.acc.snap -= 0.1; this.sendSnapshots(); }
    this.checkEnd();
  }

  secondTick() {
    for (const P of this.players.values()) {
      if (!P.alive || P.gone) continue;
      // אזור
      if (P.pst === 0) {
        const dps = this.tl.zoneDps(this.t, P.x, P.z);
        if (dps > 0) this.damage(P, dps, 'z', null, 'zone', true);
      }
      if (!P.alive) continue;
      if (P.pst === 0 && P.y < -1.3 && this.world.heightAt(P.x, P.z) < -2.5) this.damage(P, 3, 'z', null, 'drown', true);
      if (!P.alive) continue;
      // בוסט
      if (P.boost > 0) {
        P.boost = Math.max(0, P.boost - 1.1);
        if (P.hp < 100) P.hp = Math.min(100, P.hp + 0.8 + P.boost * 0.012);
        P.dirty = true;
      }
    }
  }

  // ---------- נזק ----------
  // d=נזק גולמי; z: 'h' ראש, 'b' גוף, 'l' גפיים, 'z' אזור, 'x' פיצוץ (ללא שריון)
  damage(V, d, z, K, wid, silent = false) {
    if (!V.alive || d <= 0) return;
    if (z === 'h' && V.helm.l > 0) {
      const H = HELMET[V.helm.l];
      const ab = d * H.red;
      V.helm.d -= ab; d -= ab;
      if (V.helm.d <= 0) { V.helm.l = 0; V.helm.d = 0; }
    } else if (z === 'b' && V.vest.l > 0) {
      const Vs = VEST[V.vest.l];
      const red = V.vest.d > 0 ? Vs.red : 0.2;
      const ab = d * red;
      V.vest.d = Math.max(0, V.vest.d - ab); d -= ab;
    }
    V.hp -= d;
    V.dirty = true;
    if (K) K.dmgDealt += d;
    if (!silent || z !== 'z') this.io.all({ t: 'hit', v: V.idx, z, k: K ? K.idx : -1, x: V.x, y: V.y, zz: V.z });
    if (V.hp <= 0) { V.hp = 0; this.kill(V, K, wid, z); }
  }

  kill(V, K, wid, zone) {
    if (!V.alive) return;
    V.alive = false;
    V.place = this.aliveCount() + 1;
    V.hp = 0; V.dirty = true;
    if (K && K !== V) K.kills++;
    this.io.all({ t: 'dead', v: V.idx, k: K ? K.idx : -1, w: wid || '', z: zone || '', pl: V.place, kc: K ? K.kills : 0 });
    // בוטים משליכים את הציוד שלהם
    if (V.bot && V.ai) V.ai.dropAll();
    // בני אדם: הלקוח שלהם שולח drop לכל הפריטים
  }

  aliveCount() { let n = 0; for (const p of this.players.values()) if (p.alive && !p.gone) n++; return n; }

  checkEnd() {
    if (this.t < 8) return;
    const alive = [...this.players.values()].filter((p) => p.alive && !p.gone);
    const humansAlive = alive.filter((p) => !p.bot).length;
    if (alive.length <= 1 || (humansAlive === 0 && (this.noHumanT = (this.noHumanT || 0) + 1 / 60) > 25)) {
      this.endMatch(alive[0] || null);
    }
  }
  endMatch(winner) {
    if (this.state === 'ended') return;
    if (winner) { winner.place = 1; }
    this.state = 'ended';
    const rows = [...this.players.values()].filter((p) => !p.gone || p.place).map((p) => ({ i: p.idx, n: p.n, k: p.kills, pl: p.place || (p.alive ? 1 : 99), dm: Math.round(p.dmgDealt), b: p.bot ? 1 : 0 }));
    rows.sort((a, b) => a.pl - b.pl);
    this.io.all({ t: 'end', win: winner ? winner.idx : -1, rows });
  }

  // ---------- הודעות מהלקוחות ----------
  onMessage(idx, m) {
    const P = this.players.get(idx);
    if (!P || P.gone) return;
    if (m instanceof ArrayBuffer) {
      if (new Uint8Array(m)[0] === 2) this.onState(P, unpackState(m));
      return;
    }
    switch (m.t) {
      case 'ready': P.ready = true; break;
      case 'look': if (this.state === 'lobby') { P.lk = sanitizeLook(m.lk); this.broadcastLobby(); } break;
      case 'hit': this.onHit(P, m); break;
      case 'fire': this.io.all({ t: 'fire', i: idx, o: m.o, e: m.e, w: m.w, k: m.k }, idx); break;
      case 'pick': this.onPick(P, m); break;
      case 'drop': this.onDrop(P, m); break;
      case 'med': this.onMed(P, m); break;
      case 'eq': this.onEq(P, m); break;
      case 'throw': this.onThrow(P, m); break;
      case 'chat': this.io.all({ t: 'chat', i: idx, m: String(m.m || '').slice(0, 140) }); break;
      default: break;
    }
  }

  onState(P, s) {
    if (!P.alive) return;
    P.x = s.x; P.y = s.y; P.z = s.z; P.yaw = s.yaw; P.pitch = s.pitch; P.stance = s.stance;
    P.fl = s.fl; P.wid = s.wid; P.pst = s.pst;
  }

  onHit(K, m) {
    if (this.state !== 'playing' || !K.alive) return;
    const V = this.players.get(m.v);
    if (!V || !V.alive || V === K || V.pst === 1) return;
    const d = Math.min(300, Math.max(0, +m.d || 0));
    if (!(d > 0)) return;
    const z = m.z === 'h' || m.z === 'l' ? m.z : 'b';
    if (Math.hypot(K.x - V.x, K.z - V.z) > 900) return;
    this.damage(V, d, z, K, m.w);
  }

  onEq(P, m) {
    if (m.h != null && m.h !== P.helm.l) P.helm = { l: m.h | 0, d: m.h ? HELMET[m.h].dur : 0 };
    if (m.v != null && m.v !== P.vest.l) P.vest = { l: m.v | 0, d: m.v ? VEST[m.v].dur : 0 };
    if (m.p != null) P.pack = m.p | 0;
    P.dirty = true;
  }

  onMed(P, m) {
    const M = MEDS[m.m];
    if (!M || !P.alive) return;
    if (M.heal && P.hp < M.cap) P.hp = Math.min(M.cap, P.hp + M.heal);
    if (M.boost) P.boost = Math.min(100, P.boost + M.boost);
    P.dirty = true;
  }

  onPick(P, m) {
    if (!P.alive) return;
    const L = this.world.loot.get(m.id);
    if (!L) { this.io.one(P.idx, { t: 'nogive', id: m.id }); return; }
    if (Math.hypot(L.x - P.x, L.z - P.z) > 8) { this.io.one(P.idx, { t: 'nogive', id: m.id }); return; }
    this.world.loot.delete(m.id);
    this.io.all({ t: 'lootrm', id: m.id });
    this.io.one(P.idx, { t: 'give', id: m.id, k: L.k, c: L.c });
  }

  onDrop(P, m) {
    if (!m.k || !(m.c > 0)) return;
    const L = this.world.addLoot(m.k, m.c | 0, +m.x, +m.y, +m.z, ++this.nextLootId);
    this.io.all({ t: 'lootadd', l: [L] });
  }

  spawnLoot(list) {
    const out = [];
    for (const it of list) out.push(this.world.addLoot(it.k, it.c, it.x, it.y, it.z, ++this.nextLootId));
    if (out.length) this.io.all({ t: 'lootadd', l: out });
  }
  removeLoot(id) {
    if (!this.world.loot.has(id)) return false;
    this.world.loot.delete(id);
    this.io.all({ t: 'lootrm', id });
    return true;
  }

  // ---------- רימונים ----------
  onThrow(P, m) {
    if (!P.alive || !THROWS[m.g]) return;
    this.addGrenade(P, m.g, m.x, m.y, m.z, m.vx, m.vy, m.vz, Math.max(0.05, Math.min(THROWS[m.g].fuse, +m.f || THROWS[m.g].fuse)));
  }
  addGrenade(P, g, x, y, z, vx, vy, vz, fuse) {
    const G = { id: this.nextGrenade++, g, by: P.idx, x, y, z, vx, vy, vz, left: fuse, rest: false };
    this.grenades.push(G);
    this.io.all({ t: 'thr', id: G.id, g, by: P.idx, x, y, z, vx, vy, vz, f: fuse });
  }
  updateGrenades(dt) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const G = this.grenades[i];
      stepProjectile(G, dt, this.world);
      G.left -= dt;
      if (G.left <= 0) {
        this.grenades.splice(i, 1);
        this.explode(G);
      }
    }
  }
  explode(G) {
    const T = THROWS[G.g];
    this.io.all({ t: 'boom', id: G.id, g: G.g, x: G.x, y: G.y, z: G.z });
    const K = this.players.get(G.by) || null;
    if (G.g === 'frag') {
      for (const V of this.players.values()) {
        if (!V.alive || V.pst === 1) continue;
        const c = bodyCenter(V);
        const d = Math.hypot(c.x - G.x, c.y - G.y, c.z - G.z);
        if (d > T.radius) continue;
        const L = Math.max(0.01, d);
        const blocked = d > 0.8 && this.world.raycast(G.x, G.y + 0.3, G.z, (c.x - G.x) / L, (c.y - G.y - 0.3) / L, (c.z - G.z) / L, L - 0.2);
        if (blocked) continue;
        const dmg = T.dmg * Math.pow(1 - d / T.radius, 1.3);
        if (dmg > 1) this.damage(V, dmg, 'x', K, 'frag');
      }
    } else if (G.g === 'molo') {
      this.fires.push({ x: G.x, y: G.y, z: G.z, r: T.radius, until: this.t + T.dur, by: G.by, acc: 0 });
    }
  }
  updateFires(dt) {
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const F = this.fires[i];
      if (this.t > F.until) { this.fires.splice(i, 1); continue; }
      F.acc += dt;
      if (F.acc < 0.5) continue;
      F.acc -= 0.5;
      const K = this.players.get(F.by) || null;
      for (const V of this.players.values()) {
        if (!V.alive || V.pst === 1) continue;
        if (Math.hypot(V.x - F.x, V.z - F.z) < F.r && Math.abs(V.y - F.y) < 2.5) this.damage(V, THROWS.molo.dps * 0.5, 'x', K, 'molo', true);
      }
    }
  }

  // ---------- חבילות אספקה ----------
  updateDrops() {
    if (this.dropIdx < this.dropTimes.length && this.t >= this.dropTimes[this.dropIdx]) {
      this.dropIdx++;
      const Z = this.tl.zone(this.t);
      const rng = mulberry32((this.seed + this.dropIdx * 7919) | 0);
      let x = 0, z = 0;
      for (let k = 0; k < 40; k++) {
        const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * Math.max(20, Z.tr * 0.8);
        x = Z.tcx + Math.cos(a) * r; z = Z.tcz + Math.sin(a) * r;
        if (this.world.heightAt(x, z) > 2) break;
      }
      const gy = this.world.heightAt(x, z);
      const fall = (PLANE.alt - gy) / 7;
      const D = { id: this.dropIdx, x, z, y: gy, t0: this.t, land: this.t + fall, spawned: false };
      this.drops.push(D);
      this.io.all({ t: 'air', id: D.id, x, z, t0: D.t0, fall });
    }
    for (const D of this.drops) {
      if (!D.spawned && this.t >= D.land) {
        D.spawned = true;
        const rng = mulberry32((this.seed ^ (D.id * 104729)) | 0);
        const items = airdropContents(rng).map((it, i, arr) => {
          const a = (i / arr.length) * Math.PI * 2;
          return { k: it.k, c: it.c, x: D.x + Math.cos(a) * 1.8, y: D.y + 0.25, z: D.z + Math.sin(a) * 1.8 };
        });
        this.spawnLoot(items);
      }
    }
  }

  // ---------- שליחת מצב ----------
  sendHp() {
    for (const P of this.players.values()) {
      if (!P.dirty || P.bot || P.gone) continue;
      P.dirty = false;
      this.io.one(P.idx, { t: 'hp', hp: Math.round(P.hp * 10) / 10, b: Math.round(P.boost), hl: P.helm.l, hd: Math.round(P.helm.d), vl: P.vest.l, vd: Math.round(P.vest.d) });
    }
    for (const P of this.players.values()) P.dirty = false;
  }

  sendSnapshots() {
    this.snapTick++;
    const list = [];
    for (const P of this.players.values()) if (P.alive && !P.gone) list.push(P);
    const alive = list.length;
    const rec = (P) => ({ idx: P.idx, x: P.x, y: P.y, z: P.z, yaw: P.yaw, pitch: P.pitch, stance: P.stance, fl: P.fl, wid: P.wid, pst: P.pst, eh: P.helm.l, ev: P.vest.l, ep: P.pack });
    for (const R of this.players.values()) {
      if (R.bot || R.gone) continue;
      const recs = [];
      const near = R.alive && R.pst === 0;
      for (const P of list) {
        if (P === R) continue;
        if (near) {
          const d = Math.hypot(P.x - R.x, P.z - R.z);
          if (d > 700) continue;
          if (d > 260 && ((this.snapTick + P.idx) & 1)) continue;
        }
        recs.push(rec(P));
      }
      this.io.bin(R.idx, packSnapshot(this.t, alive, recs));
    }
  }

  // ---------- עזרי בוטים ----------
  spawnLootNear(list, x, y, z) {
    const out = [];
    list.forEach((it, i) => {
      const a = (i / Math.max(1, list.length)) * Math.PI * 2;
      out.push({ k: it.k, c: it.c, x: x + Math.cos(a) * 0.8, y, z: z + Math.sin(a) * 0.8 });
    });
    this.spawnLoot(out);
  }

  // ירי של בוט (hitscan על שחקנים)
  botShoot(B, W, wid, ox, oy, oz, dx, dy, dz) {
    const pellets = W.pel || 1;
    let ex = ox + dx * 40, ey = oy + dy * 40, ez = oz + dz * 40;
    for (let p = 0; p < pellets; p++) {
      const sp = (W.sp * (pellets > 1 ? 1 : 0.5)) * Math.PI / 180;
      const ax = dx + (Math.random() - 0.5) * sp * 2, ay = dy + (Math.random() - 0.5) * sp * 2, az = dz + (Math.random() - 0.5) * sp * 2;
      const L = Math.hypot(ax, ay, az), ux = ax / L, uy = ay / L, uz = az / L;
      const wall = this.world.raycast(ox, oy, oz, ux, uy, uz, W.range * 2.2);
      let maxT = wall ? wall.t : W.range * 2.2;
      let best = null, bv = null;
      for (const V of this.players.values()) {
        if (V === B.p || !V.alive || V.gone || V.pst !== 0) continue;
        if (Math.abs(V.x - ox) > maxT || Math.abs(V.z - oz) > maxT) continue;
        const h = rayPlayer(ox, oy, oz, ux, uy, uz, maxT, V);
        if (h && (!best || h.t < best.t)) { best = h; bv = V; }
      }
      const endT = best ? best.t : (wall ? wall.t : 120);
      if (p === 0) { ex = ox + ux * endT; ey = oy + uy * endT; ez = oz + uz * endT; }
      if (best) this.damage(bv, calcDamage(W, best.t, best.z), best.z, B.p, wid);
    }
    this.io.all({ t: 'fire', i: B.p.idx, o: [ox, oy, oz], e: [ex, ey, ez], w: wid });
  }
}
