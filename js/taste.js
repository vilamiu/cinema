// "Promising": the taste model. Scores come from data/taste.json, built offline with the movie-recommender
// skill's method: people on MovieTweetings whose IMDb ratings resemble his, weighted by similarity.
// Backtest on his own ratings (5-fold): of the model's top 10%, ~62% were titles he rated 8+ (his base rate 38%;
// ranking by crowd average gave ~54%). It knows nothing about his rules, so every result still goes through rules.js.
//
// Learning from feedback (retune): data/itemsim.json lists, for each film, the films people rate most like it.
// Every "Not for me" (and any score of 4 or less given in the app) counts as a 3/10 and moves those films:
// score += LEARN * sum(sim * (3 - mean)) / (sum|sim| + 1). Backtest on his ratings since February (low ratings
// used as stand-ins for dismissals): share of 8+ among the top 30% went from ~54% to ~60%; learning from high
// scores the same way made it worse, so only negative feedback is used.
import { store } from './store.js';
import { find } from './tmdb.js';

let data = null, byImdb = new Map(), loading = null, sim = null;

export function loadTaste() {
  if (data) return Promise.resolve(data);
  const simP = fetch('data/itemsim.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  loading ||= fetch('data/taste.json', { cache: 'no-cache' }).then(r => r.json()).then(async d => {
    const films = d.films.map(([imdb, score, year, genres, title, raters], rank) => ({ imdb, score, base: score, year, genres, title, raters, rank, corr: 0, because: [] }));
    data = { mean: d.mean, method: d.method, films, total: films.length };
    byImdb = new Map(films.map(f => [f.imdb, f]));
    sim = await simP;
    return data;
  }).catch(() => { data = { mean: 6.4, films: [], total: 0 }; return data; });
  return loading;
}

// Re-rank from feedback. verdicts: the shared list; enabled: the Settings switch.
export function retune(verdicts, enabled = true) {
  if (!data?.total) return;
  for (const f of data.films) { f.corr = 0; f.because = []; }
  if (sim && enabled) {
    const w = (sim.dismiss ?? 3) - data.mean, learn = sim.learn ?? 2.5;
    const num = new Map(), den = new Map(), why = new Map();
    for (const v of Object.values(verdicts || {})) {
      if (!v?.imdb || !(v.status === 'notforme' || (v.status === 'seen' && v.rating && v.rating <= 4))) continue;
      for (const [k, s] of sim.sims[v.imdb] || []) {
        const c = sim.cands[k];
        num.set(c, (num.get(c) || 0) + s * w);
        den.set(c, (den.get(c) || 0) + Math.abs(s));
        if (s > 0) { if (!why.has(c)) why.set(c, []); why.get(c).push([s, v.title]); }
      }
    }
    for (const [c, n] of num) {
      const f = byImdb.get(c); if (!f) continue;
      f.corr = learn * n / (den.get(c) + 1);
      f.because = (why.get(c) || []).sort((a, b) => b[0] - a[0]).map(x => x[1]).filter((t, i, a) => t && a.indexOf(t) === i).slice(0, 2);
    }
  }
  for (const f of data.films) f.score = Math.round((f.base + f.corr) * 100) / 100;
  data.films.sort((a, b) => b.score - a.score);
  data.films.forEach((f, i) => { f.rank = i; });
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
