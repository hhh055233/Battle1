// הלקוח של המשחק: קלט, תנועה, ירי, ציוד, רינדור, רשת. כל שחקן (כולל המנהל) מריץ מופע אחד של Game.
import * as THREE from 'three';
import { World } from './sim/worldgen.js';
import { Timeline, stepProjectile, fmtTime } from './sim/match.js';
import { newBody, stepWalk, packState, unpackSnapshot, FL } from './sim/player.js';
import { rayPlayer, calcDamage } from './sim/hit.js';
import { PHYS, MAP, WEAPONS, HELMET, VEST, PACK, MEDS, THROWS, SCOPES, AMMO, BASE_CAP, PLANE, itemInfo } from './sim/data.js';
import { clamp, lerp, angleDiff, TAU } from './sim/util.js';
import { buildWorldMesh } from './render/worldmesh.js';
import { FX } from './render/fx.js';
import { buildCharacter, buildWeapon, buildGrenade, buildPlane, buildParachute, buildAirdrop, buildLootMesh, itemRarity } from './render/models.js';
import * as A from './audio.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const DEG = Math.PI / 180;
const LOOT_SHOW = 55;

export class Game {
  // o: {renderer, canvas, hud, send(msg), isHost, hostWorld, idx, name, players:[{i,n,c,b}], seed, settings, prefs, onQuit(reason), onLobby()}
  constructor(o) {
    Object.assign(this, o);
    this.prefs = o.prefs;
    this.pl = new Map();
    for (const p of o.players) this.pl.set(p.i, { idx: p.i, n: p.n, c: p.c, bot: !!p.b, alive: true, ch: null, buf: [], lastSeen: 0, px: 0, pz: 0, sp: 0, stepAcc: 0, deadAt: 0, vis: false });
    this.keys = new Set(); this.mouse = { l: false, r: false }; this.running = false; this.started = false;
    this.mtBase = 0; this.mtStamp = performance.now(); this.aliveN = o.players.length;
    this.grenades = new Map(); this.drops = new Map(); this.lootMeshes = new Map(); this.protoCache = new Map();
    this.sendT = 0; this.stepAcc = 0; this.recoilAcc = 0; this.lastShot = -9; this.bloom = 0; this.camBob = 0; this.shake = 0;
    this.me = null; this.pending = [];
  }

