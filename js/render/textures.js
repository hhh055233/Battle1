// טקסטורות פרוצדורליות (קנבס) - אין צורך בקבצי תמונה.
import * as THREE from 'three';
import { mulberry32 } from '../sim/util.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function tex(c, rx = 1, ry = 1, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function noiseFill(g, w, h, base, amp, rng, step = 1) {
  const [r, gg, b] = base;
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const n = (rng() - 0.5) * amp;
    g.fillStyle = `rgb(${clampC(r + n)},${clampC(gg + n)},${clampC(b + n)})`;
    g.fillRect(x, y, step, step);
  }
}
const clampC = (v) => Math.max(0, Math.min(255, v | 0));

export function makeGrass() {
  const [c, g] = canvas(256, 256);
  const rng = mulberry32(1);
  noiseFill(g, 256, 256, [150, 158, 140], 55, rng, 2);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(${90 + rng() * 60},${120 + rng() * 60},${60 + rng() * 40},0.35)`;
    g.fillRect(rng() * 256, rng() * 256, 1 + rng() * 2, 2 + rng() * 5);
  }
  return tex(c, 220, 220);
}

export function makeAsphalt() {
  const [c, g] = canvas(128, 256);
  const rng = mulberry32(2);
  noiseFill(g, 128, 256, [70, 72, 76], 30, rng, 1);
  // קווי שוליים
  g.fillStyle = 'rgba(230,230,220,0.85)';
  g.fillRect(6, 0, 3, 256); g.fillRect(119, 0, 3, 256);
  // קו מרכז מקווקו
  g.fillStyle = 'rgba(235,200,70,0.9)';
  g.fillRect(62, 20, 4, 90); g.fillRect(62, 148, 4, 90);
  return tex(c, 1, 1);
}

function wallTex(base, kind, seed) {
  const [c, g] = canvas(256, 256);
  const rng = mulberry32(seed);
  noiseFill(g, 256, 256, base, 18, rng, 2);
  if (kind === 'brick') {
    g.strokeStyle = 'rgba(40,30,25,0.45)'; g.lineWidth = 2;
    for (let y = 0; y < 256; y += 16) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke();
      for (let x = (y / 16) % 2 ? 0 : 16; x < 256; x += 32) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 16); g.stroke(); }
    }
  } else if (kind === 'plaster') {
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(0,0,0,${rng() * 0.05})`; g.fillRect(rng() * 256, rng() * 256, 10 + rng() * 28, 6 + rng() * 14); }
  } else if (kind === 'metal') {
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2;
    for (let x = 0; x < 256; x += 12) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
  } else if (kind === 'wood') {
    for (let y = 0; y < 256; y += 14) { g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(0, y, 256, 2); }
    for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(0,0,0,${rng() * 0.08})`; g.fillRect(rng() * 256, rng() * 256, 30 + rng() * 80, 1); }
  } else if (kind === 'concrete') {
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(0,0,0,${rng() * 0.06})`; g.fillRect(rng() * 256, rng() * 256, 2 + rng() * 8, 2 + rng() * 8); }
    g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 2; g.strokeRect(1, 1, 254, 254);
  } else if (kind === 'roof') {
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2;
    for (let y = 0; y < 256; y += 18) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke();
      for (let x = (y / 18) % 2 ? 0 : 14; x < 256; x += 28) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 18); g.stroke(); }
    }
  }
  return tex(c, 1, 1);
}

