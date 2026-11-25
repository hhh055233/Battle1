// מודלים תלת-ממדיים מפרימיטיבים: דמויות ריאליסטיות עם קסדה/אפוד/תיק, נשקים, רימונים, מטוס, חבילת אספקה ופריטי לוט.
import * as THREE from 'three';
import { makeBody } from './character.js';
import { DEFAULT_LOOK, sanitizeLook } from '../sim/look.js';
import { gearGroup, packMount, packStrapGroup } from './gear.js';
import { buildWeapon } from './weapons.js';
import { WEAPONS, HELMET, VEST, PACK, AMMO, THROWS, itemInfo } from '../sim/data.js';

const M = {}; // מטריאלים משותפים
const mat = (key, color, o = {}) => (M[key] ||= new THREE.MeshStandardMaterial({ color, roughness: o.r ?? 0.7, metalness: o.m ?? 0.0, ...(o.extra || {}) }));
const box = (w, h, d, m, x = 0, y = 0, z = 0) => { const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); g.position.set(x, y, z); g.castShadow = true; return g; };
const cyl = (r1, r2, h, m, seg = 10) => { const g = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), m); g.castShadow = true; return g; };

const skin = () => mat('skin', 0xd0a07c, { r: 0.8 });
const cloth = (c) => mat('cl' + c, c, { r: 0.9 });

// ---------- נשקים ----------
// הדגמים המפורטים בנויים ב-weapons.js; כאן רק מייצאים אותם כדי ש-game.js ימשיך לייבא מ-models.js
// userData: muzzle=יציאת הקליע, grip=אגרוף ימין, fore=אגרוף שמאל, sightY=גובה קו הכוונה, cz/zlen=מרכז ואורך לאורך Z
export { buildWeapon };

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