  // ---------- אתחול ----------
  async init() {
    const { renderer } = this;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.prefs.fov, innerWidth / innerHeight, 0.06, 3200);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.world = this.isHost && this.hostWorld ? this.hostWorld : new World(this.seed);
    await tick();
    this.tl = new Timeline(this.seed, this.settings.speed);
    this.wm = buildWorldMesh(this.world, this.scene, renderer, { time: this.settings.time, fog: this.settings.fog, shadowSize: this.prefs.shadow || 1024 });
    this.applyShadowPref();
    await tick();
    this.fx = new FX(this.scene);
    this.hud.buildMapImage(this.world);
    // מטוס
    this.planeMesh = buildPlane(); this.scene.add(this.planeMesh);
    // דמות עצמית
    const mine = this.pl.get(this.idx);
    this.myChar = buildCharacter(mine ? mine.c : 0xd9534f); this.scene.add(this.myChar.root); this.myChar.root.visible = false;
    this.myChute = buildParachute(); this.scene.add(this.myChute); this.myChute.visible = false;
    // viewmodel
    this.vScene = new THREE.Scene(); this.vCam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.02, 10);
    this.vScene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 1.4)); const dl = new THREE.DirectionalLight(0xffffff, 2.2); dl.position.set(1, 2, 1.5); this.vScene.add(dl);
    this.vm = new THREE.Group(); this.vScene.add(this.vm); this.vmWid = null;
    this.vmFlash = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.fx.dot, color: 0xffd27a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false })); this.vmFlash.visible = false; this.vmFlash.scale.set(0.35, 0.35, 1); this.vScene.add(this.vmFlash);
    this.vmFlashT = 0; this.vmKick = 0; this.vmSwitch = 0;
    // מצב שחקן
    this.me = {
      body: newBody(0, PLANE.alt, 0), phase: 'wait', hp: 100, boost: 0, helm: { l: 0, d: 0 }, vest: { l: 0, d: 0 }, pack: 0,
      weapons: [null, null], cur: -1, items: {}, throwSel: 'frag', kills: 0, reload: 0, cd: 0, using: null, cook: null, melee: 0, stance: 0, eyeY: 1.68, boltT: 0, ads: 0, fov: this.prefs.fov, noAmmoClick: 0,
    };
    this.me.body.yaw = Math.atan2(-this.tl.dir.x, -this.tl.dir.z); this.me.body.pitch = 0;
    this.view = this.settings.view === 'tpp' ? 'tpp' : 'fpp';
    this.bind();
    this.onResize();
    this.refreshHud();
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(() => this.loop());
    const q = this.pending; this.pending = null;
    for (const m of q) this.onMessage(m); // הודעות שהגיעו בזמן הטעינה
    this.send({ t: 'ready' });
  }

  applyShadowPref() {
    const s = +this.prefs.shadow;
    this.renderer.shadowMap.enabled = s > 0;
    if (this.wm && this.wm.sun) { this.wm.sun.castShadow = s > 0; if (s > 0 && this.wm.sun.shadow.mapSize.x !== s) { this.wm.sun.shadow.mapSize.set(s, s); if (this.wm.sun.shadow.map) { this.wm.sun.shadow.map.dispose(); this.wm.sun.shadow.map = null; } } }
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }

  begin() {
    this.started = true; this.mtBase = 0; this.mtStamp = performance.now();
    this.me.phase = 'plane';
    this.hud.show(true);
    this.hud.banner('קופצים מהמטוס! לחץ F', 4500);
    this.lock();
    if (!this.locked) this.hud.toast('לחצו פעם אחת על המסך כדי להפעיל את העכבר', 7000);
    A.sndAlert();
  }
  mt() { return this.mtBase + (performance.now() - this.mtStamp) / 1000; }

  // ---------- קלט ----------
  bind() {
    this.h = {
      kd: (e) => this.onKey(e, true), ku: (e) => this.onKey(e, false),
      md: (e) => this.onMouse(e, true), mu: (e) => this.onMouse(e, false),
      mm: (e) => this.onMove(e), wh: (e) => this.onWheel(e), rs: () => this.onResize(),
      pl: () => this.onLockChange(), cm: (e) => e.preventDefault(),
      bl: () => { this.keys.clear(); this.mouse.l = this.mouse.r = false; },
    };
    addEventListener('keydown', this.h.kd); addEventListener('keyup', this.h.ku);
    addEventListener('mousedown', this.h.md); addEventListener('mouseup', this.h.mu);
    addEventListener('mousemove', this.h.mm); addEventListener('wheel', this.h.wh, { passive: true });
    addEventListener('resize', this.h.rs); addEventListener('blur', this.h.bl);
    document.addEventListener('pointerlockchange', this.h.pl); addEventListener('contextmenu', this.h.cm);
  }
  unbind() {
    removeEventListener('keydown', this.h.kd); removeEventListener('keyup', this.h.ku);
    removeEventListener('mousedown', this.h.md); removeEventListener('mouseup', this.h.mu);
    removeEventListener('mousemove', this.h.mm); removeEventListener('wheel', this.h.wh);
    removeEventListener('resize', this.h.rs); removeEventListener('blur', this.h.bl);
    document.removeEventListener('pointerlockchange', this.h.pl); removeEventListener('contextmenu', this.h.cm);
  }
  get locked() { return document.pointerLockElement === this.canvas; }
  get uiOpen() { return this.invOpen || this.mapOpen || this.pauseOpen || this.chatOpen || this.endOpen; }
  lock() { if (!this.uiOpen && !this.locked) { try { const r = this.canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* ignore */ } } }
  onLockChange() {
    if (!this.running) return;
    if (!this.locked && !this.uiOpen && this.started && !this.endOpen) this.openPause(true);
  }
  onResize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.vCam.aspect = w / h; this.vCam.updateProjectionMatrix();
  }

  onKey(e, down) {
    if (this.chatOpen) {
      if (down && e.code === 'Enter') { const v = this.hud.el['chat-in'].value.trim(); if (v) this.send({ t: 'chat', m: v }); this.closeChat(); }
      else if (down && e.code === 'Escape') this.closeChat();
      return;
    }
    const k = e.code;
    if (down) {
      if (e.repeat) { if (k === 'Tab') e.preventDefault(); return; }
      this.keys.add(k);
      switch (k) {
        case 'Tab': e.preventDefault(); this.toggleInv(); break;
        case 'KeyM': this.toggleMap(); break;
        case 'Escape': if (this.invOpen) this.toggleInv(false); else if (this.mapOpen) this.toggleMap(false); break;
        case 'KeyY': case 'Enter': if (!this.uiOpen) { e.preventDefault(); this.openChat(); } break;
        case 'KeyV': if (this.settings.view === 'both') this.view = this.view === 'fpp' ? 'tpp' : 'fpp'; break;
      }
      if (this.uiOpen || !this.me) return;
      const M = this.me;
      switch (k) {
        case 'KeyF': this.onUseKey(); break;
        case 'KeyR': this.startReload(); break;
        case 'Digit1': this.selectSlot(0); break;
        case 'Digit2': this.selectSlot(1); break;
        case 'Digit3': this.selectSlot(2); break;
        case 'KeyX': this.toggleMode(); break;
        case 'KeyQ': this.cycleThrow(); break;
        case 'KeyH': this.quickHeal(); break;
        case 'KeyB': this.quickBoost(); break;
        case 'KeyC': if (M.phase === 'ground') M.stance = M.stance === 1 ? 0 : 1; break;
        case 'KeyZ': if (M.phase === 'ground') M.stance = M.stance === 2 ? 0 : 2; break;
        case 'KeyG': this.startCook(); break;
        case 'Space': if (M.phase === 'ground' && M.stance > 0) M.stance = 0; break;
      }
    } else {
      this.keys.delete(k);
      if (k === 'KeyG') this.releaseCook();
    }
  }
  onMouse(e, down) {
    if (!this.started) return;
    if (down && !this.locked && !this.uiOpen) { this.lock(); return; }
    if (this.uiOpen) return;
    if (e.button === 0) { this.mouse.l = down; if (down) this.fireLatch = false; if (down && this.me.phase === 'dead') this.cycleSpectate(1); }
    if (e.button === 2) this.mouse.r = down;
  }
  onMove(e) {
    if (!this.locked || this.uiOpen || !this.me) return;
    const M = this.me, b = M.body;
    const zoomK = this.zoomNow();
    const s = this.prefs.sens * 0.0006 / Math.pow(zoomK, 0.8);
    if (M.phase === 'dead') return;
    b.yaw -= e.movementX * s; b.pitch = clamp(b.pitch - e.movementY * s, -1.5, 1.5);
  }
  onWheel(e) { if (this.uiOpen || !this.me || this.me.phase !== 'ground') return; const d = e.deltaY > 0 ? 1 : -1; const order = [0, 1]; const i = order.indexOf(this.me.cur); this.selectSlot(order[(i + d + 2) % 2] ?? 0); }

  openChat() { this.chatOpen = true; document.exitPointerLock(); const c = this.hud.el['chat-in']; c.classList.remove('hidden'); c.value = ''; c.focus(); }
  closeChat() { this.chatOpen = false; this.hud.el['chat-in'].classList.add('hidden'); this.hud.el['chat-in'].blur(); this.lock(); }
  openPause(on) { this.pauseOpen = on; document.getElementById('pause').classList.toggle('hidden', !on); if (!on) this.lock(); else this.keys.clear(); }

  // ---------- משחק ----------
  loop() {
    if (!this.running) return;
    this.raf = requestAnimationFrame(() => this.loop());
    const now = performance.now();
    let dt = (now - this.last) / 1000; this.last = now;
    dt = Math.min(0.05, Math.max(0.0005, dt));
    this.t = (this.t || 0) + dt;
    if (this.started) { this.update(dt); }
    this.render(dt);
  }

  update(dt) {
    const M = this.me, b = M.body, mt = this.mt();
    this.hud.tick(dt);
    this.updateTimeline(mt, dt);
    this.updateRemote(dt, mt);
    this.updateGrenades(dt);
    this.updateDrops(mt);
    this.updateLoot(dt);
    M.cd -= dt; if (M.boltT > 0) M.boltT -= dt;
    if (M.phase === 'plane') this.updatePlane(dt, mt);
    else if (M.phase === 'fall' || M.phase === 'chute') this.updateAir(dt);
    else if (M.phase === 'ground') this.updateGround(dt, mt);
    else if (M.phase === 'dead') this.updateSpectate(dt);
    // שליחה
    this.sendT += dt;
    if (this.sendT >= 0.05 && M.phase !== 'dead' && M.phase !== 'wait') { this.sendT = 0; this.sendState(); }
    this.updateHud(dt, mt);
  }

  updateTimeline(mt, dt) {
    const Z = this.tl.zone(mt);
    this.zone = Z;
    this.fx.setZone(Z.cx, Z.cz, Z.r, Z.tcx, Z.tcz, Z.tr, Z.mode === 'wait' || Z.mode === 'shrink' || Z.mode === 'pre');
    const pl = this.tl.plane(mt);
    this.planeMesh.visible = !pl.gone;
    this.planeMesh.position.set(pl.x, pl.y, pl.z);
    this.planeMesh.rotation.y = Math.atan2(-pl.dx, -pl.dz);
    this.planeMesh.children.forEach((c) => { if (c.userData.spin) c.rotation.z += dt * 40; });
    if (!pl.gone) { const d = Math.hypot(pl.x - this.camera.position.x, pl.z - this.camera.position.z); if (this.me.phase !== 'plane' && ((this._pa = (this._pa || 0) + dt) > 0.4)) { this._pa = 0; A.sndPlane(d, 0); } }
  }

  // --- במטוס ---
  updatePlane(dt, mt) {
    const M = this.me, b = M.body, pl = this.tl.plane(mt);
    b.x = pl.x; b.y = pl.y - 2; b.z = pl.z; b.vx = b.vy = b.vz = 0;
    const out = Math.hypot(pl.x, pl.z) > 790 && Math.hypot(pl.x - pl.dx * 40, pl.z - pl.dz * 40) < Math.hypot(pl.x, pl.z);
    if (pl.gone || out) this.jump();
  }
  jump() {
    const M = this.me, b = M.body, mt = this.mt(), pl = this.tl.plane(mt);
    if (M.phase !== 'plane') return;
    M.phase = 'fall'; b.x = pl.x; b.y = pl.y - 3; b.z = pl.z; b.vx = pl.dx * 20; b.vz = pl.dz * 20; b.vy = 0;
    this.hud.banner('', 1);
    this.fallV = 0;
  }
  // --- באוויר ---
  updateAir(dt) {
    const M = this.me, b = M.body, w = this.world;
    const gh = Math.max(w.heightAt(b.x, b.z), MAP.waterFloor);
    const agl = b.y - gh;
    const dive = clamp(-b.pitch / 1.15, 0, 1);
    const fw = this.keys.has('KeyW') ? 1 : 0, bk = this.keys.has('KeyS') ? 1 : 0;
    const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
    if (M.phase === 'fall') {
      const vy = -(22 + 28 * dive + fw * 6), hs = 42 - 36 * dive + fw * 6 - bk * 8;
      this.fallV = lerp(this.fallV || 0, vy, Math.min(1, dt * 2));
      b.vx = lerp(b.vx, fx * hs, Math.min(1, dt * 2)); b.vz = lerp(b.vz, fz * hs, Math.min(1, dt * 2)); b.vy = this.fallV;
      if (agl < PLANE.deployAlt + 30) this.deploy();
      if (Math.floor(this.t * 6) % 3 === 0) A.sndWind(-this.fallV * 2.4);
    } else {
      const hs = PLANE.chuteGlide + fw * 5 - bk * 8;
      b.vx = lerp(b.vx, fx * hs, Math.min(1, dt * 1.5)); b.vz = lerp(b.vz, fz * hs, Math.min(1, dt * 1.5)); b.vy = lerp(b.vy, -PLANE.chuteFall + (this.keys.has('Space') ? 0 : 0), Math.min(1, dt * 3));
    }
    b.x += b.vx * dt; b.z += b.vz * dt; b.y += b.vy * dt;
    b.x = clamp(b.x, -1500, 1500); b.z = clamp(b.z, -1500, 1500);
    const g = w.groundAt(b.x, b.z, b.y, 0.3);
    if (b.y <= g + 0.02) {
      b.y = g; b.vx = b.vy = b.vz = 0; b.onGround = true; M.phase = 'ground'; b.pitch = 0;
      this.hud.banner('', 1); A.sndStep(0, 0, true);
      if (!this.firstLand) { this.firstLand = true; this.hud.toast('בצע לוּט! חפש נשק בבניינים'); }
    }
  }
  deploy() { const M = this.me; if (M.phase !== 'fall') return; M.phase = 'chute'; M.body.vy = Math.max(M.body.vy, -30); A.sndPick(); }

  // --- על הקרקע ---
  updateGround(dt, mt) {
    const M = this.me, b = M.body, w = this.world;
    const k = this.keys;
    const W = M.cur >= 0 && M.cur < 2 ? M.weapons[M.cur] : null, Wd = W ? WEAPONS[W.id] : null;
    const free = !this.uiOpen && this.locked;
    const f = free ? (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0) : 0, s = free ? (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) : 0;
    const ads = free && this.mouse.r && M.reload <= 0 && !!Wd && !(k.has('ShiftLeft') && f > 0);
    M.ads = lerp(M.ads, ads ? 1 : 0, Math.min(1, dt * 10));
    const sprint = free && k.has('ShiftLeft') && f > 0.3 && M.stance === 0 && !ads && !M.using;
    this.sprinting = sprint;
    let mul = (Wd ? Wd.mv : 1) * (M.using ? 0.8 : 1) * (1 - M.ads * 0.4) * (M.cook ? 0.9 : 1);
    stepWalk(b, { f, s, sprint, jump: free && k.has('Space'), stance: M.stance, mul }, dt, w);
    if (b.y < -1.4 && w.heightAt(b.x, b.z) < -2.5 && !this._wtoast) { this._wtoast = true; this.hud.toast('אתה טובע! חזור ליבשה', 2500); setTimeout(() => { this._wtoast = false; }, 3000); }
    // צעדים
    const hs = Math.hypot(b.vx, b.vz);
    if (b.onGround && hs > 1) {
      this.stepAcc += hs * dt;
      const stride = sprint ? 2.4 : 1.9;
      if (this.stepAcc > stride) { this.stepAcc = 0; A.sndStep(0, 0, sprint, w.roadMask[Math.round((b.x + MAP.half) / w.cell) + Math.round((b.z + MAP.half) / w.cell) * (w.N + 1)] ? 'road' : 'grass'); }
      this.camBob += hs * dt * 1.3;
    }
    // ירי / טעינה
    if (M.reload > 0) {
      M.reload -= dt;
      if (M.reload <= 0) this.finishReload();
    }
    this.fireUpdate(dt, W, Wd, free, sprint);
    // איסוף: הצעה
    this.updatePrompt();
    // ריפוי
    if (M.using) {
      M.using.t += dt;
      if (M.using.t >= M.using.dur) this.finishUse();
    }
    if (M.cook) { M.cook.t += dt; if (M.cook.t >= THROWS[M.cook.g].fuse - 0.02) this.releaseCook(true); }
    // זעזוע/רתע חוזר
    if (this.t - this.lastShot > 0.12 && this.recoilAcc > 0) { const r = Math.min(this.recoilAcc, dt * 0.22 * (1 + this.recoilAcc * 6)); b.pitch -= r; this.recoilAcc -= r; }
    this.bloom = Math.max(0, this.bloom - dt * 1.6);
    // גבולות
    const rr = Math.hypot(b.x, b.z); if (rr > MAP.half + 40) { b.x *= (MAP.half + 40) / rr; b.z *= (MAP.half + 40) / rr; }
  }

  weaponReserve(id) { return this.me.items['a:' + WEAPONS[id].ammo] || 0; }
  selectSlot(i) {
    const M = this.me; if (M.phase !== 'ground' || M.using) return;
    if (i === 2) { if (this.throwCount(M.throwSel) <= 0) { const any = this.firstThrow(); if (!any) return; M.throwSel = any; } M.cur = 2; }
    else if (M.weapons[i]) M.cur = i;
    else return;
    M.reload = 0; M.cook = null; this.vmSwitch = 0.3; this.refreshHud();
  }
  toggleMode() { const M = this.me, w = M.weapons[M.cur]; if (w && WEAPONS[w.id].auto) { w.mode = w.mode === 'auto' ? 'semi' : 'auto'; this.refreshHud(); } }
  startReload() {
    const M = this.me, w = M.weapons[M.cur]; if (!w || M.reload > 0 || M.phase !== 'ground') return;
    const W = WEAPONS[w.id];
    if (w.mag >= W.mag || this.weaponReserve(w.id) <= 0) return;
    M.reload = W.rl; M.reloadW = w; A.sndReload(0); setTimeout(() => A.sndReload(1), W.rl * 700);
  }
  finishReload() {
    const M = this.me, w = M.reloadW; if (!w || M.weapons[M.cur] !== w) return;
    const W = WEAPONS[w.id], key = 'a:' + W.ammo, need = W.mag - w.mag, take = Math.min(need, M.items[key] || 0);
    w.mag += take; M.items[key] = (M.items[key] || 0) - take; if (!M.items[key]) delete M.items[key];
    A.sndReload(1); this.refreshHud();
  }

  // ---------- ירי ----------
  fireUpdate(dt, W, Wd, free, sprint) {
    const M = this.me, b = M.body;
    if (!free) return;
    if (!W) { if (M.cur < 2 && this.mouse.l && M.cd <= 0 && M.cur === -1) this.punch(); return; }
    if (M.cur === 2) return;
    const wantFire = this.mouse.l && !sprint;
    if (!wantFire) { this.fireLatch = false; return; }
    const auto = Wd.auto && W.mode !== 'semi';
    if (!auto && this.fireLatch) return;
    if (M.cd > 0 || M.reload > 0 || M.boltT > 0) return;
    if (W.mag <= 0) { if (!this.fireLatch && this.weaponReserve(W.id) > 0) this.startReload(); else if (M.noAmmoClick <= 0) { A.sndReload(0); M.noAmmoClick = 0.3; } this.fireLatch = true; return; }
    this.fireLatch = true;
    this.shoot(W, Wd);
  }

  shoot(W, Wd) {
    const M = this.me, b = M.body, cam = this.camera, w = this.world;
    W.mag--; M.cd = 60 / Wd.rpm; if (Wd.bolt) M.boltT = 60 / Wd.rpm * 0.9;
    this.lastShot = this.t;
    const moving = Math.hypot(b.vx, b.vz) > 1;
    let spread = Wd.sp * (1 + this.bloom * 0.8) * (1 - M.ads * 0.45) * (moving ? 1.55 : 1) * (b.onGround ? 1 : 2.6) * (M.stance === 1 ? 0.8 : M.stance === 2 ? 0.6 : 1);
    this.bloom = Math.min(2.2, this.bloom + 0.12);
    // כיוון: מרכז המסך
    const eye = this.camera.position.clone();
    const dirBase = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const pellets = Wd.pel || 1;
    const hits = new Map();
    let firstEnd = null;
    // נקודת יציאה למראה: ליד הלוע
    const org = this.view === 'fpp' ? eye.clone().addScaledVector(dirBase, 0.9).addScaledVector(right, 0.17).addScaledVector(up, -0.11) : this.muzzleOf(this.myChar) || eye.clone();
    for (let p = 0; p < pellets; p++) {
      const ang = Math.random() * TAU, rad = Math.sqrt(Math.random()) * spread * DEG;
      const d = dirBase.clone().addScaledVector(right, Math.cos(ang) * Math.tan(rad)).addScaledVector(up, Math.sin(ang) * Math.tan(rad)).normalize();
      const res = this.traceShot(eye, d, Wd);
      if (p === 0) firstEnd = res.end;
      if (res.vic) {
        const dmg = calcDamage(Wd, res.t, res.zone);
        const h = hits.get(res.vic.idx) || { d: 0, z: res.zone };
        h.d += dmg; if (res.zone === 'h') h.z = 'h'; hits.set(res.vic.idx, h);
        this.fx.blood(res.end);
      } else if (res.hit) this.fx.impact(res.end, res.n, res.kind);
      if (pellets > 1 && p < 3) this.fx.tracer([org.x, org.y, org.z], [res.end.x, res.end.y, res.end.z], 400);
    }
    for (const [v, h] of hits) {
      this.send({ t: 'hit', v, d: Math.round(h.d * 10) / 10, z: h.z, w: W.id });
      const rp = this.pl.get(v); if (rp && rp.dmgShown !== undefined) rp.dmgShown = 0;
    }
    if (pellets === 1) this.fx.tracer([org.x, org.y, org.z], [firstEnd.x, firstEnd.y, firstEnd.z], 520);
    this.send({ t: 'fire', o: [org.x, org.y, org.z], e: [firstEnd.x, firstEnd.y, firstEnd.z], w: W.id });
    A.sndShot(Wd.cls, 0, 0);
    this.fx.muzzle(org, dirBase, Wd.cls === 'sr' ? 1.4 : 1);
    this.vmKick = 1; this.vmFlashT = 0.05;
    // רתע
    const rv = Wd.rv * DEG * (1 - M.ads * 0.25) * (M.stance === 1 ? 0.8 : M.stance === 2 ? 0.6 : 1), rh = (Math.random() - 0.5) * 2 * Wd.rh * DEG;
    b.pitch = clamp(b.pitch + rv, -1.5, 1.5); this.recoilAcc += rv; b.yaw += rh;
    this.shake = Math.max(this.shake, Wd.cls === 'sr' || Wd.cls === 'sg' ? 0.5 : 0.15);
    this.refreshAmmo();
    if (W.mag <= 0 && this.weaponReserve(W.id) > 0) setTimeout(() => { if (this.me.weapons[this.me.cur] === W) this.startReload(); }, 250);
  }

  muzzleOf(ch) {
    if (!ch || !ch.weapon) return null;
    ch.root.updateMatrixWorld(true);
    return ch.weapon.localToWorld(ch.weapon.userData.muzzle.clone());
  }

  // מחזיר {end:Vector3-like, t, vic, zone, hit, n, kind}
  traceShot(o, d, Wd) {
    const w = this.world, range = Wd.range * 3;
    const wall = w.raycast(o.x, o.y, o.z, d.x, d.y, d.z, range);
    let maxT = wall ? wall.t : range;
    let best = null, vic = null;
    for (const p of this.pl.values()) {
      if (!p.alive || !p.vis || p.pst !== 0 && p.pst !== undefined) continue;
      if (Math.abs(p.rx - o.x) > maxT + 2 || Math.abs(p.rz - o.z) > maxT + 2) continue;
      const h = rayPlayer(o.x, o.y, o.z, d.x, d.y, d.z, maxT, { x: p.rx, y: p.ry, z: p.rz, yaw: p.ryaw, stance: p.rstance });
      if (h && (!best || h.t < best.t)) { best = h; vic = p; }
    }
    if (best) { const t = best.t; return { end: new THREE.Vector3(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t), t, vic, zone: best.z, hit: true }; }
    if (wall) {
      let kind = wall.kind === 'box' ? (wall.box.m === 'glass' ? 'glass' : 'box') : (wall.y < -0.3 ? 'water' : 'terrain');
      return { end: new THREE.Vector3(wall.x, wall.y, wall.z), t: wall.t, vic: null, hit: true, n: { x: wall.nx, y: wall.ny, z: wall.nz }, kind };
    }
    return { end: new THREE.Vector3(o.x + d.x * 400, o.y + d.y * 400, o.z + d.z * 400), t: 400, vic: null, hit: false };
  }

  punch() {
    const M = this.me, cam = this.camera;
    M.cd = 0.6;
    const o = cam.position, d = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    for (const p of this.pl.values()) {
      if (!p.alive || !p.vis) continue;
      const h = rayPlayer(o.x, o.y, o.z, d.x, d.y, d.z, 1.7, { x: p.rx, y: p.ry, z: p.rz, yaw: p.ryaw, stance: p.rstance });
      if (h) { this.send({ t: 'hit', v: p.idx, d: 14, z: h.z === 'h' ? 'h' : 'b', w: 'fist' }); A.sndHit(); break; }
    }
    this.vmKick = 1;
  }

  // ---------- תרופות, רימונים ----------
  throwCount(g) { return this.me.items['t:' + g] || 0; }
  firstThrow() { for (const g of ['frag', 'smoke', 'stun', 'molo']) if (this.throwCount(g) > 0) return g; return null; }
  cycleThrow() {
    const M = this.me, order = ['frag', 'smoke', 'stun', 'molo'].filter((g) => this.throwCount(g) > 0);
    if (!order.length) return;
    const i = order.indexOf(M.throwSel); M.throwSel = order[(i + 1) % order.length];
    if (M.cur === 2) { this.vmWid = null; } this.refreshHud(); this.hud.toast(THROWS[M.throwSel].name, 1200);
  }
  startCook() {
    const M = this.me; if (M.phase !== 'ground' || M.cook || M.using || this.uiOpen) return;
    const g = this.throwCount(M.throwSel) > 0 ? M.throwSel : this.firstThrow(); if (!g) { this.hud.toast('אין רימונים'); return; }
    M.throwSel = g; M.cur = 2; M.cook = { g, t: 0 }; M.reload = 0; this.vmWid = null; A.sndPin(); this.refreshHud();
  }
  releaseCook(force) {
    const M = this.me, c = M.cook; if (!c) return;
    M.cook = null;
    const T = THROWS[c.g], cam = this.camera;
    const d = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const o = cam.position.clone().addScaledVector(d, 0.6); o.y -= 0.15;
    const v = d.clone().multiplyScalar(17); v.y += 3.5 + Math.max(0, d.y) * 3; v.x += M.body.vx * 0.5; v.z += M.body.vz * 0.5;
    M.items['t:' + c.g]--; if (M.items['t:' + c.g] <= 0) delete M.items['t:' + c.g];
    this.send({ t: 'throw', g: c.g, x: o.x, y: o.y, z: o.z, vx: v.x, vy: v.y, vz: v.z, f: Math.max(0.05, T.fuse - c.t) });
    this.myChar.throwT = 0.5; this.vmKick = 1;
    // חוזרים לנשק
    M.cur = M.weapons[0] ? 0 : M.weapons[1] ? 1 : -1; this.vmWid = null; this.refreshHud();
  }
  quickHeal() {
    const M = this.me;
    for (const id of ['band', 'aid', 'kit']) if ((M.items['m:' + id] || 0) > 0 && M.hp < MEDS[id].cap) { this.startUse(id); return; }
    this.hud.toast(M.hp >= 75 ? 'הבריאות גבוהה' : 'אין תרופות');
  }
  quickBoost() { const M = this.me; for (const id of ['drink', 'pain', 'adren']) if ((M.items['m:' + id] || 0) > 0 && M.boost < 100) { this.startUse(id); return; } this.hud.toast('אין משקאות אנרגיה'); }
  startUse(id) {
    const M = this.me, D = MEDS[id]; if (M.using || M.phase !== 'ground' || (M.items['m:' + id] || 0) <= 0) return;
    if (D.heal && M.hp >= D.cap) { this.hud.toast('הבריאות מלאה'); return; }
    M.using = { id, t: 0, dur: D.use }; M.reload = 0; M.cook = null;
  }
  finishUse() {
    const M = this.me, u = M.using; M.using = null; if (!u) return;
    const k = 'm:' + u.id; if ((M.items[k] || 0) <= 0) return;
    M.items[k]--; if (M.items[k] <= 0) delete M.items[k];
    this.send({ t: 'med', m: u.id }); A.sndHeal();
    if (this.invOpen) this.renderInv();
  }

  // ---------- לוט ואיסוף ----------
  capacity() { const M = this.me; return BASE_CAP + (M.vest.l ? VEST[M.vest.l].cap : 0) + (M.pack ? PACK[M.pack].cap : 0); }
  used() { let u = 0; for (const [k, c] of Object.entries(this.me.items)) u += itemInfo(k).w * c; return u; }
  nearestLoot(range = 2.6) {
    const b = this.me.body; let best = null, bd = range;
    for (const L of this.world.loot.values()) {
      const dx = L.x - b.x; if (dx > bd || dx < -bd) continue;
      const dz = L.z - b.z; if (dz > bd || dz < -bd) continue;
      const d = Math.hypot(dx, dz); if (d >= bd || L.y - b.y > 2.4 || b.y - L.y > 1.2) continue;
      best = L; bd = d;
    }
    return best;
  }
  canTake(L) {
    const M = this.me, i = itemInfo(L.k);
    if (i.type === 'helmet') return i.lvl > M.helm.l || M.helm.d <= 0;
    if (i.type === 'vest') return i.lvl > M.vest.l || M.vest.d <= 0;
    if (i.type === 'pack') return i.lvl > M.pack;
    if (i.type === 'weapon') return true;
    return this.capacity() - this.used() >= i.w;
  }
  updatePrompt() {
    if (this.uiOpen || this.me.phase !== 'ground') { this.hud.setPrompt(''); this.hud.setAction(this.me.using ? this.me.using.t / this.me.using.dur : this.me.cook ? 0 : null, this.me.using ? MEDS[this.me.using.id].name : ''); return; }
    const M = this.me, L = this.nearestLoot();
    this.promptLoot = L;
    if (L) {
      const i = itemInfo(L.k), ok = this.canTake(L);
      this.hud.setPrompt(`<kbd>F</kbd> ${esc(i.name)}${L.c > 1 ? ' ×' + L.c : ''}${ok ? '' : ' <small style="color:#9aa">(אין צורך / אין מקום)</small>'}`);
    } else this.hud.setPrompt('');
    this.hud.setAction(M.using ? M.using.t / M.using.dur : M.cook ? clamp(M.cook.t / THROWS[M.cook.g].fuse, 0, 1) : null, M.using ? MEDS[M.using.id].name : M.cook ? 'מבשל... ' + (THROWS[M.cook.g].fuse - M.cook.t).toFixed(1) : '');
  }
  onUseKey() {
    const M = this.me;
    if (M.phase === 'plane') { this.jump(); return; }
    if (M.phase === 'fall') { this.deploy(); return; }
    if (M.phase !== 'ground') return;
    const L = this.nearestLoot();
    if (!L) return;
    if (!this.canTake(L)) { this.hud.toast(itemInfo(L.k).type === 'helmet' || itemInfo(L.k).type === 'vest' || itemInfo(L.k).type === 'pack' ? 'יש לך ציוד טוב יותר' : 'התיק מלא'); return; }
    if (this.pendingPick === L.id && this.t - this.pendingT < 0.5) return;
    this.pendingPick = L.id; this.pendingT = this.t;
    this.send({ t: 'pick', id: L.id });
  }
  onGive(m) {
    this.pendingPick = null;
    A.sndPick();
    this.addItem(m.k, m.c);
    if (this.invOpen) this.renderInv();
  }
  groundPos() { const b = this.me.body; return { x: b.x, y: b.y + 0.05, z: b.z }; }
  dropItem(k, c, jitter = 0) {
    const g = this.groundPos(), a = Math.random() * TAU;
    this.send({ t: 'drop', k, c, x: g.x + Math.cos(a) * (0.7 + jitter), y: g.y, z: g.z + Math.sin(a) * (0.7 + jitter) });
  }
  addItem(k, c) {
    const M = this.me, i = itemInfo(k);
    switch (i.type) {
      case 'weapon': {
        const W = WEAPONS[i.id];
        let slot = M.weapons[0] ? (M.weapons[1] ? -1 : 1) : 0;
        if (slot < 0) {
          slot = M.cur === 1 ? 1 : 0;
          const old = M.weapons[slot];
          this.dropItem('w:' + old.id, 1);
          if (old.mag > 0) this.dropItem('a:' + WEAPONS[old.id].ammo, old.mag);
          if (old.scope) this.dropItem('s:' + old.scope, 1);
        }
        M.weapons[slot] = { id: i.id, mag: 0, mode: W.auto ? 'auto' : 'semi', scope: null };
        if (M.cur < 0 || M.cur === 2 || slot === M.cur || !M.weapons[M.cur]) M.cur = slot;
        this.vmWid = null; this.vmSwitch = 0.3;
        break;
      }
      case 'helmet': { const old = M.helm; M.helm = { l: i.lvl, d: HELMET[i.lvl].dur }; if (old.l && old.d > 0) this.dropItem('h' + old.l, 1); this.sendEq(); break; }
      case 'vest': { const old = M.vest; M.vest = { l: i.lvl, d: VEST[i.lvl].dur }; if (old.l && old.d > 0) this.dropItem('v' + old.l, 1); this.sendEq(); break; }
      case 'pack': { const old = M.pack; M.pack = i.lvl; if (old) this.dropItem('p' + old, 1); this.sendEq(); break; }
      case 'scope': {
        const w = M.weapons[M.cur] && WEAPONS[M.weapons[M.cur].id].cls !== 'pistol' ? M.weapons[M.cur] : (M.weapons[0] && WEAPONS[M.weapons[0].id].cls !== 'pistol' ? M.weapons[0] : null);
        if (w && (!w.scope || SCOPES[w.scope].zoom < SCOPES[i.id].zoom)) { if (w.scope) this.dropItem('s:' + w.scope, 1); w.scope = i.id; this.hud.toast(`${i.name} הותקן על ${WEAPONS[w.id].n}`); }
        else this.stackAdd(k, c, i);
        break;
      }
      default: this.stackAdd(k, c, i);
    }
    this.refreshHud();
  }
  stackAdd(k, c, i) {
    const M = this.me, free = this.capacity() - this.used();
    const n = Math.max(0, Math.min(c, Math.floor(free / i.w + 1e-6)));
    if (n > 0) M.items[k] = (M.items[k] || 0) + n;
    if (n < c) { this.dropItem(k, c - n, 0.3); if (n === 0) this.hud.toast('התיק מלא'); }
  }
  sendEq() { const M = this.me; this.send({ t: 'eq', h: M.helm.l, v: M.vest.l, p: M.pack }); }

  // ---------- הודעות מהשרת ----------
  onMessage(m) {
    if (this.pending) { if (!(m instanceof ArrayBuffer)) this.pending.push(m); return; }
    if (m instanceof ArrayBuffer) { this.onSnapshot(unpackSnapshot(m)); return; }
    switch (m.t) {
      case 'go': this.begin(); break;
      case 'hp': this.onHp(m); break;
      case 'hit': this.onHit(m); break;
      case 'dead': this.onDead(m); break;
      case 'fire': this.onFire(m); break;
      case 'give': this.onGive(m); break;
      case 'nogive': this.pendingPick = null; break;
      case 'thr': this.onThrowMsg(m); break;
      case 'boom': this.onBoom(m); break;
      case 'air': this.onAir(m); break;
      case 'chat': { const p = this.pl.get(m.i); this.hud.chat(p ? p.n : '?', m.m, p ? hex(p.c) : '#fff'); break; }
      case 'end': this.onEnd(m); break;
      default: break;
    }
  }
  onSnapshot(s) {
    const now = performance.now();
    this.mtBase = s.mt; this.mtStamp = now;
    this.aliveN = s.alive;
    for (const r of s.recs) {
      const p = this.pl.get(r.idx); if (!p) continue;
      if (!p.ch) this.makeRemote(p);
      r.at = now; p.buf.push(r); if (p.buf.length > 12) p.buf.shift();
      p.lastSeen = now; p.pst = r.pst;
    }
    this.net = (this.net || 0) + 1;
  }
  makeRemote(p) {
    p.ch = buildCharacter(p.c); this.scene.add(p.ch.root);
    p.chute = buildParachute(); p.chute.visible = false; this.scene.add(p.chute);
    p.ch.root.visible = false;
  }
  onHp(m) {
    const M = this.me;
    M.hp = m.hp; M.boost = m.b; M.helm = { l: m.hl, d: m.hd }; M.vest = { l: m.vl, d: m.vd };
    this.refreshHud();
  }
  onHit(m) {
    const M = this.me;
    if (m.k === this.idx && m.v !== this.idx) { this.hud.hitmarker(m.z === 'h' ? 'head' : ''); A.sndHit(m.z === 'h'); }
    if (m.v === this.idx) {
      this.hud.damageFlash(); A.sndHurt(); this.shake = Math.max(this.shake, 0.4);
      const k = this.pl.get(m.k);
      if (m.z === 'x') { /* פיצוץ */ }
      else if (k && k.vis) { const b = M.body; const ang = angleDiff(b.yaw, Math.atan2(-(k.rx - b.x), -(k.rz - b.z))); this.hud.damageDir(-ang); }
      if (M.using) { M.using = null; }
    } else this.fx.blood({ x: m.x, y: m.y + 1.2, z: m.zz });
  }
  onDead(m) {
    const v = this.pl.get(m.v), k = this.pl.get(m.k);
    if (v) { v.alive = false; v.deadAt = this.t; }
    const w = WEAPONS[m.w] ? WEAPONS[m.w].n : ({ frag: 'רימון', molo: 'מולוטוב', zone: 'האזור', left: 'עזב', fist: 'אגרוף', drown: 'טביעה' }[m.w] || '');
    const mine = m.k === this.idx || m.v === this.idx;
    const who = k && m.k !== m.v ? `<b style="color:${hex(k.c)}">${esc(k.n)}</b> ← ` : '';
    this.hud.feed(`${who}<b style="color:${v ? hex(v.c) : '#fff'}">${esc(v ? v.n : '?')}</b> <small>${esc(w)}${m.z === 'h' ? ' · ירי בראש' : ''}</small>`, mine);
    if (m.k === this.idx && m.v !== this.idx) { this.me.kills = m.kc; this.hud.hitmarker('kill'); this.hud.banner(`הרגת את ${v ? v.n : ''}`, 2200); }
    if (m.v === this.idx) this.onDeath(m, k);
    this.hud.el['c-kills'].textContent = this.me.kills;
  }
  onDeath(m, killer) {
    const M = this.me; if (M.phase === 'dead') return;
    // זורקים את כל הציוד
    const items = [];
    for (const w of M.weapons) if (w) { items.push(['w:' + w.id, 1]); if (w.mag > 0) items.push(['a:' + WEAPONS[w.id].ammo, w.mag]); if (w.scope) items.push(['s:' + w.scope, 1]); }
    for (const [k, c] of Object.entries(M.items)) items.push([k, c]);
    if (M.helm.l && M.helm.d > 0) items.push(['h' + M.helm.l, 1]); if (M.vest.l && M.vest.d > 0) items.push(['v' + M.vest.l, 1]); if (M.pack) items.push(['p' + M.pack, 1]);
    items.forEach(([k, c], i) => { const a = (i / items.length) * TAU, g = this.groundPos(); this.send({ t: 'drop', k, c, x: g.x + Math.cos(a) * 0.9, y: g.y, z: g.z + Math.sin(a) * 0.9 }); });
    M.items = {}; M.weapons = [null, null]; M.cur = -1; M.using = null; M.cook = null;
    M.phase = 'dead'; this.mouse.l = this.mouse.r = false;
    this.specTarget = killer && killer.idx !== this.idx ? killer.idx : null;
    this.myChar.root.visible = false; this.myChute.visible = false;
    this.deathInfo = { place: m.pl, killer: killer ? killer.n : null, w: m.w };
    setTimeout(() => this.showDeath(), 1400);
    this.hud.setPrompt(''); this.hud.setAction(null);
  }
  showDeath() {
    if (this.endOpen || this.me.phase !== 'dead') return;
    const d = this.deathInfo || {};
    document.exitPointerLock();
    this.endOpen = true;
    document.getElementById('endscreen').classList.remove('hidden');
    document.getElementById('end-title').textContent = d.killer ? `${d.killer} חיסל אותך` : 'נהרגת';
    document.getElementById('end-sub').textContent = `מקום #${d.place} · ${this.me.kills} הריגות`;
    document.getElementById('end-table').innerHTML = '';
    const sp = document.getElementById('btn-spec'); sp.classList.remove('hidden');
    document.getElementById('btn-back').textContent = 'יציאה מהמשחק';
    this.deathShown = true;
  }
  stopSpectateScreen() { this.endOpen = false; document.getElementById('endscreen').classList.add('hidden'); this.lock(); }
  onFire(m) {
    const p = this.pl.get(m.i); const W = WEAPONS[m.w]; if (!W) return;
    const cam = this.camera.position;
    const dx = m.o[0] - cam.x, dz = m.o[2] - cam.z, dist = Math.hypot(dx, dz);
    A.sndShot(W.cls, dist, this.panTo(m.o[0], m.o[2]));
    if (dist > 600) return;
    const fwd = new THREE.Vector3(m.e[0] - m.o[0], m.e[1] - m.o[1], m.e[2] - m.o[2]).normalize();
    let o = { x: m.o[0], y: m.o[1], z: m.o[2] };
    if (p && p.ch && p.ch.root.visible && p.ch.weapon) { const mz = this.muzzleOf(p.ch); if (mz) o = mz; }
    this.fx.tracer([o.x, o.y, o.z], m.e, 520);
    this.fx.muzzle(o, fwd, 0.9);
    if (p) { p.fireT = 0.15; }
    const ep = { x: m.e[0], y: m.e[1], z: m.e[2] };
    this.fx.impact(ep, { x: -fwd.x, y: -fwd.y, z: -fwd.z }, ep.y < -0.3 ? 'water' : 'box');
  }
  onThrowMsg(m) {
    const G = { id: m.id, g: m.g, x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, rest: false, mesh: buildGrenade(m.g) };
    this.scene.add(G.mesh); this.grenades.set(m.id, G);
    if (m.by === this.idx) A.sndPin();
  }
  onBoom(m) {
    const G = this.grenades.get(m.id); if (G) { this.scene.remove(G.mesh); this.grenades.delete(m.id); }
    const p = { x: m.x, y: m.y, z: m.z }, T = THROWS[m.g], cam = this.camera.position;
    const d = Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z), pan = this.panTo(p.x, p.z);
    if (m.g === 'frag') { this.fx.explosion(p, T.radius); A.sndBoom(d, pan); this.shake = Math.max(this.shake, clamp(1.4 - d / 30, 0, 1.4)); }
    else if (m.g === 'smoke') { this.fx.addSmoke(p, T.dur, T.radius); A.sndBoom(d * 3, pan); }
    else if (m.g === 'molo') { this.fx.addFire(p, T.dur, T.radius * 0.7); this.fx.explosion(p, 3); A.sndBoom(d * 2, pan); }
    else if (m.g === 'stun') {
      this.fx.explosion(p, 2); A.sndBoom(d, pan);
      if (d < T.radius && this.me.phase !== 'dead' && this.world.los(p.x, p.y + 0.3, p.z, cam.x, cam.y, cam.z)) {
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion), to = new THREE.Vector3(p.x - cam.x, p.y - cam.y, p.z - cam.z).normalize();
        const facing = fwd.dot(to); const k = clamp(1 - d / T.radius, 0.2, 1) * (facing > 0 ? 1 : 0.45);
        this.hud.stun(5 * k); A.sndFlash(k);
      }
    }
  }
  onAir(m) {
    const mesh = buildAirdrop(); this.scene.add(mesh);
    this.drops.set(m.id, { id: m.id, x: m.x, z: m.z, t0: m.t0, fall: m.fall, mesh, landed: false, y: this.world.heightAt(m.x, m.z) });
    this.hud.banner('חבילת אספקה בדרך!', 4000); A.sndAlert();
  }
  onEnd(m) {
    this.ended = true; this.endOpen = true;
    document.exitPointerLock();
    const win = m.win === this.idx;
    document.getElementById('endscreen').classList.remove('hidden');
    document.getElementById('end-title').textContent = win ? 'ניצחון! 🐔 ארוחת תרנגול!' : (m.win >= 0 && this.pl.get(m.win) ? `${this.pl.get(m.win).n} ניצח` : 'המשחק הסתיים');
    const mine = m.rows.find((r) => r.i === this.idx);
    document.getElementById('end-sub').textContent = mine ? `מקום #${mine.pl} · ${mine.k} הריגות` : '';
    const rows = m.rows.map((r) => `<tr class="${r.i === this.idx ? 'me' : ''}"><td>#${r.pl > 90 ? '-' : r.pl}</td><td>${esc(r.n)}${r.b ? ' 🤖' : ''}</td><td>${r.k}</td><td>${r.dm}</td></tr>`).join('');
    document.getElementById('end-table').innerHTML = `<tr><th>מקום</th><th>שחקן</th><th>הריגות</th><th>נזק</th></tr>${rows}`;
    document.getElementById('btn-spec').classList.add('hidden');
    document.getElementById('btn-back').textContent = this.isHost || (this.mgr && this.mgr()) ? 'חזרה ללובי' : 'המתן למנהל...';
    this.me.phase = this.me.phase === 'dead' ? 'dead' : 'ground';
  }

  // ---------- שחקנים מרוחקים ----------
  updateRemote(dt, mt) {
    const now = performance.now(), rt = now - 120, cam = this.camera.position;
    for (const p of this.pl.values()) {
      if (p.idx === this.idx || !p.ch) continue;
      const ch = p.ch, buf = p.buf;
      if (!p.alive && this.t - p.deadAt > 5) { ch.root.visible = false; p.chute.visible = false; p.vis = false; continue; }
      if (!buf.length || now - p.lastSeen > (p.alive ? 900 : 5000)) { ch.root.visible = false; p.chute.visible = false; p.vis = false; continue; }
      let a = buf[0], b = buf[buf.length - 1];
      for (let i = buf.length - 1; i > 0; i--) { if (buf[i - 1].at <= rt) { a = buf[i - 1]; b = buf[i]; break; } if (i === 1) { a = buf[0]; b = buf[1]; } }
      let u = b.at > a.at ? clamp((rt - a.at) / (b.at - a.at), 0, 1) : 1; if (buf.length === 1) { a = b; u = 1; }
      const x = lerp(a.x, b.x, u), y = lerp(a.y, b.y, u), z = lerp(a.z, b.z, u), yaw = a.yaw + angleDiff(a.yaw, b.yaw) * u, pitch = lerp(a.pitch, b.pitch, u);
      const dd = Math.hypot(x - p.px, z - p.pz); p.sp = lerp(p.sp, dt > 0 ? Math.min(12, dd / dt) : 0, Math.min(1, dt * 8)); p.px = x; p.pz = z;
      p.rx = x; p.ry = y; p.rz = z; p.ryaw = yaw; p.rstance = b.stance; p.pst = b.pst;
      const dist = Math.hypot(x - cam.x, z - cam.z);
      const inPlane = b.pst === 1;
      p.vis = !inPlane && dist < 520 && p.alive;
      ch.root.visible = (p.vis || (!p.alive && !inPlane)) && dist < 520;
      if (!ch.root.visible) { p.chute.visible = false; continue; }
      ch.root.position.set(x, y, z); ch.root.rotation.y = yaw;
      ch.setEquip(b.eh, b.ev, b.ep);
      if (b.wid !== ch.wid && !ch.grenade) ch.setWeapon(b.wid);
      const dead = !p.alive;
      ch.animate(dt, dead ? 0 : p.sp, dead ? 2 : b.stance, pitch, b.pst, p.sp > 0.4, p.fireT > 0 ? 1 : 0);
      if (p.fireT > 0) p.fireT -= dt;
      p.chute.visible = b.pst === 3; if (b.pst === 3) { p.chute.position.set(x, y, z); p.chute.rotation.y = yaw; }
      if (p.alive && b.pst === 0 && p.sp > 2 && dist < 45) { p.stepAcc += p.sp * dt; if (p.stepAcc > (p.sp > 6 ? 2.5 : 1.9)) { p.stepAcc = 0; A.sndStep(dist, this.panTo(x, z), p.sp > 6); } }
      // שלט שם
      if (p.alive && dist < 50) {
        const v = new THREE.Vector3(x, y + 2.05, z).project(this.camera);
        const vis = v.z < 1 && v.z > 0 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && this.world.los(cam.x, cam.y, cam.z, x, y + 1.5, z);
        this.hud.plate(p.idx, p.n, hex(p.c), (v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight, vis && !this.uiOpen);
      } else this.hud.plate(p.idx, p.n, hex(p.c), 0, 0, false);
    }
  }
  panTo(x, z) {
    const c = this.camera.position, dx = x - c.x, dz = z - c.z, l = Math.hypot(dx, dz) || 1, yaw = this.me ? this.me.body.yaw : 0;
    return (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / l;
  }

  // ---------- רימונים, זריקות אספקה, לוט ----------
  updateGrenades(dt) {
    for (const G of this.grenades.values()) {
      stepProjectile(G, dt, this.world);
      G.mesh.position.set(G.x, G.y, G.z);
      if (!G.rest) { G.mesh.rotation.x += dt * 9; G.mesh.rotation.z += dt * 5; }
    }
  }
  updateDrops(mt) {
    for (const D of this.drops.values()) {
      const e = mt - D.t0, y = Math.max(D.y, PLANE.alt - 7 * e);
      D.mesh.position.set(D.x, y, D.z);
      D.mesh.userData.chute.visible = y > D.y + 0.2;
      if (y <= D.y + 0.001 && !D.landed) { D.landed = true; this.fx.addSmoke({ x: D.x, y: D.y, z: D.z }, 150, 2.2, 0xff4a2a); }
      if (!D.landed && (this._sm = (this._sm || 0) + 1) % 4 === 0) this.fx.spr(D.x, y + 2, D.z, 1.8, 0xff5a3a, 3, 0, 0, 0, 2.5, 0.7, 0.5);
      if (D.landed && D.mesh.userData.chute.visible === false) { /* נשאר על הקרקע */ }
    }
  }
  protoFor(k) {
    let p = this.protoCache.get(k);
    if (!p) { p = buildLootMesh(k); this.protoCache.set(k, p); }
    const g = p.clone();
    g.userData = { inner: g.children[0], ring: g.children[1], beam: g.children[2], ph: Math.random() * 6.28 };
    return g;
  }
  updateLoot(dt) {
    const c = this.me.phase === 'dead' && this.specCam ? this.specCam : this.camera.position;
    const loot = this.world.loot;
    this.lootT = (this.lootT || 0) + dt;
    if (this.lootT > 0.15) {
      this.lootT = 0;
      for (const L of loot.values()) {
        const dx = L.x - c.x, dz = L.z - c.z;
        if (dx > LOOT_SHOW || dx < -LOOT_SHOW || dz > LOOT_SHOW || dz < -LOOT_SHOW) continue;
        if (this.lootMeshes.has(L.id)) continue;
        const m = this.protoFor(L.k); m.position.set(L.x, L.y, L.z); this.scene.add(m); this.lootMeshes.set(L.id, m);
      }
      for (const [id, m] of this.lootMeshes) {
        const L = loot.get(id);
        if (!L || Math.abs(L.x - c.x) > LOOT_SHOW + 15 || Math.abs(L.z - c.z) > LOOT_SHOW + 15) { this.scene.remove(m); this.lootMeshes.delete(id); }
      }
    }
    for (const m of this.lootMeshes.values()) { const u = m.userData; u.ph += dt * 2; u.inner.position.y = 0.12 + Math.sin(u.ph) * 0.05; u.inner.rotation.y += dt * 0.9; }
  }

  // ---------- צופה ----------
  cycleSpectate(dir) {
    const alive = [...this.pl.values()].filter((p) => p.alive && p.idx !== this.idx && p.ch && p.vis);
    if (!alive.length) { this.specTarget = null; return; }
    const i = alive.findIndex((p) => p.idx === this.specTarget);
    this.specTarget = alive[(i + dir + alive.length) % alive.length].idx;
  }
  updateSpectate(dt) {
    let t = this.pl.get(this.specTarget);
    if (!t || !t.alive || !t.vis) { this.cycleSpectate(1); t = this.pl.get(this.specTarget); }
    this.specLook = this.specLook || { yaw: 0, pitch: -0.2 };
    if (t) { this.hud.el['spec-name'].textContent = 'צופה ב: ' + t.n; this.hud.el.spectate.classList.remove('hidden'); } else this.hud.el.spectate.classList.add('hidden');
  }

  // ---------- HUD ----------
  refreshHud() {
    const M = this.me; if (!M) return;
    this.hud.setHealth(M.hp, M.boost);
    this.hud.setGear(M.helm, M.vest, M.pack);
    this.refreshAmmo();
    this.hud.setThrow(M.cur === 2 || this.firstThrow() ? `רימון: ${THROWS[M.throwSel].name} ×${this.throwCount(M.throwSel)}  (Q להחלפה, G לזריקה)` : '');
  }
  refreshAmmo() { const M = this.me; this.hud.setWeapons(M.weapons, M.cur, (id) => this.weaponReserve(id)); }
  updateHud(dt, mt) {
    const M = this.me, b = M.body, Z = this.zone;
    this.hud.el['c-alive'].textContent = this.aliveN;
    this.hud.compass(b.yaw);
    let txt = '', tm = '';
    if (Z.mode === 'pre') { txt = 'האזור הראשון יסומן בעוד'; tm = fmtTime(Z.left); }
    else if (Z.mode === 'wait') { txt = `שלב ${Z.phase} · האזור יתכווץ בעוד`; tm = fmtTime(Z.left); }
    else if (Z.mode === 'shrink') { txt = `שלב ${Z.phase} · האזור מתכווץ!`; tm = fmtTime(Z.left); }
    else { txt = 'האזור הסופי'; tm = ''; }
    this.hud.el['zone-text'].textContent = txt; this.hud.el['zone-timer'].textContent = tm;
    this.hud.el['zone-info'].classList.toggle('warn', Z.mode === 'shrink');
    // האם מחוץ לאזור
    const out = M.phase === 'ground' && Math.hypot(b.x - Z.cx, b.z - Z.cz) > Z.r && Z.mode !== 'pre';
    if (out !== this.wasOut) { this.hud.zoneFlash(out); this.wasOut = out; if (out) this.hud.toast('אתה מחוץ לאזור הבטוח!', 2500); }
    if (M.phase === 'ground' && out && (this._zt = (this._zt || 0) + dt) > 1) { this._zt = 0; A.sndZoneTick(); }
    // מטח/נפילה
    const fi = this.hud.el['fall-info'];
    if (M.phase === 'fall' || M.phase === 'chute') { const gh = this.world.heightAt(b.x, b.z); fi.classList.remove('hidden'); fi.innerHTML = `גובה: ${Math.max(0, Math.round(b.y - gh))} מ'<br><small>${M.phase === 'fall' ? 'F = פתח מצנח · מבט למטה = צלילה' : 'W/S = שליטה במהירות'}</small>`; }
    else if (M.phase === 'plane') { fi.classList.remove('hidden'); fi.innerHTML = 'לחץ <b>F</b> כדי לקפוץ<br><small>המטוס עובר מעל האי</small>'; }
    else fi.classList.add('hidden');
    // כוונת
    const Wd = M.weapons[M.cur] ? WEAPONS[M.weapons[M.cur].id] : null;
    const moving = Math.hypot(b.vx, b.vz) > 1;
    const spread = Wd ? (Wd.sp * (1 + this.bloom * 0.8) * (moving ? 1.55 : 1) * (b.onGround ? 1 : 2.6)) * 6 : 4;
    this.hud.crosshair(Math.min(60, spread), M.ads > 0.5, M.phase !== 'ground' || !Wd || this.view === 'tpp' && false);
    this.hud.el['net-stat'].textContent = this.isHost ? `host · ${[...this.pl.values()].filter((p) => !p.bot).length} שחקנים` : `snap ${this.net || 0}`;
    this.hud.drawMinimap(this.mapCtxData());
    if (this.mapOpen) this.hud.drawBigMap(this.mapCtxData());
    if (M.noAmmoClick > 0) M.noAmmoClick -= dt;
  }
  mapCtxData() { return { me: this.me.body, zone: this.zone, tl: this.tl, drops: [...this.drops.values()].filter((d) => !d.landed || true), mt: this.mt(), towns: this.world.towns }; }

  // ---------- רינדור ----------
  zoomNow() {
    const M = this.me; if (!M || M.ads < 0.05) return 1;
    const w = M.weapons[M.cur]; const z = w && w.scope ? SCOPES[w.scope].zoom : 1.15;
    return lerp(1, z, M.ads);
  }
  render(dt) {
    const M = this.me, cam = this.camera, b = M.body, mt = this.mt();
    let eye = new THREE.Vector3(), yaw = b.yaw, pitch = b.pitch;
    const alive = M.phase !== 'dead';
    // גובה עין חלק
    M.eyeY = lerp(M.eyeY, PHYS.eye[M.stance], Math.min(1, dt * 10));
    let viewTpp = this.view === 'tpp' || !alive || M.phase === 'plane' || M.phase === 'fall' && false;
    if (alive && (M.phase === 'ground' || M.phase === 'chute' || M.phase === 'fall')) {
      eye.set(b.x, b.y + (M.phase === 'ground' ? M.eyeY : 1.6), b.z);
      if (M.phase === 'ground' && Math.hypot(b.vx, b.vz) > 1 && !viewTpp) eye.y += Math.sin(this.camBob * 2) * 0.025 * (this.sprinting ? 1.6 : 1) * (1 - M.ads);
    } else if (M.phase === 'plane') {
      eye.set(b.x, b.y + 1, b.z);
    } else if (M.phase === 'dead') {
      const t = this.pl.get(this.specTarget);
      if (t && t.ch && t.ch.root.visible) { eye.set(t.rx, t.ry + 1.6, t.rz); yaw = t.ryaw; pitch = (t.buf.length ? t.buf[t.buf.length - 1].pitch : 0); }
      else eye.set(b.x, b.y + 1.6, b.z);
      this.specCam = eye;
    } else eye.set(b.x, b.y + 1.6, b.z);
    // יעד מצלמה
    cam.rotation.set(0, 0, 0);
    const sh = this.shake > 0.01 ? (Math.random() - 0.5) * this.shake * 0.02 : 0;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const pos = eye.clone();
    const showBody = (viewTpp && alive && (M.phase === 'ground' || M.phase === 'chute' || M.phase === 'fall')) || (M.phase === 'dead');
    if (M.phase === 'plane') {
      pos.set(b.x - Math.sin(yaw) * 0, b.y + 6, b.z).addScaledVector(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), 38);
      cam.position.copy(pos); cam.rotation.set(-0.25, yaw, 0);
    } else if (viewTpp || M.phase === 'dead') {
      const fwd = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const dist = M.phase === 'dead' ? 4.5 : 3.4, want = eye.clone().addScaledVector(fwd, -dist).addScaledVector(right, M.phase === 'dead' ? 0 : 0.55).addScaledVector(new THREE.Vector3(0, 1, 0), 0.25);
      const d = want.clone().sub(eye), L = d.length(); d.normalize();
      const hit = this.world.raycast(eye.x, eye.y, eye.z, d.x, d.y, d.z, L + 0.3);
      cam.position.copy(hit ? eye.clone().addScaledVector(d, Math.max(0.3, hit.t - 0.3)) : want);
      cam.rotation.set(pitch + sh, yaw, 0);
    } else { cam.position.copy(eye); cam.rotation.set(pitch + sh, yaw + sh, 0); }
    // FOV
    const zoom = this.zoomNow(); const fov = this.prefs.fov / zoom;
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = fov; cam.updateProjectionMatrix(); }
    this.vCam.fov = 60 / Math.max(1, Math.min(1.5, zoom)); this.vCam.updateProjectionMatrix();
    // דמות עצמית
    const ch = this.myChar;
    ch.root.visible = showBody && M.phase !== 'plane';
    if (ch.root.visible) {
      ch.root.position.set(b.x, b.y, b.z); ch.root.rotation.y = alive ? b.yaw : (this.t * 0);
      ch.setEquip(M.helm.l, M.helm.d > 0 ? M.helm.l : 0, M.pack);
      ch.setEquip(M.helm.d > 0 ? M.helm.l : 0, M.vest.d > 0 ? M.vest.l : 0, M.pack);
      const W = M.cur >= 0 && M.cur < 2 ? M.weapons[M.cur] : null;
      if (M.cur === 2) ch.setWeapon(null, M.throwSel); else ch.setWeapon(W ? W.id : null);
      ch.animate(dt, Math.hypot(b.vx, b.vz), M.stance, b.pitch, M.phase === 'chute' ? 3 : M.phase === 'fall' ? 2 : 0, true, this.t - this.lastShot < 0.1 ? 1 : 0);
    }
    this.myChute.visible = M.phase === 'chute' && alive; if (this.myChute.visible) { this.myChute.position.set(b.x, b.y, b.z); this.myChute.rotation.y = b.yaw; }
    // viewmodel
    const fpp = alive && M.phase === 'ground' && !viewTpp && !this.uiOpen_hidden;
    this.updateViewmodel(dt, fpp, zoom);
    this.hud.scope(fpp && zoom >= 3.5 && M.ads > 0.85);
    // עולם
    this.wm.update(dt, cam, this.t);
    this.fx.update(dt, cam);
    const r = this.renderer;
    r.autoClear = false; r.clear();
    r.render(this.scene, cam);
    if (this.vmVisible) { r.clearDepth(); r.render(this.vScene, this.vCam); }
  }

  updateViewmodel(dt, fpp, zoom) {
    const M = this.me, W = M.cur >= 0 && M.cur < 2 ? M.weapons[M.cur] : null;
    const id = M.cur === 2 ? 'g:' + M.throwSel : W ? W.id : 'fist';
    if (id !== this.vmWid) {
      this.vmWid = id; this.vm.clear(); this.vmW = null;
      const sleeve = new THREE.MeshStandardMaterial({ color: this.pl.get(this.idx) ? this.pl.get(this.idx).c : 0x555555, roughness: 0.9 }), glove = new THREE.MeshStandardMaterial({ color: 0x1f2124, roughness: 0.9 });
      const arm = (x, y, z, rz, rx, ry) => { const g = new THREE.Group(); const a = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.5), sleeve); a.position.z = 0.25; g.add(a); const h = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.085, 0.11), glove); h.position.z = -0.02; g.add(h); g.position.set(x, y, z); g.rotation.set(rx, ry, rz); return g; };
      if (id === 'fist') { this.vm.add(arm(0.2, -0.22, -0.35, 0, 0.1, 0.1), arm(-0.2, -0.22, -0.35, 0, 0.1, -0.1)); this.vmW = null; }
      else if (id.startsWith('g:')) { const g = buildGrenade(id.slice(2)); g.scale.setScalar(2.2); g.position.set(0.16, -0.17, -0.38); this.vm.add(g, arm(0.2, -0.26, -0.18, 0, 0.3, 0)); this.vmW = g; }
      else {
        const wp = buildWeapon(id); wp.scale.setScalar(1.0); this.vm.add(wp); this.vmW = wp; wp.userData.baseRot = 0;
        const U = wp.userData;
        const a1 = arm(0.0, 0, 0, 0, 0, 0), a2 = arm(0, 0, 0, 0, 0, 0);
        a1.position.set(U.grip.x + 0.03, U.grip.y - 0.03, U.grip.z + 0.02); a1.rotation.set(-0.05, 0.08, 0);
        a2.position.set(U.fore.x - 0.04, U.fore.y - 0.02, U.fore.z); a2.rotation.set(0.0, -0.18, 0);
        a1.scale.z = 0.9; a2.scale.z = 1.0; wp.add(a1, a2);
      }
    }
    this.vmVisible = fpp;
    if (!fpp || !this.vmW && id !== 'fist') { return; }
    this.vmKick = Math.max(0, this.vmKick - dt * 9); this.vmSwitch = Math.max(0, this.vmSwitch - dt * 3.2);
    const ads = M.ads, bob = Math.hypot(M.body.vx, M.body.vz) > 1 ? Math.sin(this.camBob * 2) : 0, spr = this.sprinting ? 1 : 0;
    const ux = lerp(0.2, 0.0, ads) + bob * 0.006 * (1 - ads), uy = lerp(-0.2, W && SCOPES[W.scope || 'x'] && W.scope ? -0.105 : -0.115, ads) + Math.abs(bob) * 0.006 * (1 - ads) - this.vmSwitch * 0.25 - (M.reload > 0 ? 0.12 : 0), uz = lerp(-0.38, -0.3, ads) + this.vmKick * 0.06;
    const g = this.vm;
    g.position.set(ux, uy, uz);
    g.rotation.set(this.vmKick * 0.08 - spr * 0.5 + (M.reload > 0 ? -0.45 : 0), spr * 0.6, spr * -0.25 + (M.reload > 0 ? 0.4 : 0));
    if (this.vmW && this.vmW.userData && this.vmW.userData.muzzle) {
      this.vmFlash.visible = this.vmFlashT > 0;
      if (this.vmFlashT > 0) { this.vmFlashT -= dt; const mz = this.vmW.userData.muzzle.clone(); this.vmW.localToWorld(mz); g.updateMatrixWorld(true); this.vmFlash.position.copy(this.vmW.localToWorld(this.vmW.userData.muzzle.clone())); this.vmFlash.scale.setScalar(0.25 + Math.random() * 0.2); }
    } else this.vmFlash.visible = false;
    if (zoom >= 3.5 && M.ads > 0.85) this.vmVisible = false;
  }

  // ---------- תיק ----------
  toggleInv(force) {
    const on = force === undefined ? !this.invOpen : force;
    if (on && (this.me.phase !== 'ground' && this.me.phase !== 'dead')) return;
    this.invOpen = on;
    document.getElementById('inv').classList.toggle('hidden', !on);
    if (on) { document.exitPointerLock(); this.mouse.l = this.mouse.r = false; this.renderInv(); this._invTimer = setInterval(() => this.renderInv(), 700); }
    else { clearInterval(this._invTimer); this.lock(); }
  }
  toggleMap(force) {
    const on = force === undefined ? !this.mapOpen : force;
    this.mapOpen = on;
    document.getElementById('bigmap').classList.toggle('hidden', !on);
    if (on) { document.exitPointerLock(); this.hud.drawBigMap(this.mapCtxData()); } else this.lock();
  }
  renderInv() {
    const M = this.me, $ = (id) => document.getElementById(id);
    $('inv-cap').textContent = `(${Math.round(this.used())} / ${this.capacity()})`;
    const mk = (cls, html, onClick, onRight) => { const d = document.createElement('div'); d.className = 'it ' + cls; d.innerHTML = html; d.onclick = onClick; d.oncontextmenu = (e) => { e.preventDefault(); if (onRight) onRight(); }; return d; };
    const eq = $('inv-equip'); eq.innerHTML = '';
    eq.appendChild(mk(M.helm.l ? 'r' + (M.helm.l + 1) : 'disabled', `<span>${M.helm.l ? esc(HELMET[M.helm.l].name) : 'ללא קסדה'}</span><small>${M.helm.l ? Math.round(M.helm.d) + '/' + HELMET[M.helm.l].dur : ''}</small>`));
    eq.appendChild(mk(M.vest.l ? 'r' + (M.vest.l + 1) : 'disabled', `<span>${M.vest.l ? esc(VEST[M.vest.l].name) : 'ללא אפוד'}</span><small>${M.vest.l ? Math.round(M.vest.d) + '/' + VEST[M.vest.l].dur : ''}</small>`));
    eq.appendChild(mk(M.pack ? 'r' + (M.pack + 1) : 'disabled', `<span>${M.pack ? esc(PACK[M.pack].name) : 'ללא תיק'}</span><small>${M.pack ? '+' + PACK[M.pack].cap : ''}</small>`));
    const ws = $('inv-weapons'); ws.innerHTML = '';
    M.weapons.forEach((w, i) => {
      ws.appendChild(mk(w ? 'r3' : 'disabled', w ? `<span>${i + 1}. ${esc(WEAPONS[w.id].n)}${w.scope ? ' · ' + esc(SCOPES[w.scope].name) : ''}</span><small>${w.mag}/${WEAPONS[w.id].mag}</small>` : `<span>${i + 1}. ריק</span>`,
        () => { if (w) { this.selectSlot(i); this.renderInv(); } },
        () => { if (!w) return; this.dropItem('w:' + w.id, 1); if (w.mag > 0) this.dropItem('a:' + WEAPONS[w.id].ammo, w.mag); if (w.scope) this.dropItem('s:' + w.scope, 1); M.weapons[i] = null; if (M.cur === i) M.cur = M.weapons[1 - i] ? 1 - i : -1; this.vmWid = null; this.refreshHud(); this.renderInv(); }));
    });
    const its = $('inv-items'); its.innerHTML = '';
    const keys = Object.keys(M.items).sort();
    if (!keys.length) its.innerHTML = '<p class="tiny">התיק ריק. אסוף פריטים עם F.</p>';
    for (const k of keys) {
      const i = itemInfo(k), c = M.items[k];
      its.appendChild(mk('r' + itemRarity(k), `<span>${esc(i.name)} ×${c}</span><small>${(i.w * c).toFixed(0)}</small>`,
        () => { if (i.type === 'med') { this.toggleInv(false); this.startUse(i.id); } else if (i.type === 'throw') { M.throwSel = i.id; this.selectSlot(2); this.renderInv(); } else if (i.type === 'scope') { this.attachScope(i.id); this.renderInv(); } },
        () => { const n = i.type === 'ammo' ? Math.min(c, AMMO[i.id].box) : c; M.items[k] -= n; if (M.items[k] <= 0) delete M.items[k]; this.dropItem(k, n); this.refreshHud(); this.renderInv(); }));
    }
    const gr = $('inv-ground'); gr.innerHTML = '';
    const b = M.body; const near = [];
    for (const L of this.world.loot.values()) { if (Math.abs(L.x - b.x) < 3 && Math.abs(L.z - b.z) < 3 && Math.abs(L.y - b.y) < 2.5) near.push(L); if (near.length >= 24) break; }
    if (!near.length) gr.innerHTML = '<p class="tiny">אין פריטים בקרבת מקום.</p>';
    for (const L of near) { const i = itemInfo(L.k); gr.appendChild(mk('r' + itemRarity(L.k), `<span>${esc(i.name)}${L.c > 1 ? ' ×' + L.c : ''}</span>`, () => { if (this.canTake(L)) { this.send({ t: 'pick', id: L.id }); } else this.hud.toast('אי אפשר לאסוף'); })); }
  }
  attachScope(id) {
    const M = this.me, w = M.weapons[M.cur] && WEAPONS[M.weapons[M.cur].id].cls !== 'pistol' ? M.weapons[M.cur] : (M.weapons[0] && WEAPONS[M.weapons[0].id].cls !== 'pistol' ? M.weapons[0] : M.weapons[1] && WEAPONS[M.weapons[1].id].cls !== 'pistol' ? M.weapons[1] : null);
    if (!w) { this.hud.toast('אין נשק מתאים'); return; }
    if (w.scope) M.items['s:' + w.scope] = (M.items['s:' + w.scope] || 0) + 1;
    w.scope = id; M.items['s:' + id]--; if (M.items['s:' + id] <= 0) delete M.items['s:' + id];
    this.hud.toast(`${SCOPES[id].name} הותקן`);
  }

  sendState() {
    const M = this.me, b = M.body, k = this.keys;
    let fl = 0;
    if (Math.hypot(b.vx, b.vz) > 0.5) fl |= FL.MOVING; if (this.sprinting) fl |= FL.SPRINT; if (M.ads > 0.5) fl |= FL.ADS; if (this.t - this.lastShot < 0.12) fl |= FL.FIRE; if (M.reload > 0) fl |= FL.RELOAD;
    const W = M.cur >= 0 && M.cur < 2 ? M.weapons[M.cur] : null;
    const pst = M.phase === 'plane' ? 1 : M.phase === 'fall' ? 2 : M.phase === 'chute' ? 3 : 0;
    this.send(packState({ idx: this.idx, x: b.x, y: b.y, z: b.z, yaw: b.yaw, pitch: b.pitch, stance: M.phase === 'ground' ? M.stance : 0, fl, wid: W ? W.id : null, pst, eh: M.helm.d > 0 ? M.helm.l : 0, ev: M.vest.d > 0 ? M.vest.l : 0, ep: M.pack }));
  }

  // ---------- סיום ----------
  destroy() {
    this.running = false; cancelAnimationFrame(this.raf);
    this.unbind(); clearInterval(this._invTimer);
    document.exitPointerLock && document.exitPointerLock();
    this.hud.clearPlates(); this.hud.show(false);
    for (const id of ['inv', 'bigmap', 'pause', 'endscreen']) document.getElementById(id).classList.add('hidden');
    this.hud.el.killfeed.innerHTML = ''; this.hud.el['chat-log'].innerHTML = '';
    this.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) { if (m.map) m.map.dispose(); m.dispose(); } } });
    this.renderer.renderLists && this.renderer.renderLists.dispose();
    this.renderer.autoClear = true; this.renderer.clear();
  }
}
const tick = () => new Promise((r) => setTimeout(r, 0));
