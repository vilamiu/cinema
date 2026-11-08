"""Build the taste model files from MovieTweetings and my IMDb ratings.

  data/taste.json    user-based nearest neighbours (the movie-recommender skill's method): people whose IMDb ratings
                     resemble mine, weighted by similarity, predict my score for films I haven't rated.
  data/itemsim.json  item-item similarities (adjusted cosine) from the same data. The app uses them to learn from
                     new feedback without a rebuild: each "Not for me" or score given in the app moves the films
                     that people tend to rate the same way.

Usage:  python3 tools/taste.py MT_DIR [--extra verdicts.csv]
  MT_DIR   folder with MovieTweetings ratings.dat and movies.dat
           (raw.githubusercontent.com/sidooms/MovieTweetings/master/latest/)
  --extra  "Download CSV" from the app's Your list: scores count as ratings, "not for me" as DISMISS.
"""
import json, re, sys, pathlib, datetime
import numpy as np, pandas as pd
from scipy import sparse

ROOT = pathlib.Path(__file__).resolve().parent.parent
DISMISS = 3.0          # a "Not for me" counts like a 3/10
LEARN = 2.5            # strength of in-app learning (backtest 2026-11-08: top-30% hit rate 54.5% -> 62.6%)
K, MIN_SHARED, SHRINK, MIN_RATERS, CONF = 3000, 5, 10, 5, 8
SKIP_GENRES = {'Short', 'Documentary', 'Reality-TV', 'Talk-Show', 'Game-Show'}


def load_mt(mt_dir):
    r = pd.read_csv(f'{mt_dir}/ratings.dat', sep='::', engine='python', names=['u', 'm', 'r', 't'], dtype={'m': str})
    r['m'] = 'tt' + r['m'].str.zfill(7)
    cnt = r.groupby('u').size()
    r = r[r.u.isin(cnt[cnt >= 20].index)].copy()
    r['c'] = r.r - r.groupby('u').r.transform('mean')
    movies = sorted(set(r.m)); midx = {m: i for i, m in enumerate(movies)}
    users = sorted(set(r.u)); uidx = {u: i for i, u in enumerate(users)}
    R = sparse.csr_matrix((r.c.values.astype(np.float64), (r.u.map(uidx).values, r.m.map(midx).values)), shape=(len(users), len(movies)))
    B = R.copy(); B.data = np.ones_like(B.data)
    meta = {}
    for line in open(f'{mt_dir}/movies.dat', encoding='utf-8', errors='replace'):
        p = line.rstrip('\n').split('::')
        if len(p) < 3: continue
        t = p[1]; y = re.search(r'\((\d{4})\)\s*$', t)
        meta['tt' + p[0].zfill(7)] = (re.sub(r'\s*\(\d{4}\)\s*$', '', t), int(y.group(1)) if y else None, [g for g in p[2].split('|') if g])
    return {'R': R, 'B': B, 'R2': R.multiply(R).tocsr(), 'movies': movies, 'midx': midx, 'meta': meta}


def user_knn(mt, mine):
    """mine: {imdb: rating}. Returns (pred, raters, mu) arrays over mt['movies']."""
    R, B, R2, midx = mt['R'], mt['B'], mt['R2'], mt['midx']
    mu = float(np.mean(list(mine.values())))
    v = np.zeros(len(midx)); vb = np.zeros(len(midx))
    for m, x in mine.items():
        if m in midx: v[midx[m]] = x - mu; vb[midx[m]] = 1
    dot = R @ v; n = B @ vb; nu = np.sqrt(R2 @ vb); nme = np.sqrt(B @ (v * v))
    with np.errstate(divide='ignore', invalid='ignore'):
        sim = np.where((n >= MIN_SHARED) & (nu > 0) & (nme > 0), dot / (nu * nme), 0) * n / (n + SHRINK)
    sim[sim < 0] = 0
    top = np.argsort(-sim)[:K]; top = top[sim[top] > 0]
    s = np.zeros(R.shape[0]); s[top] = sim[top]
    num = R.T @ s; den = B.T @ s; raters = B.T @ (s > 0).astype(float)
    pred = mu + num / (den + 0.5)
    pred = mu + (pred - mu) * raters / (raters + CONF)      # shrink thin evidence toward my mean
    return pred, raters, mu


