// מראה הדמות (התאמה אישית): מערך קטן של מספרים שלמים, בטוח לשליחה ברשת. משותף ללקוח, ל-host ולשרת.
// [סגנון שיער, צבע שיער, גוון עור, סגנון חולצה, צבע חולצה, סגנון מכנסיים, צבע מכנסיים]

export const HAIR_STYLES = ['קצר', 'צד', 'קוצים', 'ארוך', 'קוקו', 'מוהוק', 'אפרו', 'פקעת', 'קירח'];
export const SHIRT_STYLES = ['חולצת טי', 'קפוצ׳ון', 'ג׳קט'];
export const PANTS_STYLES = ['ג׳ינס', 'דגמ"ח', 'שורט'];

export const HAIR_COLORS = [0x1c1612, 0x3b2819, 0x5b3a22, 0x8a3d1f, 0xc8641e, 0xd9b36a, 0xebdfb8, 0x9aa0a6, 0xf0f0f0, 0x2f6fe0, 0xe85aa5, 0x2fa862];
export const SKIN_TONES = [0xf6d3b8, 0xedbf9a, 0xdfa578, 0xc58c5c, 0xa6683f, 0x854f2f, 0x683a24, 0x47291b];
export const SHIRT_COLORS = [0xf1f1ee, 0x24262b, 0x7b8189, 0xd23c3c, 0xee7d2b, 0xf1c232, 0x4aa34a, 0x2aa5a0, 0x3a6fd6, 0x22356e, 0x7a4fc4, 0xe56aa5];
export const PANTS_COLORS = [0x34507a, 0x232f4a, 0x1f2124, 0x5b6068, 0xa5946b, 0x5a6140, 0x5e4630, 0xdedbd2, 0x9c2f35, 0x2f6b46];

const LIM = [HAIR_STYLES.length, HAIR_COLORS.length, SKIN_TONES.length, SHIRT_STYLES.length, SHIRT_COLORS.length, PANTS_STYLES.length, PANTS_COLORS.length];

// דמות ברירת המחדל: זהה לכולם בהתחלה (שיער חום כהה עם פרידה, עור בינוני, חולצת טי כחולה וג'ינס)
export const DEFAULT_LOOK = [1, 1, 2, 0, 8, 0, 0];

// מנקה קלט לא אמין: תמיד מחזיר מערך באורך 7 של מספרים שלמים בטווח
export function sanitizeLook(lk) {
  const out = DEFAULT_LOOK.slice();
  if (Array.isArray(lk)) for (let i = 0; i < LIM.length; i++) { const v = lk[i] | 0; out[i] = v >= 0 && v < LIM[i] ? v : DEFAULT_LOOK[i]; }
  return out;
}

export function randomLook(rnd = Math.random) {
  return LIM.map((n) => Math.min(n - 1, Math.floor(rnd() * n)));
}

export const LOOK_LIMITS = LIM;
