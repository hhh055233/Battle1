// נתוני המשחק: נשקים, שריון, תרופות, רימונים, שלבי האזור. מבוסס על המחקר על PUBG: Battlegrounds
// (ערכי נזק, הפחתת נזק של קסדות/אפודים, קיבולת תיקים, משקלי רימונים וכד'), בהתאמה לגודל מפה קטן יותר.

export const MAP = { size: 1600, half: 800, seg: 320, waterFloor: -1.6, seaLevel: 0 };

export const PHYS = {
  G: 20,
  JUMP: 6.3,
  STEP: 0.5,
  R: 0.32,
  speed: { walk: 5.0, sprint: 7.6, crouch: 2.7, prone: 1.3 },
  height: [1.8, 1.35, 0.65],
  eye: [1.68, 1.22, 0.5],
};

export const MAX_PLAYERS = 50;

// ---------- תחמושת ----------
export const AMMO = {
  '9mm': { name: '9mm', w: 0.3, box: 30, color: 0xd9b44a },
  '45': { name: '.45 ACP', w: 0.4, box: 30, color: 0xc8892e },
  '556': { name: '5.56mm', w: 0.5, box: 30, color: 0x5fae52 },
  '762': { name: '7.62mm', w: 0.6, box: 30, color: 0xb94d3a },
  '12g': { name: '12 Gauge', w: 1.0, box: 10, color: 0xd34a4a },
  '300': { name: '.300 Magnum', w: 2.0, box: 10, color: 0x6a5acd },
};

// ---------- שריון (רמות 1-3) ----------
export const HELMET = [
  null,
  { name: 'קסדת אופנוען (רמה 1)', red: 0.3, dur: 80, col: 0xe8e8e8 },
  { name: 'קסדה צבאית (רמה 2)', red: 0.4, dur: 150, col: 0x5b6b3a },
  { name: 'קסדת ספצנאז (רמה 3)', red: 0.55, dur: 230, col: 0x23272b },
];
export const VEST = [
  null,
  { name: 'אפוד משטרה (רמה 1)', red: 0.3, dur: 200, col: 0x3b4048, cap: 50 },
  { name: 'אפוד משטרה (רמה 2)', red: 0.4, dur: 220, col: 0x26324a, cap: 50 },
  { name: 'אפוד צבאי (רמה 3)', red: 0.55, dur: 250, col: 0x6d6a45, cap: 50 },
];
export const PACK = [
  null,
  { name: 'תיק גב (רמה 1)', cap: 150, col: 0xc9b58a },
  { name: 'תיק גב (רמה 2)', cap: 200, col: 0x56743c },
  { name: 'תיק גב (רמה 3)', cap: 250, col: 0x3f4a2f },
];
export const BASE_CAP = 70; // חגורת כלים

// ---------- תרופות ----------
export const MEDS = {
  band: { name: 'תחבושת', w: 2, use: 3.5, heal: 10, cap: 75, boost: 0 },
  aid: { name: 'ערכת עזרה ראשונה', w: 4, use: 5.5, heal: 75, cap: 75, boost: 0 },
  kit: { name: 'ערכת רפואה', w: 8, use: 7, heal: 100, cap: 100, boost: 0 },
  drink: { name: 'משקה אנרגיה', w: 4, use: 3.5, heal: 0, cap: 0, boost: 40 },
  pain: { name: 'משכך כאבים', w: 4, use: 5, heal: 0, cap: 0, boost: 60 },
  adren: { name: 'אדרנלין', w: 6, use: 6, heal: 0, cap: 0, boost: 100 },
};

// ---------- רימונים ----------
export const THROWS = {
  frag: { name: 'רימון רסס', w: 18, fuse: 5.0, radius: 11, dmg: 100, col: 0x4b5a35 },
  smoke: { name: 'רימון עשן', w: 14, fuse: 2.0, radius: 8, dur: 30, col: 0xcfd2d6 },
  stun: { name: 'רימון הלם', w: 12, fuse: 2.5, radius: 18, col: 0x8b8f99 },
  molo: { name: 'בקבוק molotov', w: 16, fuse: 3.0, radius: 6, dur: 10, dps: 14, col: 0xb4552d },
};

export const SCOPES = {
  red: { name: 'כוונת נקודה אדומה', w: 4, zoom: 1.0 },
  x2: { name: 'סקופ x2', w: 5, zoom: 2.0 },
  x4: { name: 'סקופ x4', w: 7, zoom: 4.0 },
  x8: { name: 'סקופ x8', w: 9, zoom: 8.0 },
};