def candidates(mt, mine, pred, raters):
    out = []
    for m, i in mt['midx'].items():
        if m in mine or raters[i] < MIN_RATERS: continue
        t, y, g = mt['meta'].get(m, ('', None, []))
        if SKIP_GENRES & set(g): continue
        out.append([m, round(float(pred[i]), 2), y, g, t, int(raters[i])])
    out.sort(key=lambda x: -x[1])
    return out


def item_sims(mt, cand_ids, pool_ids, top=20, min_co=5, shrink=25):
    """For each film in pool, its `top` most similar films among candidates (adjusted cosine, shrunk by co-raters)."""
    R, B, midx = mt['R'].tocsc(), mt['B'].tocsc(), mt['midx']
    ci = np.array([midx[m] for m in cand_ids]); pi = np.array([midx[m] for m in pool_ids])
    Rc, Rp, Bc, Bp = R[:, ci], R[:, pi], B[:, ci], B[:, pi]
    norm_c = np.sqrt(np.asarray(Rc.multiply(Rc).sum(0)).ravel()) + 1e-9
    norm_p = np.sqrt(np.asarray(Rp.multiply(Rp).sum(0)).ravel()) + 1e-9
    cand_pos = {m: k for k, m in enumerate(cand_ids)}
    out = {}
    for start in range(0, len(pool_ids), 800):
        sl = slice(start, start + 800)
        S = (Rp[:, sl].T @ Rc).toarray() / norm_p[sl, None] / norm_c[None, :]
        N = (Bp[:, sl].T @ Bc).toarray()
        S = S * N / (N + shrink); S[N < min_co] = 0
        for row, m in enumerate(pool_ids[sl]):
            if m in cand_pos: S[row, cand_pos[m]] = 0
            idx = np.argpartition(-np.abs(S[row]), top)[:top]
            idx = idx[np.abs(S[row, idx]) >= 0.05]
            idx = idx[np.argsort(-np.abs(S[row, idx]))]
            if len(idx): out[m] = [[int(k), round(float(S[row, k]), 3)] for k in idx]
    return out


def main():
    mt_dir = sys.argv[1]
    mine = {e['imdb']: e['rating'] for e in json.load(open(ROOT / 'data/ratings.json'))['ratings']}
    if '--extra' in sys.argv:
        import csv
        for row in csv.DictReader(open(sys.argv[sys.argv.index('--extra') + 1])):
            if not row.get('imdb'): continue
            if row['status'] == 'seen' and row.get('rating'): mine[row['imdb']] = int(row['rating'])
            elif row['status'] == 'notforme' and row['imdb'] not in mine: mine[row['imdb']] = DISMISS
    mt = load_mt(mt_dir)
    pred, raters, mu = user_knn(mt, mine)
    films = candidates(mt, mine, pred, raters)
    built = datetime.date.today().isoformat()
    json.dump({'v': 1, 'method': f'user-kNN on MovieTweetings (skill method), neighbours={K}, min {MIN_RATERS} neighbour raters',
               'built': built, 'mean': round(mu, 2), 'films': films}, open(ROOT / 'data/taste.json', 'w'), ensure_ascii=False, separators=(',', ':'))
    cand_ids = [f[0] for f in films]
    counts = np.asarray(mt['B'].sum(0)).ravel()
    pool = sorted(set(cand_ids) | {m for m, i in mt['midx'].items() if counts[i] >= 30})
    sims = item_sims(mt, cand_ids, pool)
    json.dump({'v': 1, 'built': built, 'dismiss': DISMISS, 'learn': LEARN, 'cands': cand_ids, 'sims': sims},
              open(ROOT / 'data/itemsim.json', 'w'), separators=(',', ':'))
    print(f'mean {mu:.2f} · {len(films)} scored films · item lists for {len(sims)} films')


if __name__ == '__main__':
    main()