// הגדרות חומרים. kind נותן טקסטורה, c צבע, tr שקיפות
export const MAT_DEFS = {
  wallA: { c: 0xe2d2b4, k: 'plaster', base: [226, 210, 180] },
  wallB: { c: 0xb4644e, k: 'brick', base: [176, 98, 78] },
  wallC: { c: 0xc9cdd0, k: 'concrete', base: [200, 204, 208] },
  wallLight: { c: 0xf0f0ec, k: 'plaster', base: [240, 240, 236] },
  wallMil: { c: 0x7a7f5a, k: 'concrete', base: [122, 127, 90] },
  wallMetal: { c: 0x8f98a0, k: 'metal', base: [143, 152, 160] },
  floor: { c: 0x8a7a66, k: 'wood', base: [138, 122, 102] },
  roof: { c: 0x5c5f62, k: 'concrete', base: [92, 95, 98] },
  roofA: { c: 0xa5422f, k: 'roof', base: [165, 66, 47] },
  roofB: { c: 0x54595f, k: 'roof', base: [84, 89, 95] },
  roofMetal: { c: 0x9aa4ab, k: 'metal', base: [154, 164, 171] },
  concrete: { c: 0x9a9a96, k: 'concrete', base: [154, 154, 150] },
  wood: { c: 0x8a6240, k: 'wood', base: [138, 98, 64] },
  fabric: { c: 0x6a6f86, k: null },
  glass: { c: 0x9ccbe0, tr: 0.28, rough: 0.05 },
  fence: { c: 0x6c7076, tr: 0.55 },
  sand: { c: 0xb9a36a, k: null },
  containerR: { c: 0xa23c2e, k: 'metal', base: [162, 60, 46] },
  containerB: { c: 0x2f5f9a, k: 'metal', base: [47, 95, 154] },
  containerG: { c: 0x4e7a4b, k: 'metal', base: [78, 122, 75] },
  containerY: { c: 0xd2a935, k: 'metal', base: [210, 169, 53] },
  crate: { c: 0x7a6a3c, k: 'wood', base: [122, 106, 60] },
  hay: { c: 0xd3b45a, k: null },
  rock: { c: 0x7e7c78, k: 'concrete', base: [126, 124, 120] },
  trunk: { c: 0x5a4330, k: 'wood', base: [90, 67, 48] },
  metal: { c: 0x74797e, k: 'metal', base: [116, 121, 126] },
  planeBody: { c: 0xe8e8e4, k: null },
  tractor: { c: 0x3c7a3a, k: null },
  carRed: { c: 0xb03030, k: null }, carBlue: { c: 0x3a5a9a, k: null }, carWhite: { c: 0xe6e6e6, k: null },
  carGrey: { c: 0x7a7f86, k: null }, carGreen: { c: 0x3c6a48, k: null }, carGlass: { c: 0x1c2a36, tr: 0.7 },
};

const texCache = {};
export function matTexture(name) {
  const d = MAT_DEFS[name];
  if (!d || !d.k) return null;
  if (!texCache[name]) texCache[name] = wallTex(d.base, d.k, name.length * 31 + name.charCodeAt(4));
  return texCache[name];
}

export function makeSoftDot() {
  const [c, g] = canvas(64, 64);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return tex(c, 1, 1);
}

export function makeRunwayTex() {
  const [c, g] = canvas(512, 64);
  g.fillStyle = '#4a4c50'; g.fillRect(0, 0, 512, 64);
  const rng = mulberry32(9); noiseFill(g, 512, 64, [74, 76, 80], 20, rng, 2);
  g.fillStyle = '#eee';
  for (let x = 20; x < 500; x += 48) g.fillRect(x, 29, 26, 6);
  g.fillRect(0, 2, 512, 2); g.fillRect(0, 60, 512, 2);
  for (let i = 0; i < 6; i++) { g.fillRect(8, 10 + i * 8, 28, 3); g.fillRect(476, 10 + i * 8, 28, 3); }
  return tex(c, 1, 1);
}

export function makeFieldTex(hex, rows) {
  const [c, g] = canvas(128, 128);
  const col = new THREE.Color(hex);
  g.fillStyle = `rgb(${col.r * 255 | 0},${col.g * 255 | 0},${col.b * 255 | 0})`; g.fillRect(0, 0, 128, 128);
  if (rows) { for (let x = 0; x < 128; x += 8) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x, 0, 3, 128); } }
  else { g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 3; g.strokeRect(4, 4, 120, 120); g.beginPath(); g.arc(64, 64, 18, 0, 6.3); g.stroke(); }
  return tex(c, 1, 1);
}

export function makeWaterTex() {
  const [c, g] = canvas(256, 256);
  const rng = mulberry32(5);
  g.fillStyle = '#2f6f8f'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 420; i++) {
    g.strokeStyle = `rgba(255,255,255,${0.04 + rng() * 0.1})`; g.lineWidth = 1 + rng() * 1.5;
    const x = rng() * 256, y = rng() * 256, l = 8 + rng() * 26;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + l / 2, y - 3, x + l, y); g.stroke();
  }
  return tex(c, 120, 120);
}