// ---------- נשקים ----------
// dmg=נזק לכדור, rpm=קצב אש, mag=מחסנית, sp=פיזור (מעלות), rv/rh=רתע אנכי/אופקי (מעלות), rl=טעינה (שניות),
// range=טווח נזק מלא, min=מכפיל נזק מינימלי בטווח רחוק, hm=מכפיל ירייה בראש, slot: 0=ראשי, 1=משני
export const WEAPONS = {
  p92: { n: 'P92', cls: 'pistol', ammo: '9mm', dmg: 34, rpm: 420, mag: 15, auto: false, sp: 1.2, rv: 1.5, rh: 0.3, rl: 1.9, range: 60, min: 0.55, hm: 2.0, w: 8, mv: 1.0, air: false },
  p18c: { n: 'P18C', cls: 'pistol', ammo: '9mm', dmg: 23, rpm: 900, mag: 17, auto: true, sp: 1.8, rv: 1.0, rh: 0.5, rl: 2.0, range: 50, min: 0.5, hm: 2.0, w: 8, mv: 1.0, air: false },
  deagle: { n: 'Desert Eagle', cls: 'pistol', ammo: '45', dmg: 62, rpm: 200, mag: 7, auto: false, sp: 1.0, rv: 3.4, rh: 0.5, rl: 2.4, range: 90, min: 0.6, hm: 2.1, w: 10, mv: 1.0, air: false },
  uzi: { n: 'Micro UZI', cls: 'smg', ammo: '9mm', dmg: 26, rpm: 1100, mag: 25, auto: true, sp: 2.0, rv: 1.0, rh: 0.7, rl: 2.1, range: 55, min: 0.4, hm: 2.0, w: 12, mv: 1.0, air: false },
  ump: { n: 'UMP45', cls: 'smg', ammo: '45', dmg: 41, rpm: 600, mag: 25, auto: true, sp: 1.6, rv: 1.1, rh: 0.5, rl: 2.4, range: 85, min: 0.45, hm: 2.0, w: 14, mv: 1.0, air: false },
  vector: { n: 'Vector', cls: 'smg', ammo: '45', dmg: 33, rpm: 1000, mag: 19, auto: true, sp: 1.8, rv: 0.9, rh: 0.6, rl: 2.2, range: 75, min: 0.45, hm: 2.0, w: 14, mv: 1.0, air: false },
  m416: { n: 'M416', cls: 'ar', ammo: '556', dmg: 40, rpm: 700, mag: 30, auto: true, sp: 1.2, rv: 1.15, rh: 0.4, rl: 2.6, range: 240, min: 0.6, hm: 2.1, w: 20, mv: 0.97, air: false },
  scar: { n: 'SCAR-L', cls: 'ar', ammo: '556', dmg: 41, rpm: 620, mag: 30, auto: true, sp: 1.15, rv: 1.25, rh: 0.4, rl: 2.7, range: 240, min: 0.6, hm: 2.1, w: 20, mv: 0.97, air: false },
  akm: { n: 'AKM', cls: 'ar', ammo: '762', dmg: 47, rpm: 600, mag: 30, auto: true, sp: 1.4, rv: 1.9, rh: 0.6, rl: 2.8, range: 220, min: 0.6, hm: 2.1, w: 20, mv: 0.96, air: false },
  groza: { n: 'Groza', cls: 'ar', ammo: '762', dmg: 48, rpm: 750, mag: 30, auto: true, sp: 1.2, rv: 1.45, rh: 0.5, rl: 2.6, range: 230, min: 0.6, hm: 2.1, w: 20, mv: 0.97, air: true },
  m249: { n: 'M249', cls: 'lmg', ammo: '556', dmg: 45, rpm: 750, mag: 100, auto: true, sp: 1.5, rv: 1.0, rh: 0.5, rl: 8.0, range: 260, min: 0.6, hm: 2.0, w: 28, mv: 0.88, air: true },
  sks: { n: 'SKS', cls: 'dmr', ammo: '762', dmg: 53, rpm: 360, mag: 10, auto: false, sp: 0.6, rv: 2.3, rh: 0.4, rl: 3.2, range: 320, min: 0.75, hm: 2.3, w: 22, mv: 0.95, air: false },
  mini14: { n: 'Mini 14', cls: 'dmr', ammo: '556', dmg: 46, rpm: 420, mag: 20, auto: false, sp: 0.55, rv: 1.7, rh: 0.35, rl: 3.0, range: 340, min: 0.75, hm: 2.3, w: 22, mv: 0.95, air: false },
  kar98: { n: 'Kar98k', cls: 'sr', ammo: '762', dmg: 79, rpm: 40, mag: 5, auto: false, bolt: true, sp: 0.3, rv: 4.5, rh: 0.5, rl: 4.2, range: 500, min: 0.85, hm: 2.5, w: 24, mv: 0.93, air: false },
  awm: { n: 'AWM', cls: 'sr', ammo: '300', dmg: 105, rpm: 36, mag: 5, auto: false, bolt: true, sp: 0.2, rv: 5.5, rh: 0.5, rl: 4.6, range: 700, min: 0.9, hm: 2.6, w: 26, mv: 0.92, air: true },
  s12k: { n: 'S12K', cls: 'sg', ammo: '12g', dmg: 22, pel: 9, rpm: 250, mag: 5, auto: false, sp: 3.4, rv: 3.0, rh: 0.6, rl: 4.0, range: 30, min: 0.12, hm: 1.6, w: 20, mv: 0.96, air: false },
  s686: { n: 'S686', cls: 'sg', ammo: '12g', dmg: 24, pel: 9, rpm: 160, mag: 2, auto: false, sp: 3.2, rv: 3.8, rh: 0.7, rl: 3.2, range: 28, min: 0.1, hm: 1.6, w: 20, mv: 0.96, air: false },
};
export const WEAPON_IDS = Object.keys(WEAPONS);

