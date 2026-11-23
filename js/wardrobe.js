// מסך התאמת הדמות: תצוגה מקדימה תלת-ממדית חיה + בחירת שיער, גוון עור, חולצה ומכנסיים.
// אחרי כל שינוי נקרא ל-onChange(look) (שמירה בדפדפן ועדכון הלובי).
import * as THREE from 'three';
import { buildCharacter } from './render/models.js';
import { HAIR_STYLES, SHIRT_STYLES, PANTS_STYLES, HAIR_COLORS, SKIN_TONES, SHIRT_COLORS, PANTS_COLORS, DEFAULT_LOOK, sanitizeLook, randomLook } from './sim/look.js';

const $ = (id) => document.getElementById(id);
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

let R = null; // renderer וסצנה (נוצרים בפעם הראשונה שנפתח)
let look = DEFAULT_LOOK.slice(), onChange = null, ch = null, raf = 0, yaw = 0.55, last = 0, drag = null, gearLvl = 0, opened = false;

function ensureRenderer() {
  if (R) return R;
  const canvas = $('wd-canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8794a6, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 2.3); sun.position.set(-1.4, 2.6, -2.6); scene.add(sun);
  const rim = new THREE.DirectionalLight(0x9fc4ff, 0.9); rim.position.set(2.2, 1.6, 2.4); scene.add(rim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(0.85, 40), new THREE.MeshStandardMaterial({ color: 0x2b3540, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.005; scene.add(floor);
  const camera = new THREE.PerspectiveCamera(28, 300 / 440, 0.1, 50);
  camera.position.set(0, 1.12, -5.0); camera.lookAt(0, 0.93, 0);
  R = { renderer, scene, camera, canvas };
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, yaw }; try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } });
  canvas.addEventListener('pointermove', (e) => { if (drag) yaw = drag.yaw + (e.clientX - drag.x) * 0.012; });
  const end = () => { drag = null; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  return R;
}

function resize() {
  const { renderer, camera, canvas } = R;
  const w = canvas.clientWidth || 300, h = canvas.clientHeight || 440, dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}

function rebuild() {
  if (ch) { R.scene.remove(ch.root); try { ch.dispose(); } catch (e) { /* ignore */ } }
  ch = buildCharacter(0xd9534f, look);
  ch.setEquip(gearLvl, gearLvl, gearLvl);
  ch.setWeapon(gearLvl > 0 ? 'm416' : null);
  R.scene.add(ch.root);
}

function loop(now) {
  raf = requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
  if (!drag) yaw += dt * 0.35;
  if (ch) { ch.root.rotation.y = yaw; ch.animate(dt, 0, 0, 0, 0, false, 0); }
  R.renderer.render(R.scene, R.camera);
}

function set(i, v) {
  look[i] = v; look = sanitizeLook(look);
  rebuild(); paint();
  if (onChange) onChange(look.slice());
}

function chipsRow(title, names, i) {
  const wrap = document.createElement('div'); wrap.className = 'wd-sec';
  const h = document.createElement('div'); h.className = 'wd-t'; h.textContent = title; wrap.appendChild(h);
  const row = document.createElement('div'); row.className = 'wd-row';
  names.forEach((n, k) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = n; b.dataset.i = i; b.dataset.v = k; b.onclick = () => set(i, k); row.appendChild(b); });
  wrap.appendChild(row); return wrap;
}
function swatchRow(title, colors, i) {
  const wrap = document.createElement('div'); wrap.className = 'wd-sec';
  if (title) { const h = document.createElement('div'); h.className = 'wd-t'; h.textContent = title; wrap.appendChild(h); }
  const row = document.createElement('div'); row.className = 'wd-row';
  colors.forEach((c, k) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'sw'; b.style.background = hex(c); b.dataset.i = i; b.dataset.v = k; b.title = hex(c); b.onclick = () => set(i, k); row.appendChild(b); });
  wrap.appendChild(row); return wrap;
}

function build() {
  const box = $('wd-opts'); if (box.childElementCount) return;
  const group = (title, ...els) => { const g = document.createElement('div'); g.className = 'wd-grp'; const h = document.createElement('h3'); h.textContent = title; g.appendChild(h); els.forEach((e) => g.appendChild(e)); box.appendChild(g); };
  group('שיער', chipsRow('סגנון', HAIR_STYLES, 0), swatchRow('צבע', HAIR_COLORS, 1));
  group('עור', swatchRow('גוון', SKIN_TONES, 2));
  group('חולצה', chipsRow('סגנון', SHIRT_STYLES, 3), swatchRow('צבע', SHIRT_COLORS, 4));
  group('מכנסיים', chipsRow('סגנון', PANTS_STYLES, 5), swatchRow('צבע', PANTS_COLORS, 6));
}

function paint() {
  for (const el of $('wd-opts').querySelectorAll('[data-i]')) el.classList.toggle('on', look[+el.dataset.i] === +el.dataset.v);
  $('wd-gear').textContent = gearLvl ? 'ציוד: רמה ' + gearLvl : 'ציוד: ללא';
}

export function openWardrobe(initial, cb) {
  look = sanitizeLook(initial); onChange = cb; gearLvl = 0;
  $('wardrobe').classList.remove('hidden'); opened = true;
  ensureRenderer(); build(); resize(); rebuild(); paint();
  last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
}
export function closeWardrobe() {
  if (!opened) return; opened = false;
  cancelAnimationFrame(raf); raf = 0;
  $('wardrobe').classList.add('hidden');
  if (ch && R) { R.scene.remove(ch.root); try { ch.dispose(); } catch (e) { /* ignore */ } ch = null; }
}

$('wd-close').onclick = closeWardrobe;
$('wd-random').onclick = () => { look = randomLook(); rebuild(); paint(); if (onChange) onChange(look.slice()); };
$('wd-reset').onclick = () => { look = DEFAULT_LOOK.slice(); rebuild(); paint(); if (onChange) onChange(look.slice()); };
$('wd-gear').onclick = () => { gearLvl = (gearLvl + 1) % 4; rebuild(); paint(); };
$('wardrobe').addEventListener('pointerdown', (e) => { if (e.target === $('wardrobe')) closeWardrobe(); });
addEventListener('keydown', (e) => { if (opened && e.key === 'Escape') closeWardrobe(); });
addEventListener('resize', () => { if (opened && R) resize(); });
