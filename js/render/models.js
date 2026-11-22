// מודלים תלת-ממדיים מפרימיטיבים: דמויות ריאליסטיות עם קסדה/אפוד/תיק, נשקים, רימונים, מטוס, חבילת אספקה ופריטי לוט.
import * as THREE from 'three';
import { WEAPONS, HELMET, VEST, PACK, AMMO, THROWS, itemInfo } from '../sim/data.js';

const M = {}; // מטריאלים משותפים
const mat = (key, color, o = {}) => (M[key] ||= new THREE.MeshStandardMaterial({ color, roughness: o.r ?? 0.7, metalness: o.m ?? 0.0, ...(o.extra || {}) }));
const box = (w, h, d, m, x = 0, y = 0, z = 0) => { const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); g.position.set(x, y, z); g.castShadow = true; return g; };
const cyl = (r1, r2, h, m, seg = 10) => { const g = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), m); g.castShadow = true; return g; };

const gunMetal = () => mat('gm', 0x24272b, { r: 0.45, m: 0.6 });
const gunLight = () => mat('gl', 0x4a4e55, { r: 0.4, m: 0.6 });
const wood = () => mat('gw', 0x6e4a2b, { r: 0.8 });
const polymer = () => mat('gp', 0x34373a, { r: 0.75 });
const tan = () => mat('gt', 0x9b8a62, { r: 0.8 });
const skin = () => mat('skin', 0xd0a07c, { r: 0.8 });
const cloth = (c) => mat('cl' + c, c, { r: 0.9 });

// ---------- נשקים ----------
// הכיוון: הלוע ב-Z שלילי. userData.muzzle = נקודת היציאה, userData.grip = יד ימין, userData.fore = יד שמאל
export function buildWeapon(id) {
  const g = new THREE.Group();
  const W = WEAPONS[id];
  const add = (m) => { g.add(m); return m; };
  const dark = gunMetal(), lt = gunLight(), pl = polymer();
  let muzzleZ = -0.5, foreZ = -0.25, gripZ = 0.02;
  const grip = (z = 0.04, h = 0.14) => { const m = add(box(0.035, h, 0.05, pl, 0, -0.08, z)); m.rotation.x = 0.25; };
  const mag = (z, h, d = 0.04, m = dark) => { const mm = add(box(d, h, 0.07, m, 0, -0.1, z)); mm.rotation.x = 0.1; };
  switch (W.cls) {
    case 'pistol': {
      add(box(0.04, 0.05, 0.2, id === 'deagle' ? lt : dark, 0, 0.03, -0.08));
      grip(0.0, 0.12);
      muzzleZ = -0.19; foreZ = -0.05; gripZ = 0.0;
      if (id === 'deagle') add(box(0.045, 0.06, 0.24, lt, 0, 0.03, -0.1));
      break;
    }
    case 'smg': {
      add(box(0.05, 0.08, 0.34, dark, 0, 0.02, -0.12));
      add(box(0.04, 0.04, 0.2, lt, 0, 0.03, -0.38));
      grip(0.05); mag(-0.12, id === 'uzi' ? 0.2 : 0.17);
      add(box(0.03, 0.06, 0.14, pl, 0, 0.0, 0.2));
      muzzleZ = -0.5; foreZ = -0.28;
      break;
    }
    case 'ar':
    case 'lmg': {
      const wd = id === 'akm' || id === 'groza' ? wood() : pl;
      add(box(0.055, 0.085, 0.42, dark, 0, 0.02, -0.12));
      add(box(0.05, 0.055, 0.34, wd === pl ? lt : wd, 0, 0.015, -0.46));
      add(box(0.02, 0.02, 0.28, lt, 0, 0.06, -0.52));
      add(box(0.045, 0.1, 0.3, wd, 0, -0.005, 0.28));
      grip(0.08); mag(-0.1, W.cls === 'lmg' ? 0.22 : 0.22, W.cls === 'lmg' ? 0.11 : 0.04);
      if (id === 'm416' || id === 'scar') add(box(0.02, 0.03, 0.2, dark, 0, 0.075, -0.1));
      muzzleZ = -0.78; foreZ = -0.46;
      break;
    }
    case 'dmr':
    case 'sr': {
      const wd = wood();
      add(box(0.05, 0.075, 0.5, dark, 0, 0.02, -0.15));
      add(box(0.04, 0.05, 0.45, id === 'awm' ? mat('awm', 0x3f5236, { r: 0.6 }) : wd, 0, 0.01, -0.55));
      add(box(0.05, 0.1, 0.3, id === 'awm' ? mat('awm', 0x3f5236) : wd, 0, -0.01, 0.32));
      grip(0.1); mag(-0.12, 0.1, 0.035);
      add(box(0.02, 0.02, 0.2, lt, 0, 0.03, -0.9));
      if (W.cls === 'sr') { const sc = add(cyl(0.025, 0.025, 0.3, dark, 8)); sc.rotation.x = Math.PI / 2; sc.position.set(0, 0.095, -0.1); }
      muzzleZ = id === 'awm' ? -1.05 : -0.98; foreZ = -0.6;
      break;
    }
    case 'sg': {
      add(box(0.055, 0.08, 0.4, dark, 0, 0.02, -0.1));
      const b = add(cyl(0.022, 0.022, 0.5, lt, 8)); b.rotation.x = Math.PI / 2; b.position.set(0, 0.035, -0.5);
      add(box(0.05, 0.05, 0.2, wood(), 0, -0.01, -0.42));
      add(box(0.045, 0.1, 0.3, wood(), 0, -0.01, 0.28));
      grip(0.08);
      muzzleZ = -0.78; foreZ = -0.42;
      break;
    }
  }
  g.userData = { muzzle: new THREE.Vector3(0, 0.03, muzzleZ), fore: new THREE.Vector3(0, -0.02, foreZ), grip: new THREE.Vector3(0, -0.04, gripZ), len: -muzzleZ };
  return g;
}

