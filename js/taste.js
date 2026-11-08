// "Promising": the taste model. Scores come from data/taste.json, built offline with the movie-recommender
// skill's method: people on MovieTweetings whose IMDb ratings resemble his, weighted by similarity.
// Backtest on his own ratings (5-fold): of the model's top 10%, ~62% were titles he rated 8+ (his base rate 38%;
// ranking by crowd average gave ~54%). It knows nothing about his rules, so every result still goes through rules.js.
import { store } from './store.js';
import { find } from './tmdb.js';

let data = null, byImdb = new Map(), loading = null;

export function loadTaste() {
  if (data) return Promise.resolve(data);
  loading ||= fetch('data/taste.json', { cache: 'no-cache' }).then(r => r.json()).then(d => {
    const films = d.films.map(([imdb, score, year, genres, title, raters], rank) => ({ imdb, score, year, genres, title, raters, rank }));
    data = { mean: d.mean, method: d.method, films, total: films.length };
    byImdb = new Map(films.map(f => [f.imdb, f]));
    return data;
  }).catch(() => { data = { mean: 6.4, films: [], total: 0 }; return data; });
  return loading;
}
export function tasteData() { return data; }
export function tasteOf(imdb) { return imdb ? byImdb.get(imdb) || null : null; }

// Tier for display. Top 10% / 30% of everything the model can score; "below" = neighbours rated it under his average.
export function tier(t) {
  if (!t || !data) return null;
  const pct = (t.rank + 1) / data.total;
  if (pct <= 0.1) return { id: 'top', label: 'Top 10% match', pct };
  if (pct <= 0.3) return { id: 'good', label: 'Good match', pct };
  if (t.score < data.mean - 0.3) return { id: 'below', label: 'Weak match', pct };
  return { id: 'mid', label: 'Average match', pct };
}

// Ranking key used everywhere titles are ordered "promising first".
// Scored titles above his mean lead (by score); unscored follow by crowd rating; scored-below-mean go last.
export function promiseKey(x, crowd) {
  const t = tasteOf(x.f.imdb);
  const penalty = 0.35 * (x.ev.flags.length) + (x.ev.monkey ? 4 : 0);
  if (t && data && t.score >= data.mean) return 100 + t.score - penalty;
  if (t) return -100 + t.score - penalty;
  return crowd - penalty;
}

// IMDb id → TMDB {type, id}, cached per browser.
export async function resolveImdb(imdb) {
  const hit = store.get('m:' + imdb);
  if (hit) return hit.miss ? null : hit;
  const r = await find(imdb);
  const m = r.movie_results?.[0] ? { type: 'movie', id: r.movie_results[0].id } : r.tv_results?.[0] ? { type: 'tv', id: r.tv_results[0].id } : null;
  store.set('m:' + imdb, m || { miss: true });
  return m;
}
