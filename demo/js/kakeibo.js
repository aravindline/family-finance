// Kakeibo tag on every expense (app 0.15.0, Aravind 13 Nov 2026): Needs, Wants, Culture or Unexpected. Each category has a
// preset tag; the expense form shows it as a small chip that follows the category, and a tap changes it for that one
// expense. A category you add yourself starts as Wants. There is no setting to change the presets.
export const TAGS = ['Needs', 'Wants', 'Culture', 'Unexpected'];
const PRESET = { 'food': 'Needs', 'household': 'Needs', 'rent & bills': 'Needs', 'travel': 'Needs', 'health': 'Needs', 'children': 'Needs',
  'shopping': 'Wants', 'entertainment': 'Wants', 'personal': 'Wants', 'family & social': 'Culture', 'one-time': 'Unexpected' };
export const tagFor = cat => PRESET[String(cat || '').trim().toLowerCase()] || (cat ? 'Wants' : '');
export const nextTag = t => TAGS[(TAGS.indexOf(t) + 1) % TAGS.length];