export function buildGrenade(kind) {
  const g = new THREE.Group();
  if (kind === 'frag') {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), mat('frag', 0x4b5a35, { r: 0.6 })); b.scale.y = 1.2; b.castShadow = true; g.add(b);
    g.add(box(0.012, 0.03, 0.012, mat('pin', 0x999999), 0, 0.075, 0));
    g.add(box(0.012, 0.012, 0.05, mat('pin', 0x999999), 0, 0.08, -0.02));
  } else if (kind === 'smoke') {
    const c = cyl(0.04, 0.04, 0.14, mat('smk', 0x8a8e93, { r: 0.5 }), 12); g.add(c);
    g.add(box(0.085, 0.02, 0.085, mat('smkb', 0x3a3d40), 0, 0.075, 0));
  } else if (kind === 'stun') {
    const c = cyl(0.035, 0.035, 0.13, mat('stn', 0x2c2f35, { r: 0.4, m: 0.5 }), 12); g.add(c);
    g.add(box(0.075, 0.02, 0.075, mat('stnb', 0x9aa0a8), 0, 0.075, 0));
  } else {
    const b = cyl(0.04, 0.045, 0.14, mat('mol', 0x6c8a46, { r: 0.2, extra: { transparent: true, opacity: 0.8 } }), 10); g.add(b);
    const n = cyl(0.015, 0.02, 0.07, mat('mol', 0x6c8a46), 8); n.position.y = 0.1; g.add(n);
    g.add(box(0.035, 0.05, 0.035, mat('rag', 0xdddddd), 0, 0.15, 0));
  }
  return g;
}

// ---------- דמות ----------
const HELM_MATS = [null, () => mat('h1', 0xeeeeee, { r: 0.3, m: 0.1 }), () => mat('h2', 0x5b6b3a, { r: 0.65 }), () => mat('h3', 0x1d2024, { r: 0.4, m: 0.3 })];
const VEST_MATS = [null, () => mat('v1', 0x2a2e36), () => mat('v2', 0x1f2a42), () => mat('v3', 0x6d6a45)];
const PACK_MATS = [null, () => mat('p1', 0xc9b58a), () => mat('p2', 0x56743c), () => mat('p3', 0x3a452c)];

