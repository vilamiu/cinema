// TMDB client: auth, request cache, compact "facts" per title for the rule engine.
import { store } from './store.js';
import { limiter, yearOf } from './util.js';

const BASE = 'https://api.themoviedb.org/3';
export const IMG = 'https://image.tmdb.org/t/p/';
const FACTS_V = 3;
const run = limiter(8);
const mem = new Map();

export class AuthError extends Error {}

export function hasKey() { return !!store.get('tmdbKey'); }

function authed(url) {
  const key = (store.get('tmdbKey') || '').trim();
  const headers = { accept: 'application/json' };
  if (!key) throw new AuthError('No TMDB key yet');
  if (key.length > 60) headers.Authorization = 'Bearer ' + key; // v4 read access token
  else url.searchParams.set('api_key', key);                      // v3 key
  return headers;
}

export async function api(path, params = {}, { fresh = false } = {}) {
  const url = new URL(BASE + path);
  if (!('language' in params)) url.searchParams.set('language', 'en-US');
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  const cacheKey = url.toString();
  if (!fresh && mem.has(cacheKey)) return mem.get(cacheKey);
  const p = run(async () => {
    const headers = authed(url);
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch(url, { headers });
      if (r.status === 401) throw new AuthError('TMDB rejected the key');
      if (r.status === 429) { await new Promise(res => setTimeout(res, 800 * (attempt + 1))); continue; }
      if (!r.ok) throw new Error(`TMDB ${r.status} on ${path}`);
      return r.json();
    }
    throw new Error('TMDB is rate-limiting; try again in a moment');
  });
  mem.set(cacheKey, p);
  p.catch(() => mem.delete(cacheKey));
  return p;
}

export function img(path, size = 'w342') { return path ? IMG + size + path : null; }

const VIDEO_LANGS = 'en,null,ja,ko,fr,de,it,sv,da,no,fi,ru,zh,cn,pl,hu,cs,nl,pt,is,hi,th';

export function details(type, id) {
  if (type === 'movie') return api(`/movie/${id}`, { append_to_response: 'credits,videos,keywords,recommendations,similar,release_dates', include_video_language: VIDEO_LANGS });
  return api(`/tv/${id}`, { append_to_response: 'credits,videos,keywords,recommendations,similar,external_ids,content_ratings', include_video_language: VIDEO_LANGS });
}

export function person(id) { return api(`/person/${id}`, { append_to_response: 'movie_credits,tv_credits,external_ids' }); }
export function search(q, page = 1) { return api('/search/multi', { query: q, include_adult: 'false', page }); }
export function searchPeople(q) { return api('/search/person', { query: q, include_adult: 'false' }); }
export function find(imdb) { return api(`/find/${imdb}`, { external_source: 'imdb_id' }); }
export function countries() { return api('/configuration/countries', { language: 'en-US' }); }
export function discover(type, params) { return api(`/discover/${type}`, { include_adult: 'false', ...params }); }
export function keywordSearch(q) { return api('/search/keyword', { query: q }); }

// ---------- Facts: the compact record the rule engine reads ----------
export function factsFrom(d, type) {
  const crew = d.credits?.crew || [];
  const directors = type === 'movie'
    ? crew.filter(c => c.job === 'Director').map(c => ({ id: c.id, name: c.name }))
    : (d.created_by || []).map(c => ({ id: c.id, name: c.name }));
  const countries = [...new Set([...(d.production_countries || []).map(c => c.iso_3166_1), ...(d.origin_country || [])])];
  return {
    v: FACTS_V, at: Date.now(), type, id: d.id,
    imdb: type === 'movie' ? d.imdb_id : d.external_ids?.imdb_id,
    title: d.title || d.name, orig: d.original_title || d.original_name,
    year: yearOf(d.release_date || d.first_air_date),
    poster: d.poster_path || null, vote: d.vote_average || 0, votes: d.vote_count || 0,
    lang: d.original_language,
    genres: (d.genres || []).map(g => g.id),
    countries,
    companies: (d.production_companies || []).map(c => c.id),
    keywords: (d.keywords?.keywords || d.keywords?.results || []).map(k => k.name.toLowerCase()),
    directors,
    cast: (d.credits?.cast || []).slice(0, 6).map(c => ({ id: c.id, name: c.name })),
    runtime: d.runtime || (d.episode_run_time || [])[0] || null,
    status: d.status, seasons: d.number_of_seasons || null,
  };
}

function cacheGet(key) {
  const f = store.get('f:' + key);
  if (f && f.v === FACTS_V && Date.now() - f.at < 1000 * 60 * 60 * 24 * 21) return f;
  return null;
}
export function cachePut(f) {
  if (store.set('f:' + f.type + ':' + f.id, f)) return;
  // storage full: drop the oldest half of cached facts and retry once
  const keys = store.keys('f:').map(k => [k, store.get(k)?.at || 0]).sort((a, b) => a[1] - b[1]);
  keys.slice(0, Math.ceil(keys.length / 2)).forEach(([k]) => store.del(k));
  store.set('f:' + f.type + ':' + f.id, f);
}

// Light details call for list items (keywords + credits are what the rules need).
export async function getFacts(type, id) {
  const key = type + ':' + id;
  const hit = cacheGet(key);
  if (hit) return hit;
  const append = type === 'movie' ? 'credits,keywords' : 'credits,keywords,external_ids';
  const d = await api(`/${type}/${id}`, { append_to_response: append });
  const f = factsFrom(d, type);
  cachePut(f);
  return f;
}

// Minimal facts from a list item, for display before the check finishes or if it fails.
export function stubFrom(item, type) {
  type = item.media_type && item.media_type !== 'person' ? item.media_type : type;
  return {
    type, id: item.id, title: item.title || item.name, orig: item.original_title || item.original_name,
    year: yearOf(item.release_date || item.first_air_date), poster: item.poster_path || null,
    vote: item.vote_average || 0, votes: item.vote_count || 0, lang: item.original_language,
    genres: item.genre_ids || [], countries: item.origin_country || [], keywords: [], directors: [], cast: [], stub: true,
  };
}

// Pick trailers: YouTube, Trailer first, official, highest resolution, newest (restorations look better).
export function pickVideos(videos) {
  const list = (videos?.results || []).filter(v => v.site === 'YouTube');
  const score = (v) => (v.type === 'Trailer' ? 1000 : v.type === 'Teaser' ? 500 : 0) + (v.official ? 200 : 0)
    + (v.size || 0) / 10 + (v.iso_639_1 === 'en' ? 40 : 0) + (/official trailer/i.test(v.name) ? 30 : 0);
  return list.sort((a, b) => score(b) - score(a) || String(b.published_at).localeCompare(String(a.published_at)))
    .filter(v => ['Trailer', 'Teaser', 'Clip', 'Featurette'].includes(v.type)).slice(0, 6);
}