// ---- IK של זרוע בת שני חלקים ----
// מוסכמות: הדמות מביטה ל-Z שלילי, ימין = X חיובי. סיבוב חיובי סביב X מניע גף תלוי קדימה (פלג עליון ירך זרוע), ואילו ברך חייבת להתכופף בסיבוב שלילי.
// הזרוע (קבוצה) תלויה לאורך Y שלילי; האמה מתכופפת סביב ציר ה-X המקומי של הזרוע. לפי כתף S ויעד לאגרוף T (במערכת של upper) ורמז לכיוון המרפק
// מחשבים אוילר XYZ לזרוע וכיפוף מרפק כך שהאגרוף נוחת על היעד (נחתך לטווח הזרוע).
const ARM_SC = 1.1, ARM_U = 0.3 * ARM_SC, ARM_F = 0.345 * ARM_SC;
const SH_R = [0.25, 0.54, 0], SH_L = [-0.25, 0.54, 0];
const HINT_R = [0.5, -1, 0.25], HINT_L = [-0.5, -1, 0.25], HINT_RP = [0.9, 0, -0.5], HINT_LP = [-0.9, 0, -0.5];
function aimArm(arm, S, T, hint) {
  const dx = T[0] - S[0], dy = T[1] - S[1], dz = T[2] - S[2];
  const d0 = Math.hypot(dx, dy, dz) || 1e-6, ux = dx / d0, uy = dy / d0, uz = dz / d0;
  const d = Math.min(ARM_U + ARM_F - 0.004, Math.max(Math.abs(ARM_U - ARM_F) + 0.03, d0));
  const ca = (ARM_U * ARM_U + d * d - ARM_F * ARM_F) / (2 * ARM_U * d), sa = Math.sqrt(Math.max(0, 1 - ca * ca));
  let hx = hint[0], hy = hint[1], hz = hint[2];
  const hd = hx * ux + hy * uy + hz * uz; hx -= ux * hd; hy -= uy * hd; hz -= uz * hd;
  let hl = Math.hypot(hx, hy, hz);
  if (hl < 1e-4) { hx = -uy; hy = ux; hz = 0; hl = Math.hypot(hx, hy); if (hl < 1e-4) { hx = 1; hy = 0; hl = 1; } }
  hx /= hl; hy /= hl; hz /= hl;
  const ex = S[0] + (ux * ca + hx * sa) * ARM_U, ey = S[1] + (uy * ca + hy * sa) * ARM_U, ez = S[2] + (uz * ca + hz * sa) * ARM_U;
  let ax = ex - S[0], ay = ey - S[1], az = ez - S[2]; const al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
  let fx = S[0] + ux * d - ex, fy = S[1] + uy * d - ey, fz = S[2] + uz * d - ez; const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
  const Yx = -ax, Yy = -ay, Yz = -az; // ציר Y המקומי מצביע נגד כיוון הזרוע
  let Xx = uy * hz - uz * hy, Xy = uz * hx - ux * hz, Xz = ux * hy - uy * hx; // נורמל מישור הכיפוף
  let Zx = Xy * Yz - Xz * Yy, Zy = Xz * Yx - Xx * Yz, Zz = Xx * Yy - Xy * Yx;
  if (fx * Zx + fy * Zy + fz * Zz > 0) { Xx = -Xx; Xy = -Xy; Xz = -Xz; Zx = -Zx; Zy = -Zy; Zz = -Zz; } // כיפוף מרפק תמיד קדימה
  const phi = Math.atan2(-(fx * Zx + fy * Zy + fz * Zz), -(fx * Yx + fy * Yy + fz * Yz));
  const m13 = Zx, ry = Math.asin(m13 < -1 ? -1 : m13 > 1 ? 1 : m13);
  let rx, rz;
  if (Math.abs(m13) < 0.9999999) { rx = Math.atan2(-Zy, Zz); rz = Math.atan2(-Yx, Xx); } else { rx = Math.atan2(Yz, Yy); rz = 0; }
  arm.rotation.set(rx, ry, rz);
  arm.userData.fore.rotation.set(phi, 0, 0);
}
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// גף תחתון: ירך (hip), ברך (שלילי = כיפוף אחורה), זווית כף הרגל בעולם (0 = שטוחה), פיסוק לצד
const legPose = (l, hip, knee, foot, spread) => { l.hip.rotation.set(hip, 0, spread || 0); l.knee.rotation.set(knee, 0, 0); l.ankle.rotation.set(foot - hip - knee, 0, 0); };