export function buildCharacter(color) {
  const root = new THREE.Group(); // רשות ל-yaw
  const body = new THREE.Group(); root.add(body); // לשכיבה/כריעה
  const shirt = mat('shirt' + color, color, { r: 0.85 });
  const pants = mat('pants', 0x3a3f4a, { r: 0.9 });
  const boots = mat('boots', 0x1c1b1a, { r: 0.7 });

  // רגליים
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(0.1 * s, 0.9, 0);
    const thigh = box(0.17, 0.47, 0.2, pants, 0, -0.23, 0); hip.add(thigh);
    const knee = new THREE.Group(); knee.position.set(0, -0.46, 0); hip.add(knee);
    knee.add(box(0.15, 0.4, 0.18, pants, 0, -0.2, 0));
    knee.add(box(0.16, 0.1, 0.27, boots, 0, -0.42, -0.04));
    body.add(hip); legs.push({ hip, knee });
  }
  // פלג גוף עליון
  const upper = new THREE.Group(); upper.position.set(0, 0.9, 0); body.add(upper);
  upper.add(box(0.4, 0.58, 0.24, shirt, 0, 0.3, 0));
  upper.add(box(0.42, 0.14, 0.26, pants, 0, 0.02, 0));
  // ראש
  const head = new THREE.Group(); head.position.set(0, 0.76, 0); upper.add(head);
  const hd = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 12), skin()); hd.castShadow = true; hd.scale.set(0.95, 1.1, 1); head.add(hd);
  head.add(box(0.06, 0.05, 0.05, skin(), 0, -0.1, 0));
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), mat('hair', 0x2b2118, { r: 0.95 })); hair.position.y = 0.01; head.add(hair);
  // קסדה (מוחלפת לפי רמה)
  const helmetSlot = new THREE.Group(); head.add(helmetSlot);
  // אפוד
  const vestSlot = new THREE.Group(); upper.add(vestSlot);
  // תיק
  const packSlot = new THREE.Group(); upper.add(packSlot);
  // זרועות + נשק
  const wslot = new THREE.Group(); wslot.position.set(0.16, 0.45, -0.28); upper.add(wslot);
  const mkArm = () => {
    const a = new THREE.Group();
    a.add(box(0.11, 0.3, 0.11, shirt, 0, -0.15, 0));
    const fore = new THREE.Group(); fore.position.y = -0.3; a.add(fore);
    fore.add(box(0.1, 0.28, 0.1, shirt, 0, -0.13, 0));
    fore.add(box(0.09, 0.09, 0.09, mat('gloves', 0x25272a, { r: 0.9 }), 0, -0.3, 0));
    a.userData.fore = fore;
    return a;
  };
  const armR = mkArm(), armL = mkArm();
  armR.position.set(0.25, 0.54, 0); armL.position.set(-0.25, 0.54, 0);
  upper.add(armR, armL);

  const ch = { root, body, legs, upper, head, armR, armL, wslot, weapon: null, wid: null, phase: 0, stance: 0, eq: { h: -1, v: -1, p: -1 }, aimPitch: 0, firing: 0, wRoot: null, throwT: 0 };

  ch.setEquip = (h, v, p) => {
    if (h !== ch.eq.h) {
      ch.eq.h = h; helmetSlot.clear();
      if (h > 0) {
        const m = HELM_MATS[h]();
        const dome = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10, 0, Math.PI * 2, 0, Math.PI * (h === 1 ? 0.62 : 0.55)), m); dome.castShadow = true; dome.position.y = 0.01; helmetSlot.add(dome);
        if (h === 1) { const visor = box(0.2, 0.06, 0.08, mat('vis', 0x111a24, { r: 0.1, m: 0.5 }), 0, 0.01, -0.12); helmetSlot.add(visor); }
        if (h === 2) { const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.015, 14), m); brim.position.y = 0.0; helmetSlot.add(brim); helmetSlot.add(box(0.1, 0.02, 0.1, mat('hnet', 0x3f4a2a), 0, 0.15, 0)); }
        if (h === 3) { helmetSlot.add(box(0.18, 0.1, 0.05, mat('h3v', 0x0b0c0e, { r: 0.2, m: 0.5 }), 0, -0.03, -0.13)); const rail = box(0.02, 0.02, 0.2, mat('h3r', 0x2c3036), 0.14, 0.04, -0.02); helmetSlot.add(rail); }
      }
    }
    if (v !== ch.eq.v) {
      ch.eq.v = v; vestSlot.clear();
      if (v > 0) {
        const m = VEST_MATS[v]();
        vestSlot.add(box(0.46, 0.5, 0.29, m, 0, 0.32, 0));
        const pm = mat('vp' + v, [0, 0x23262c, 0x151c2e, 0x57543a][v], { r: 0.8 });
        for (const s of [-1, 0, 1]) vestSlot.add(box(0.11, 0.12, 0.05, pm, 0.13 * s, 0.17, -0.16));
        if (v >= 2) vestSlot.add(box(0.3, 0.22, 0.04, mat('plate' + v, 0x2e3238, { r: 0.5, m: 0.3 }), 0, 0.42, -0.16));
        if (v === 3) { for (const s of [-1, 1]) vestSlot.add(box(0.07, 0.09, 0.06, pm, 0.21 * s, 0.35, -0.12)); vestSlot.add(box(0.3, 0.09, 0.05, pm, 0, 0.58, 0.14)); }
        vestSlot.add(box(0.14, 0.03, 0.3, m, 0.18, 0.58, 0)); vestSlot.add(box(0.14, 0.03, 0.3, m, -0.18, 0.58, 0));
      }
    }
    if (p !== ch.eq.p) {
      ch.eq.p = p; packSlot.clear();
      if (p > 0) {
        const m = PACK_MATS[p]();
        const sz = [0, [0.3, 0.36, 0.14], [0.34, 0.46, 0.2], [0.38, 0.58, 0.26]][p];
        packSlot.add(box(sz[0], sz[1], sz[2], m, 0, 0.33 + (sz[1] - 0.36) * 0.1, 0.12 + sz[2] / 2));
        packSlot.add(box(sz[0] * 0.8, sz[1] * 0.35, 0.06, mat('pp' + p, 0x24291c, { r: 0.9 }), 0, 0.22, 0.14 + sz[2] + 0.02));
        if (p >= 2) for (const s of [-1, 1]) packSlot.add(box(0.07, 0.2, 0.08, m, (sz[0] / 2 + 0.03) * s, 0.28, 0.2));
        if (p === 3) packSlot.add(box(sz[0] * 0.9, 0.12, 0.2, mat('pr', 0x6a5a3a), 0, 0.33 + sz[1] / 2 + 0.05, 0.28));
      }
    }
  };
  ch.setWeapon = (wid, grenade) => {
    const key = grenade ? 'g:' + grenade : wid;
    if (key === ch.wid) return;
    ch.wid = key;
    wslot.clear(); ch.weapon = null; ch.grenade = null;
    if (grenade) { const g = buildGrenade(grenade); g.position.set(-0.05, -0.1, -0.1); wslot.add(g); ch.grenade = g; return; }
    if (wid) { const w = buildWeapon(wid); wslot.add(w); ch.weapon = w; }
  };
  ch.setEquip(0, 0, 0); ch.setWeapon(null);
  ch.hasWeapon = () => !!(ch.weapon || ch.grenade);

  // מצב: speed אופקי, stance 0/1/2, pitch של מבט, מצב (0 קרקע, 2 צניחה, 3 מצנח), firing recoil
  ch.animate = (dt, speed, stance, pitch, pst, moving, recoil) => {
    ch.stance = stance;
    const sw = Math.min(1, speed / 6);
    ch.phase += dt * (3 + speed * 1.8);
    const p = ch.phase;
    const hold = ch.hasWeapon();
    if (pst === 2) {
      // צניחה חופשית: שכיבה אופקית כמו צנחן
      body.rotation.x = -1.35; body.position.set(0, 1.4, 0);
      for (const l of legs) { l.hip.rotation.x = 0.25; l.knee.rotation.x = 0.3; }
      armR.rotation.set(-0.3, 0, -0.9); armL.rotation.set(-0.3, 0, 0.9);
      wslot.visible = false;
      return;
    }
    wslot.visible = true;
    if (pst === 3) {
      body.rotation.x = 0; body.position.set(0, 0, 0);
      legs[0].hip.rotation.x = -0.15; legs[1].hip.rotation.x = 0.1; legs[0].knee.rotation.x = 0.1; legs[1].knee.rotation.x = 0.25;
      armR.rotation.set(-2.6, 0, -0.2); armL.rotation.set(-2.6, 0, 0.2);
      upper.rotation.x = 0; head.rotation.x = 0;
      return;
    }
    if (stance === 2) {
      body.rotation.x = -Math.PI / 2 + 0.06; body.position.set(0, 0.17, 0.0);
      const sw2 = moving ? Math.sin(p * 0.7) * 0.35 : 0;
      legs[0].hip.rotation.x = sw2; legs[1].hip.rotation.x = -sw2; legs[0].knee.rotation.x = 0; legs[1].knee.rotation.x = 0;
      head.rotation.x = Math.PI / 2 - 0.2 + clampv(pitch, -0.6, 0.5) * 0.4;
      upper.rotation.x = 0;
    } else {
      body.rotation.x = 0; body.position.set(0, stance === 1 ? -0.38 : 0, 0);
      const amp = sw * (stance === 1 ? 0.5 : 0.9);
      const a = Math.sin(p) * amp;
      legs[0].hip.rotation.x = a - (stance === 1 ? 0.9 : 0); legs[1].hip.rotation.x = -a - (stance === 1 ? 0.9 : 0);
      legs[0].knee.rotation.x = (Math.max(0, -Math.sin(p)) * 0.9 * sw) + (stance === 1 ? 1.6 : 0);
      legs[1].knee.rotation.x = (Math.max(0, Math.sin(p)) * 0.9 * sw) + (stance === 1 ? 1.6 : 0);
      upper.rotation.x = sw * 0.07 + (stance === 1 ? 0.15 : 0);
      upper.position.y = 0.9 + Math.abs(Math.sin(p)) * 0.025 * sw;
      head.rotation.x = clampv(pitch, -1, 1) * 0.6 - upper.rotation.x;
    }
    // זרועות
    if (hold) {
      const pitchA = clampv(pitch, -1.2, 1.2) * 0.5;
      wslot.rotation.x = pitchA + recoil * 0.05;
      wslot.position.z = -0.28 + recoil * 0.06;
      const forward = -Math.PI / 2 + pitchA;
      // יד ימין על האחיזה, יד שמאל על הידית הקדמית
      armR.rotation.set(forward + 0.15, 0, -0.1); armR.userData.fore.rotation.x = -0.9;
      armL.rotation.set(forward + 0.35, 0, 0.5); armL.userData.fore.rotation.x = -0.4;
      if (ch.grenade) { armL.rotation.set(0.1, 0, 0); armL.userData.fore.rotation.x = -0.2; armR.rotation.set(-1.4, 0, -0.1); armR.userData.fore.rotation.x = -1.3; }
      if (ch.throwT > 0) { ch.throwT -= dt; armR.rotation.x = -2.6 + (0.5 - ch.throwT) * 5; }
    } else {
      armR.rotation.set(-Math.sin(p) * sw * 0.9, 0, -0.05); armR.userData.fore.rotation.x = -0.25;
      armL.rotation.set(Math.sin(p) * sw * 0.9, 0, 0.05); armL.userData.fore.rotation.x = -0.25;
    }
  };
  ch.dispose = () => { root.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); };
  return ch;
}
const clampv = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------- מטוס ----------
// המטוס (הרקולס) בנוי ב-plane.js מגאומטריה מאוחדת; כאן רק מייצאים אותו כדי ש-game.js ימשיך לייבא מ-models.js
export { buildPlane } from './plane.js';

