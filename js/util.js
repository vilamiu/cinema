// Small shared helpers.

export function norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9π]+/g, ' ').trim();
}

// h('div.card', {onclick}, child, child...)  — tiny DOM builder; strings become text nodes.
export function h(tag, attrs, ...kids) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

// Run async tasks with a concurrency cap. Background tasks (low = true) only start when nothing urgent is waiting.
export function limiter(max) {
  let active = 0; const high = [], low = [];
  const next = () => {
    if (active >= max || !(high.length || low.length)) return;
    active++;
    const { fn, res, rej } = (high.length ? high : low).shift();
    fn().then(res, rej).finally(() => { active--; next(); });
  };
  return (fn, isLow = false) => new Promise((res, rej) => { (isLow ? low : high).push({ fn, res, rej }); next(); });
}

export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

export function yearOf(d) { const y = parseInt(String(d || '').slice(0, 4), 10); return Number.isFinite(y) ? y : null; }

export function fmtRuntime(m) { if (!m) return ''; const hh = Math.floor(m / 60), mm = m % 60; return hh ? `${hh}h ${String(mm).padStart(2, '0')}m` : `${mm}m`; }

export function fmtVotes(n) { if (!n) return '0'; return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n); }

export const DECADES = [2020, 2010, 2000, 1990, 1980, 1970, 1960, 1950, 1940, 1930, 1920];

export const MOVIE_GENRES = [
  [28, 'Action'], [12, 'Adventure'], [16, 'Animation'], [35, 'Comedy'], [80, 'Crime'], [99, 'Documentary'], [18, 'Drama'],
  [10751, 'Family'], [14, 'Fantasy'], [36, 'History'], [27, 'Horror'], [10402, 'Music'], [9648, 'Mystery'],
  [10749, 'Romance'], [878, 'Science Fiction'], [53, 'Thriller'], [10752, 'War'], [37, 'Western'],
];
export const TV_GENRES = [
  [10759, 'Action & Adventure'], [16, 'Animation'], [35, 'Comedy'], [80, 'Crime'], [99, 'Documentary'], [18, 'Drama'],
  [10751, 'Family'], [9648, 'Mystery'], [10765, 'Sci-Fi & Fantasy'], [10768, 'War & Politics'], [37, 'Western'],
];
export function genreName(id) {
  const g = MOVIE_GENRES.find(x => x[0] === id) || TV_GENRES.find(x => x[0] === id);
  return g ? g[1] : 'Genre ' + id;
}

let regionNames;
export function countryName(iso) {
  if (!iso) return '';
  if (iso === 'SU') return 'Soviet Union';
  if (iso === 'XC') return 'Czechoslovakia';
  if (iso === 'YU') return 'Yugoslavia';
  if (iso === 'XG') return 'East Germany';
  if (iso === 'HK') return 'Hong Kong';
  if (iso === 'MO') return 'Macao';
  try { regionNames ||= new Intl.DisplayNames(['en'], { type: 'region' }); return regionNames.of(iso) || iso; } catch { return iso; }
}
export function demonym(iso) {
  const d = { US: 'American', GB: 'British', JP: 'Japanese', KR: 'Korean', FR: 'French', IT: 'Italian', DE: 'German', SE: 'Swedish', DK: 'Danish', NO: 'Norwegian', FI: 'Finnish', IS: 'Icelandic', SU: 'Soviet', RU: 'Russian', CN: 'Chinese', HK: 'Hong Kong', TW: 'Taiwanese', IN: 'Indian', AU: 'Australian', NZ: 'New Zealand', CA: 'Canadian', MX: 'Mexican', BR: 'Brazilian', AR: 'Argentine', PL: 'Polish', HU: 'Hungarian', CZ: 'Czech', BE: 'Belgian', NL: 'Dutch', IE: 'Irish', AT: 'Austrian', CH: 'Swiss', GR: 'Greek', PT: 'Portuguese', TH: 'Thai', MN: 'Mongolian' };
  return d[iso] || countryName(iso);
}