export function buildCharacter(color, look) {
  const root = new THREE.Group(); // רשות ל-yaw
  const body = new THREE.Group(); root.add(body); // לשכיבה/כריעה
  const parts = makeBody(look || DEFAULT_LOOK);

  // רגליים: ירך -> ברך -> קרסול (כף הרגל נפרדת כדי שתישאר שטוחה על הקרקע). הגאומטריה משותפת לשתי הרגליים
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(0.1 * s, 0.9, 0);
    hip.add(new THREE.Mesh(parts.thigh.geometry, parts.thigh.material));
    const knee = new THREE.Group(); knee.position.set(0, -0.45, 0); hip.add(knee);
    knee.add(new THREE.Mesh(parts.shin.geometry, parts.shin.material));
    const ankle = new THREE.Group(); ankle.position.set(0, -0.34, 0); knee.add(ankle);
    const foot = new THREE.Mesh(parts.foot.geometry, parts.foot.material); foot.position.y = 0.34; ankle.add(foot);
    body.add(hip); legs.push({ hip, knee, ankle });
  }
  // פלג גוף עליון
  const upper = new THREE.Group(); upper.position.set(0, 0.9, 0); body.add(upper);
  upper.add(parts.torso);
  // ראש
  const head = new THREE.Group(); head.position.set(0, 0.78, 0); upper.add(head);
  head.add(parts.head); head.scale.setScalar(1.1);
  const hairMesh = parts.hair; if (hairMesh) head.add(hairMesh);
  // קסדה (מוחלפת לפי רמה)
  const helmetSlot = new THREE.Group(); head.add(helmetSlot);
  // אפוד
  const vestSlot = new THREE.Group(); upper.add(vestSlot);
  // תיק
  const packSlot = new THREE.Group(); upper.add(packSlot);
  // זרועות + נשק (מיקום ה-wslot נקבע בכל פריים לפי ה-IK של האחיזה)
  const wslot = new THREE.Group(); wslot.position.set(0.1, 0.42, -0.3); upper.add(wslot);
  const mkArm = (k) => {
    const a = new THREE.Group();
    const um = parts.armU[k]; um.scale.y = ARM_SC; a.add(um);
    const fore = new THREE.Group(); fore.position.y = -0.3 * ARM_SC; a.add(fore);
    const fm = parts.armF[k]; fm.scale.y = ARM_SC; fore.add(fm);
    a.userData.fore = fore;
    return a;
  };
  const armR = mkArm(0), armL = mkArm(1);
  armR.position.set(SH_R[0], SH_R[1], SH_R[2]); armL.position.set(SH_L[0], SH_L[1], SH_L[2]);
  upper.add(armR, armL);

  const ch = { root, body, legs, upper, head, armR, armL, wslot, weapon: null, wid: null, wcls: null, phase: 0, stance: 0, eq: { h: -1, v: -1, p: -1 }, aimPitch: 0, firing: 0, wRoot: null, throwT: 0 };

  const ss = sanitizeLook(look)[3];
  ch.setEquip = (h, v, p) => {
    if (h !== ch.eq.h) {
      ch.eq.h = h; helmetSlot.clear();
      if (h > 0) { helmetSlot.add(gearGroup('helm', h)); helmetSlot.traverse((o) => { if (o.isMesh) o.castShadow = true; }); }
      if (hairMesh) hairMesh.visible = h <= 0; // קסדה מכסה את השיער
    }
    const vc = v !== ch.eq.v, pc = p !== ch.eq.p;
    if (vc) { vestSlot.clear(); if (v > 0) { vestSlot.add(gearGroup('vest', v, ss)); vestSlot.traverse((o) => { if (o.isMesh) o.castShadow = true; }); } }
    if (vc || pc) { // התיק יושב על האפוד, לכן מורכב מחדש גם כשהאפוד משתנה
      ch.eq.v = v; ch.eq.p = p; packSlot.clear();
      if (p > 0) {
        const pk = gearGroup('pack', p, ss), m = packMount(p, ss, v); pk.position.set(m[0], m[1], m[2]); packSlot.add(pk);
        packSlot.add(packStrapGroup(p, ss));
        packSlot.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      }
    }
  };
  ch.setWeapon = (wid, grenade) => {
    const key = grenade ? 'g:' + grenade : wid;
    if (key === ch.wid) return;
    ch.wid = key;
    wslot.clear(); ch.weapon = null; ch.grenade = null; ch.wcls = null;
    if (grenade) { const g = buildGrenade(grenade); g.position.set(0, 0.075, -0.03); wslot.add(g); ch.grenade = g; return; }
    if (wid) { const w = buildWeapon(wid); wslot.add(w); ch.weapon = w; ch.wcls = (WEAPONS[wid] || {}).cls || 'ar'; }
  };
  ch.setEquip(0, 0, 0); ch.setWeapon(null);
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  ch.hasWeapon = () => !!(ch.weapon || ch.grenade);

  // speed: מהירות אופקית, stance: 0 עמידה / 1 כריעה / 2 שכיבה, pitch: זווית מבט, pst: 0 קרקע / 2 צניחה חופשית / 3 מצנח, recoil: בעיטת רתע
  ch.animate = (dt, speed, stance, pitch, pst, moving, recoil) => {
    ch.stance = stance;
    const sw = Math.min(1, speed / 6);
    ch.phase += dt * (3 + speed * 1.8);
    const p = ch.phase;
    upper.position.y = 0.9;
    if (pst === 2) { // צניחה חופשית: שכיבה אופקית על הבטן, זרועות ורגליים פרושות
      body.rotation.set(-1.35, 0, 0); body.position.set(0, 1.4, 0);
      upper.rotation.set(0, 0, 0); head.rotation.set(0.9, 0, 0);
      legPose(legs[0], -0.3, -0.5, -0.5, -0.22); legPose(legs[1], -0.3, -0.5, -0.5, 0.22);
      armR.rotation.set(0, 0, 1.9); armL.rotation.set(0, 0, -1.9);
      armR.userData.fore.rotation.set(-0.5, 0, 0); armL.userData.fore.rotation.set(-0.5, 0, 0);
      wslot.visible = false;
      return;
    }
    if (pst === 3) { // תלוי במצנח: ידיים למעלה על הרצועות, רגליים מתנדנדות
      body.rotation.set(0, 0, 0); body.position.set(0, 0, 0);
      upper.rotation.set(0, 0, 0); head.rotation.set(-0.12, 0, 0);
      const sway = Math.sin(p * 0.35) * 0.07;
      legPose(legs[0], 0.2 + sway, -0.35, -0.55, -0.04); legPose(legs[1], 0.1 - sway, -0.5, -0.55, 0.04);
      armR.rotation.set(0, 0, 2.7); armL.rotation.set(0, 0, -2.7);
      armR.userData.fore.rotation.set(0.35, 0, 0); armL.userData.fore.rotation.set(0.35, 0, 0);
      wslot.visible = false;
      return;
    }
    wslot.visible = true;
    if (stance === 2) { // שכיבה על הבטן (ראש לקדימה)
      body.rotation.set(-Math.PI / 2 + 0.06, 0, 0); body.position.set(0, 0.17, 0);
      const k = moving ? Math.sin(p * 0.7) * 0.35 : 0;
      legPose(legs[0], k, -Math.max(0, k) * 0.7, k - Math.max(0, k) * 0.7, -0.05); legPose(legs[1], -k, -Math.max(0, -k) * 0.7, -k - Math.max(0, -k) * 0.7, 0.05);
      upper.rotation.set(0, 0, 0);
      head.rotation.set(Math.PI / 2 - 0.2 + clampv(pitch, -0.6, 0.5) * 0.4, 0, 0);
    } else if (stance === 1) { // כריעה: ירכיים קדימה, ברכיים מכופפות אחורה, כפות רגליים שטוחות
      body.rotation.set(0, 0, 0); body.position.set(0, -0.38, 0);
      const a = Math.sin(p) * sw * 0.4;
      const fl = (q) => Math.pow(Math.max(0, Math.cos(q + 0.4)), 1.5) * sw * 0.45;
      legPose(legs[0], 1.0 + a, -2.02 - fl(p), 0, -0.05); legPose(legs[1], 1.0 - a, -2.02 - fl(p + Math.PI), 0, 0.05);
      upper.rotation.set(-0.15 - sw * 0.04, 0, 0);
      head.rotation.set(clampv(pitch, -1, 1) * 0.6 - upper.rotation.x, 0, 0);
    } else { // עמידה / הליכה / ריצה
      body.rotation.set(0, 0, 0); body.position.set(0, 0, 0);
      const a = Math.sin(p) * sw * 0.75;
      const fl = (q) => Math.pow(Math.max(0, Math.cos(q + 0.4)), 1.5) * sw;
      const kL = -(0.05 + fl(p)), kR = -(0.05 + fl(p + Math.PI));
      legPose(legs[0], a, kL, sw * (0.3 * Math.sin(p) - 0.12), -0.02); legPose(legs[1], -a, kR, sw * (-0.3 * Math.sin(p) - 0.12), 0.02);
      upper.rotation.set(-sw * 0.07, 0, 0);
      upper.position.y = 0.9 + Math.abs(Math.sin(p)) * 0.025 * sw;
      head.rotation.set(clampv(pitch, -1, 1) * 0.6 - upper.rotation.x, 0, 0);
    }

    // ---- זרועות ----
    const prone = stance === 2;
    if (ch.weapon) {
      // נשק: האגרוף הימני על האחיזה והשמאלי על הידית הקדמית (מיקומים מתוך userData של הדגם), הנשק מוטה לפי זווית המבט
      const U = ch.weapon.userData, pistol = ch.wcls === 'pistol';
      let rotX, tr;
      if (prone) { rotX = Math.PI / 2 + clampv(pitch, -0.7, 0.7) * 0.6 + recoil * 0.05; tr = [0.1, 0.82 - recoil * 0.05, 0.0]; }
      else { rotX = clampv(pitch, -1.2, 1.2) * 0.9 + recoil * 0.05; tr = pistol ? [0.06, 0.55, -0.5 + recoil * 0.05] : [0.06, 0.42, -0.30 + recoil * 0.05]; }
      const c = Math.cos(rotX), s = Math.sin(rotX), g = U.grip, f = U.fore;
      wslot.rotation.set(rotX, 0, 0);
      wslot.position.set(tr[0] - g.x, tr[1] - (g.y * c - g.z * s), tr[2] - (g.y * s + g.z * c));
      aimArm(armR, SH_R, tr, prone ? HINT_RP : HINT_R);
      aimArm(armL, SH_L, [wslot.position.x + f.x, wslot.position.y + f.y * c - f.z * s, wslot.position.z + f.y * s + f.z * c], prone ? HINT_LP : HINT_L);
    } else if (ch.grenade) {
      // רימון ביד ימין; זריקה: התנופה לאחור, שחרור קדימה ומעלה, והמשך תנועה
      let tr = [0.2, 0.44, -0.3], u = 1;
      if (ch.throwT > 0) {
        ch.throwT -= dt; u = 1 - clampv(ch.throwT / 0.5, 0, 1);
        if (u < 0.4) tr = lerp3([0.2, 0.44, -0.3], [0.3, 0.84, 0.24], u / 0.4);
        else if (u < 0.65) tr = lerp3([0.3, 0.84, 0.24], [0.2, 0.64, -0.62], (u - 0.4) / 0.25);
        else tr = lerp3([0.2, 0.64, -0.62], [0.2, 0.3, -0.45], (u - 0.65) / 0.35);
      }
      ch.grenade.visible = u < 0.62 || u >= 0.99;
      wslot.rotation.set(0, 0, 0); wslot.position.set(tr[0], tr[1], tr[2]);
      aimArm(armR, SH_R, tr, prone ? HINT_RP : HINT_R);
      aimArm(armL, SH_L, prone ? [-0.2, 0.9, -0.05] : [-0.19, 0.27, -0.14], prone ? HINT_LP : HINT_L);
    } else if (prone) { // זחילה בלי נשק: ידיים קדימה
      const k = moving ? Math.sin(p * 0.7) * 0.08 : 0;
      aimArm(armR, SH_R, [0.2, 0.92 + k, -0.06], HINT_RP); aimArm(armL, SH_L, [-0.2, 0.92 - k, -0.06], HINT_LP);
    } else { // ידיים פנויות: נדנוד זרועות מנוגד לרגליים (רגל שמאל קדימה = יד ימין קדימה)
      const sa = Math.sin(p) * sw * 0.85, el = 0.22 + sw * 0.45;
      armR.rotation.set(sa, 0, 0.07); armL.rotation.set(-sa, 0, -0.07);
      armR.userData.fore.rotation.set(el + Math.max(0, sa) * 0.5, 0, 0); armL.userData.fore.rotation.set(el + Math.max(0, -sa) * 0.5, 0, 0);
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
  if (info.type === 'weapon') { // הנשק שוכב על הצד (פרופיל כלפי מעלה), ממורכז סביב ציר הסיבוב של הפריט
    const w = buildWeapon(info.id), U = w.userData; w.position.z = -U.cz;
    const pv = new THREE.Group(); pv.add(w); pv.rotation.set(0, Math.PI / 2, Math.PI / 2); pv.scale.setScalar(Math.min(1.5, 1.4 / Math.max(0.3, U.zlen))); pv.position.y = 0.17;
    inner.add(pv);
  }
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
