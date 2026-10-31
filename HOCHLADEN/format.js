// Formatierung & Datumshilfen (de-DE, Euro)

const nf2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const nfBudget = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

export const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const minus = s => s.replace('-', '−');

const clean = v => (v === 0 ? 0 : v); // macht aus -0 eine 0
export const eur = n => minus(nf2.format(clean(round2(n)))) + ' €';
export const eur0 = n => minus(nf0.format(clean(Math.round(n)))) + ' €';
/** Budget-Eingabe: "450" oder "59,90" */
export const budgetStr = n => (n == null ? '' : nfBudget.format(n));
export const pct = (n, dec = 0) => {
  const f = 10 ** dec;
  return minus(clean(Math.round(n * f) / f).toLocaleString('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec })) + ' %';
};

/** "24,90" | "24.90" | "1.234,5" -> Zahl oder NaN */
export function parseAmount(str) {
  if (str == null) return NaN;
  let s = String(str).trim().replace(/\s|€/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  else if (/^\d{1,3}\.\d{3}$/.test(s)) s = s.replace('.', '');
  const n = Number(s);
  return Number.isFinite(n) ? round2(n) : NaN;
}

export const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayYmd = () => ymd(new Date());
export const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const monthOf = s => s.slice(0, 7);
export const daysInMonth = (y, m) => new Date(y, m, 0).getDate(); // m: 1-12

export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MONTHS_SHORT = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];
const WEEKDAYS = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'];

export const monthLabel = ym => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
export const monthName = ym => MONTHS[Number(ym.split('-')[1]) - 1];
export const monthShort = ym => MONTHS_SHORT[Number(ym.split('-')[1]) - 1].replace('.', '');

function relDay(s) {
  const t = todayYmd();
  if (s === t) return 'Heute';
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (s === ymd(y)) return 'Gestern';
  return null;
}

/** "Heute, 28. Sep." / "Mo., 22. Sep." / "Mo., 22. Sep. 2025" */
export function dayLabel(s, { withWeekday = true } = {}) {
  const d = parseYmd(s);
  const base = `${d.getDate()}. ${MONTHS_SHORT[d.getMonth()]}`;
  const yr = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : '';
  const rel = relDay(s);
  if (rel) return `${rel}, ${base}${yr}`;
  return withWeekday ? `${WEEKDAYS[d.getDay()]}, ${base}${yr}` : base + yr;
}

export const shortDate = s => { const d = parseYmd(s); return relDay(s) || `${d.getDate()}. ${MONTHS_SHORT[d.getMonth()]}`; };

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