export function buildParachute() {
  const g = new THREE.Group();
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(3.2, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), mat('chute', 0xe84b3a, { r: 0.8, extra: { side: THREE.DoubleSide } }));
  canopy.position.y = 5; canopy.scale.y = 0.75; g.add(canopy);
  const lineM = new THREE.LineBasicMaterial({ color: 0xdddddd });
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(Math.cos(a) * 3.1, 5.1, Math.sin(a) * 3.1), new THREE.Vector3(0, 1.7, 0)]);
    g.add(new THREE.Line(geo, lineM));
  }
  return g;
}

export function buildAirdrop() {
  const g = new THREE.Group();
  const c = box(1.5, 1.1, 1.5, mat('adc', 0x2f6e8f, { r: 0.5, m: 0.3 }), 0, 0.55, 0); g.add(c);
  g.add(box(1.56, 0.12, 1.56, mat('adt', 0xf0f0f0), 0, 1.1, 0));
  g.add(box(1.56, 0.12, 1.56, mat('adt', 0xf0f0f0), 0, 0.0, 0));
  for (const s of [-1, 1]) g.add(box(0.1, 1.1, 1.56, mat('adr', 0xd9462c), 0.5 * s, 0.55, 0));
  const chute = buildParachute(); chute.position.y = 1.1; g.add(chute); g.userData.chute = chute;
  return g;
}

