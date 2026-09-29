// Feste Kategorien. Farben: oklch(0.72 0.07 H) wie im Design, Sonstiges neutral grau.

export const CATS = [
  { id: 'einkaeufe',   name: 'Einkäufe',          hue: 70 },
  { id: 'restaurants', name: 'Restaurants',       hue: 25 },
  { id: 'bars',        name: 'Bars & Cafés',      hue: 335 },
  { id: 'sport',       name: 'Sport',             hue: 160 },
  { id: 'feiern',      name: 'Feiern',            hue: 290 },
  { id: 'mobilitaet',  name: 'Mobilität',         hue: 205 },
  { id: 'abos',        name: 'Abos',              hue: 110 },
  { id: 'reisen',      name: 'Reisen & Ausflüge', hue: 250 },
  { id: 'sonstiges',   name: 'Sonstiges',         color: '#c8c8c3' },
].map(c => ({ ...c, color: c.color || `oklch(0.72 0.07 ${c.hue})` }));

const byId = Object.fromEntries(CATS.map(c => [c.id, c]));
export const catById = id => byId[id] || byId.sonstiges;

export const DEFAULT_BUDGETS = {
  einkaeufe: 200, restaurants: 60, bars: 50, sport: 35, feiern: 50,
  mobilitaet: 40, abos: 30, reisen: 50, sonstiges: 35,
};
export const DEFAULT_MONTHLY_BUDGET = 550;