// ---------- מפתח פריט ----------
// w:m416 | a:556 | h1 h2 h3 | v1 v2 v3 | p1 p2 p3 | m:band | t:frag | s:x4
export function itemInfo(k) {
  const [a, b] = k.split(':');
  if (a === 'w') { const W = WEAPONS[b]; return { type: 'weapon', id: b, name: W.n, w: W.w }; }
  if (a === 'a') { const A = AMMO[b]; return { type: 'ammo', id: b, name: A.name, w: A.w, stack: true }; }
  if (a === 'm') { const M = MEDS[b]; return { type: 'med', id: b, name: M.name, w: M.w, stack: true }; }
  if (a === 't') { const T = THROWS[b]; return { type: 'throw', id: b, name: T.name, w: T.w, stack: true }; }
  if (a === 's') { const S = SCOPES[b]; return { type: 'scope', id: b, name: S.name, w: S.w, stack: true }; }
  const lvl = parseInt(k[1], 10);
  if (a[0] === 'h') return { type: 'helmet', lvl, name: HELMET[lvl].name, w: 0 };
  if (a[0] === 'v') return { type: 'vest', lvl, name: VEST[lvl].name, w: 0 };
  if (a[0] === 'p') return { type: 'pack', lvl, name: PACK[lvl].name, w: 0 };
  return { type: 'unknown', name: k, w: 1 };
}

// ---------- אזור קריסה (כחול) ----------
// wait=שניות המתנה, shrink=שניות כיווץ, r=רדיוס יעד, dps=נזק לשנייה
export const ZONE_PHASES = [
  { wait: 110, shrink: 90, r: 480, dps: 0.4 },
  { wait: 95, shrink: 80, r: 330, dps: 0.7 },
  { wait: 85, shrink: 70, r: 220, dps: 1.2 },
  { wait: 75, shrink: 60, r: 135, dps: 2.0 },
  { wait: 65, shrink: 50, r: 75, dps: 3.5 },
  { wait: 55, shrink: 40, r: 38, dps: 5.5 },
  { wait: 45, shrink: 30, r: 15, dps: 8.0 },
  { wait: 30, shrink: 25, r: 0, dps: 12.0 },
];
export const ZONE_START_R = 760;
export const ZONE_T0 = 55; // שניות מתחילת המטוס עד שהספירה לאזור הראשון מתחילה

export const PLANE = { speed: 46, alt: 280, freefall: 42, chuteFall: 6.5, chuteGlide: 15, deployAlt: 90 };

export const COLORS = [0xd9534f, 0x5bc0de, 0x5cb85c, 0xf0ad4e, 0x9b59b6, 0xe67e22, 0x1abc9c, 0xe84393, 0x95a5a6, 0xf1c40f];
