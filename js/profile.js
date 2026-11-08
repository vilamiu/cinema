// His ratings: load (bundled or imported), sync with TMDB for accurate countries/cast/posters, build veto groups.
import { store } from './store.js';
import { norm, countryName, demonym } from './util.js';
import { find, getFacts, AuthError } from './tmdb.js';
import { MONKEY_FIXED, imdbGenres } from './rules.js';

let profile = null;
let baseData = { source: 'none', ratings: [] };
const listeners = new Set();
export function onProfile(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function getProfile() { return profile; }

export async function loadProfile() {
  let base;
  const imported = store.get('ratingsImport');
  if (imported?.ratings?.length) base = imported;
  else {
    try { base = await (await fetch('data/ratings.json', { cache: 'no-cache' })).json(); }
    catch { base = { source: 'none', ratings: [] }; }
  }
  baseData = base;
  profile = build(base);
  listeners.forEach(fn => fn(profile));
  return profile;
}

function build(base) {
  const sync = store.get('sync', {});
  const entries = base.ratings.map(r => {
    const s = sync[r.imdb];
    if (!s || s.miss) return { ...r, synced: false };
    return {
      ...r, synced: true, tmdbType: s.type, tmdbId: s.id, poster: s.poster,
      countries: s.countries?.length ? s.countries : r.countries,
      directorRefs: s.directors || [], castRefs: s.cast || [],
      directors: s.directors?.length ? s.directors.map(d => d.name) : r.directors,
      leads: s.cast?.length ? s.cast.slice(0, 3).map(c => c.name) : r.leads,
    };
  });

  // Scores given in this app count straight away (newer than the export for the same title).
  const appVerdicts = Object.values(store.get('verdicts', {})).filter(x => x.status === 'seen' && x.rating);
  for (const x of appVerdicts) {
    const old = x.imdb && entries.find(e => e.imdb === x.imdb);
    if (old) { old.exportRating = old.rating; old.rating = x.rating; old.date = (x.at || '').slice(0, 10); old.fromApp = true; continue; }
    const f = store.get('f:' + x.type + ':' + x.id);
    entries.push({
      imdb: x.imdb || `tmdb:${x.type}:${x.id}`, title: x.title, year: x.year, rating: x.rating, date: (x.at || '').slice(0, 10), type: x.type,
      genres: f ? imdbGenres(f.genres || []) : [], directors: f ? f.directors.map(d => d.name) : [], leads: f ? f.cast.slice(0, 3).map(c => c.name) : [],
      countries: f?.countries || [], synced: true, tmdbType: x.type, tmdbId: x.id, poster: x.poster,
      directorRefs: f?.directors || [], castRefs: f?.cast || [], fromApp: true, appOnly: true,
    });
  }

  const byImdb = new Map(entries.map(e => [e.imdb, e]));
  const byTmdb = new Map(entries.filter(e => e.synced).map(e => [e.tmdbType + ':' + e.tmdbId, e]));
  const groups = new Map();
  const add = (key, label, e) => {
    let g = groups.get(key);
    if (!g) groups.set(key, g = { key, label, n: 0, n8: 0, sum: 0, avg: 0, items: [] });
    g.n++; g.sum += e.rating; if (e.rating >= 8) g.n8++; g.avg = g.sum / g.n; g.items.push(e);
  };
  for (const e of entries) {
    if (e.type === 'tv' && !e.directors.length) { /* series: countries + leads still count */ }
    for (const c of e.countries) add('c:' + c, `Your ${demonym(c)} titles`, e);
    for (const d of e.directors) add('d:' + norm(d), `Director ${d}`, e);
    for (const a of e.leads.slice(0, 3)) add('a:' + norm(a), `Films led by ${a}`, e);
    const dec = e.year ? Math.floor(e.year / 10) * 10 : null;
    for (const c of e.countries.slice(0, 2)) for (const g of e.genres) {
      add(`cg:${c}|${g}`, `Your ${demonym(c)} ${g}`, e);
      if (dec) add(`cdg:${c}|${dec}|${g}`, `Your ${demonym(c)} ${dec}s ${g}`, e);
    }
  }

  const monkey = new Set(MONKEY_FIXED.map(norm));
  for (const g of groups.values()) if (g.key.startsWith('d:') && g.n >= 2 && g.avg >= 8) monkey.add(g.key.slice(2));

  const total = entries.length;
  const hits = entries.filter(e => e.rating >= 8).length;
  return {
    source: base.source || '', imported: !!store.get('ratingsImport'), entries, byImdb, byTmdb, groups, monkey,
    total, hitRate: total ? hits / total : 0,
    syncedCount: entries.filter(e => e.synced).length,
    unsyncedCount: entries.filter(e => !e.appOnly && !sync[e.imdb]).length,
  };
}

export function rebuildProfile() {
  profile = build(baseData);
  listeners.forEach(fn => fn(profile));
  return profile;
}

// Ratings that involve a person (as director or top-billed cast).
export function personRatings(pid, name) {
  if (!profile) return [];
  const n = norm(name);
  return profile.entries.filter(e =>
    (e.directorRefs || []).some(d => d.id === pid) || (e.castRefs || []).slice(0, 6).some(c => c.id === pid) ||
    (!e.synced && (e.directors.some(d => norm(d) === n) || e.leads.some(a => norm(a) === n))))
    .sort((a, b) => b.rating - a.rating);
}

export function countryStats(iso) { return profile?.groups.get('c:' + iso) || null; }
export function countryLabel(iso) { return countryName(iso); }

// ---------- Sync: map every rated IMDb id to TMDB facts (once; resumable) ----------
let syncing = null;
export function isSyncing() { return !!syncing; }
export function syncProfile(onProgress = () => {}) {
  if (syncing) return syncing;
  syncing = (async () => {
    const sync = store.get('sync', {});
    const todo = profile.entries.filter(e => !e.appOnly && !sync[e.imdb]);
    let done = 0, sinceSave = 0;
    const save = () => { store.set('sync', sync); sinceSave = 0; };
    try {
      await Promise.all(todo.map(async (e) => {
        try {
          const r = await find(e.imdb);
          const hit = (e.type === 'tv' ? (r.tv_results[0] || r.movie_results[0]) : (r.movie_results[0] || r.tv_results[0]));
          if (!hit) sync[e.imdb] = { miss: true };
          else {
            const type = hit.media_type || (r.movie_results.includes(hit) ? 'movie' : 'tv');
            const f = await getFacts(type, hit.id);
            sync[e.imdb] = { type, id: hit.id, poster: f.poster, countries: f.countries, directors: f.directors.slice(0, 2), cast: f.cast.slice(0, 6) };
          }
        } catch (err) {
          if (err instanceof AuthError) throw err;
        }
        done++; sinceSave++;
        if (sinceSave >= 25) save();
        onProgress(done, todo.length);
      }));
    } finally {
      save();
      syncing = null;
      profile = build(baseData);
      listeners.forEach(fn => fn(profile));
    }
  })();
  return syncing;
}
// ---------- Import a fresh IMDb export ----------
export function parseImdbCsv(text) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  const head = rows.shift().map(s => s.trim());
  const col = (name) => head.indexOf(name);
  const need = ['Const', 'Your Rating', 'Title'];
  if (need.some(n => col(n) < 0)) throw new Error('This does not look like an IMDb ratings export (missing Const / Your Rating / Title columns).');
  const TYPE = { 'TV Series': 'tv', 'TV Mini Series': 'tv', 'TV Mini-Series': 'tv' };
  const get = (r, n) => (col(n) >= 0 ? (r[col(n)] || '').trim() : '');
  const ratings = rows.filter(r => r.length > 2 && get(r, 'Const').startsWith('tt')).map(r => ({
    imdb: get(r, 'Const'), title: get(r, 'Title'), year: parseInt(get(r, 'Year'), 10) || null,
    rating: parseInt(get(r, 'Your Rating'), 10), date: get(r, 'Date Rated'), type: TYPE[get(r, 'Title Type')] || 'movie',
    genres: get(r, 'Genres').split(',').map(s => s.trim()).filter(Boolean),
    directors: get(r, 'Directors').split(',').map(s => s.trim()).filter(Boolean),
    leads: [], countries: [], imdbRating: parseFloat(get(r, 'IMDb Rating')) || null,
  })).filter(r => r.rating);
  if (!ratings.length) throw new Error('No ratings found in that file.');
  const last = ratings.map(r => r.date).sort().pop();
  return { source: 'Imported IMDb export, last rating ' + last, count: ratings.length, ratings };
}

export async function importRatings(text) {
  const data = parseImdbCsv(text);
  // carry over lead actors / countries from the bundled file where we have them
  try {
    const bundled = await (await fetch('data/ratings.json')).json();
    const old = new Map(bundled.ratings.map(r => [r.imdb, r]));
    for (const r of data.ratings) { const o = old.get(r.imdb); if (o) { r.leads = o.leads; r.countries = o.countries; } }
  } catch { /* fine */ }
  if (!store.set('ratingsImport', data)) throw new Error('Your browser storage is full; clear the cache in Settings and try again.');
  await loadProfile();
  return data;
}
export async function resetImport() { store.del('ratingsImport'); await loadProfile(); }

function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
