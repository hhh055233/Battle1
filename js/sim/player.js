// תנועת שחקן/בוט (משותף ללקוח ול-host) וקידוד חבילות.
import { PHYS, MAP, WEAPON_IDS } from './data.js';
import { clamp } from './util.js';

export function newBody(x = 0, y = 0, z = 0) {
  return { x, y, z, vx: 0, vy: 0, vz: 0, r: PHYS.R, h: PHYS.height[0], onGround: false, yaw: 0, pitch: 0, stance: 0 };
}

// inp: {f,s,sprint,jump,stance,mul}
export function stepWalk(p, inp, dt, world) {
  p.stance = inp.stance | 0;
  p.h = PHYS.height[p.stance];
  const wading = p.y < -0.6;
  let sp = p.stance === 2 ? PHYS.speed.prone : p.stance === 1 ? PHYS.speed.crouch : (inp.sprint && inp.f > 0.3 ? PHYS.speed.sprint : PHYS.speed.walk);
  if (wading) sp *= 0.55;
  sp *= inp.mul || 1;
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
  let wx = fx * inp.f + rx * inp.s, wz = fz * inp.f + rz * inp.s;
  const wl = Math.hypot(wx, wz);
  if (wl > 1) { wx /= wl; wz /= wl; }
  const tx = wx * sp, tz = wz * sp;
  const k = p.onGround ? Math.min(1, 12 * dt) : Math.min(1, 1.6 * dt);
  p.vx += (tx - p.vx) * k; p.vz += (tz - p.vz) * k;
  if (p.onGround && inp.jump && p.stance < 2 && !wading) { p.vy = PHYS.JUMP; p.onGround = false; }
  world.moveBody(p, dt);
  p.x = clamp(p.x, -MAP.half - 60, MAP.half + 60);
  p.z = clamp(p.z, -MAP.half - 60, MAP.half + 60);
}

// ---------- קידוד בינארי ----------
// רשומה: idx u8 | x i16 | y i16 | z i16 | yaw u8 | pitch i8 | flags u8 | weapon u8 | equip u8   = 13 בתים
export const REC = 13;
export const FL = { MOVING: 4, SPRINT: 8, ADS: 16, FIRE: 32, RELOAD: 64, DEAD: 128 };
// state נשמר ב-wid המשולב: bits 0-4 weapon index (0 = אגרוף, 31 = רימון), bits 5-6 state (0 קרקע,1 מטוס,2 צניחה חופשית,3 מצנח)
export const wIndex = (id) => (id ? WEAPON_IDS.indexOf(id) + 1 : 0);
export const wFromIndex = (i) => (i > 0 && i <= WEAPON_IDS.length ? WEAPON_IDS[i - 1] : null);

export function writeRec(dv, o, p) {
  dv.setUint8(o, p.idx);
  dv.setInt16(o + 1, Math.round(clamp(p.x, -1600, 1600) * 20), true);
  dv.setInt16(o + 3, Math.round(clamp(p.y, -200, 1500) * 20), true);
  dv.setInt16(o + 5, Math.round(clamp(p.z, -1600, 1600) * 20), true);
  let yaw = p.yaw % (Math.PI * 2); if (yaw < 0) yaw += Math.PI * 2;
  dv.setUint8(o + 7, Math.round(yaw / (Math.PI * 2) * 255));
  dv.setInt8(o + 8, Math.round(clamp(p.pitch, -1.5, 1.5) / 1.5 * 127));
  dv.setUint8(o + 9, (p.stance & 3) | (p.fl & 0xfc));
  dv.setUint8(o + 10, (wIndex(p.wid) & 31) | ((p.pst & 3) << 5));
  dv.setUint8(o + 11, (p.eh & 3) | ((p.ev & 3) << 2) | ((p.ep & 3) << 4));
  dv.setUint8(o + 12, 0);
}
export function readRec(dv, o) {
  const f = dv.getUint8(o + 9), w = dv.getUint8(o + 10), e = dv.getUint8(o + 11);
  return {
    idx: dv.getUint8(o),
    x: dv.getInt16(o + 1, true) / 20, y: dv.getInt16(o + 3, true) / 20, z: dv.getInt16(o + 5, true) / 20,
    yaw: dv.getUint8(o + 7) / 255 * Math.PI * 2, pitch: dv.getInt8(o + 8) / 127 * 1.5,
    stance: f & 3, fl: f & 0xfc, wid: wFromIndex(w & 31), pst: (w >> 5) & 3,
    eh: e & 3, ev: (e >> 2) & 3, ep: (e >> 4) & 3,
  };
}
export function packSnapshot(mt, alive, recs) {
  const buf = new ArrayBuffer(8 + recs.length * REC);
  const dv = new DataView(buf);
  dv.setUint8(0, 1); dv.setUint8(1, alive); dv.setFloat32(2, mt, true); dv.setUint16(6, recs.length, true);
  recs.forEach((r, i) => writeRec(dv, 8 + i * REC, r));
  return buf;
}
export function unpackSnapshot(buf) {
  const dv = new DataView(buf);
  const n = dv.getUint16(6, true), out = [];
  for (let i = 0; i < n; i++) out.push(readRec(dv, 8 + i * REC));
  return { mt: dv.getFloat32(2, true), alive: dv.getUint8(1), recs: out };
}
export function packState(p) {
  const buf = new ArrayBuffer(1 + REC);
  const dv = new DataView(buf);
  dv.setUint8(0, 2); writeRec(dv, 1, p);
  return buf;
}
export function unpackState(buf) { return readRec(new DataView(buf), 1); }