// ---------- פריט לוט על הקרקע ----------
const RARE = { 1: 0xcfd6dc, 2: 0x4aa3ff, 3: 0xc65bff, 4: 0xffb23a };
export function itemRarity(k) {
  const [a, b] = k.split(':');
  if (a === 'w') { const c = WEAPONS[b].cls; return c === 'sr' && b === 'awm' ? 4 : (c === 'ar' || c === 'dmr' || c === 'sr' || c === 'lmg') ? 3 : c === 'smg' || c === 'sg' ? 2 : 1; }
  if (a === 'a') return 1;
  if (a === 'm') return b === 'kit' || b === 'adren' ? 3 : 2;
  if (a === 't') return b === 'frag' ? 2 : 1;
  if (a === 's') return b === 'x8' ? 4 : b === 'x4' ? 3 : 2;
  const lvl = +k[1];
  return lvl === 3 ? 4 : lvl === 2 ? 3 : 2;
}
export function buildLootMesh(k) {
  const g = new THREE.Group();
  const info = itemInfo(k);
  const inner = new THREE.Group(); g.add(inner);
  const rc = RARE[itemRarity(k)];
  if (info.type === 'weapon') { const w = buildWeapon(info.id); w.scale.setScalar(1.35); w.rotation.y = Math.PI / 2; inner.add(w); inner.position.y = 0.3; }
  else if (info.type === 'ammo') { inner.add(box(0.24, 0.12, 0.18, mat('am' + info.id, AMMO[info.id].color, { r: 0.5, m: 0.3 }), 0, 0.1, 0)); inner.add(box(0.25, 0.04, 0.19, mat('amb', 0x222222), 0, 0.17, 0)); }
  else if (info.type === 'med') {
    const c = { band: 0xf2f2f2, aid: 0xe84a3a, kit: 0xd23a3a, drink: 0x3ac2e8, pain: 0xe8d23a, adren: 0xf08a2a }[info.id];
    inner.add(box(0.26, 0.15, 0.2, mat('md' + info.id, c, { r: 0.5 }), 0, 0.12, 0));
    if (info.id !== 'drink' && info.id !== 'pain' && info.id !== 'adren') { inner.add(box(0.12, 0.02, 0.03, mat('mdx', 0xffffff), 0, 0.2, 0)); inner.add(box(0.03, 0.02, 0.12, mat('mdx', 0xffffff), 0, 0.2, 0)); }
  } else if (info.type === 'throw') { const t = buildGrenade(info.id); t.scale.setScalar(1.6); t.position.y = 0.18; inner.add(t); }
  else if (info.type === 'scope') { const s = cyl(0.04, 0.05, 0.24, mat('sc', 0x222428, { r: 0.3, m: 0.6 }), 10); s.rotation.z = Math.PI / 2; s.position.y = 0.12; inner.add(s); }
  else if (info.type === 'helmet') {
    const m = HELM_MATS[info.lvl]();
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), m); d.position.y = 0.15; d.castShadow = true; inner.add(d);
  } else if (info.type === 'vest') {
    inner.add(box(0.36, 0.4, 0.14, VEST_MATS[info.lvl](), 0, 0.25, 0));
    inner.add(box(0.26, 0.15, 0.05, mat('vp' + info.lvl, [0, 0x23262c, 0x151c2e, 0x57543a][info.lvl]), 0, 0.28, -0.08));
  } else if (info.type === 'pack') {
    const sz = [0, 0.34, 0.44, 0.56][info.lvl];
    inner.add(box(0.34, sz, 0.2, PACK_MATS[info.lvl](), 0, sz / 2 + 0.05, 0));
  }
  inner.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.4, 20), new THREE.MeshBasicMaterial({ color: rc, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; g.add(ring);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.15, 1.6, 8, 1, true), new THREE.MeshBasicMaterial({ color: rc, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = 0.9; g.add(beam);
  // חשוב: userData חייב להיות בטוח ל-JSON (three משכפל אותו ב-clone). את ההפניות לחלקים מוסיפים אחרי השכפול ב-game.js.
  g.userData = { ph: Math.random() * 6.28 };
  return g;
}
