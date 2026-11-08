// Cinema: router, views, header search, trail.
import { h, debounce, fmtRuntime, fmtVotes, countryName, demonym, genreName, DECADES, MOVIE_GENRES, TV_GENRES, norm } from './util.js';
import { store, verdicts, setVerdict, settings, setSettings, rulesOff, setRuleOff } from './store.js';
import * as tmdb from './tmdb.js';
import { AuthError, hasKey, img } from './tmdb.js';
import { evaluate, HARD_RULES, imdbGenres } from './rules.js';
import { loadProfile, getProfile, onProfile, personRatings, syncProfile, isSyncing, importRatings, resetImport, rebuildProfile } from './profile.js';
import { card, ResultList, personCard, posterBox, trailerBox, loading, icons, titleHref } from './components.js';
import { loadTaste, tasteData, tasteOf, tier, promiseKey, resolveImdb } from './taste.js';

const view = document.getElementById('view');
let navToken = 0;

// ---------------- helpers ----------------
function toast(msg) {
  document.querySelector('.toast')?.remove();
  const t = h('div.toast', { role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

async function check(items, type, ctx = {}) {
  const prof = getProfile(); const v = verdicts(); const off = rulesOff();
  return Promise.all(items.map(async (it) => {
    const t = it.media_type && it.media_type !== 'person' ? it.media_type : type;
    let f;
    try { f = await tmdb.getFacts(t, it.id); }
    catch (e) { if (e instanceof AuthError) throw e; f = tmdb.stubFrom(it, t); }
    return { f, ev: evaluate(f, prof, v, off, ctx) };
  }));
}

// Walk the taste list (best predicted first): resolve each IMDb id on TMDB, then check it against the rules.
// filter(t) runs on the offline record (year, IMDb genres); match(f) on TMDB facts (type, country, keyword).
async function walkTaste(state, { filter = () => true, match = () => true, want = 16, maxExamine = 96, ctx = {} } = {}) {
  const films = tasteData()?.films || [];
  const out = [];
  let examined = 0;
  while (state.next < films.length && examined < maxExamine && out.filter(x => !x.ev.hide.length).length < want) {
    const chunk = [];
    while (state.next < films.length && chunk.length < 12) { const t = films[state.next++]; if (filter(t)) chunk.push(t); }
    if (!chunk.length) break;
    examined += chunk.length;
    const facts = await Promise.all(chunk.map(async (t) => {
      try {
        const m = await resolveImdb(t.imdb);
        if (!m) return null;
        const f = await tmdb.getFacts(m.type, m.id);
        if (!f.imdb) f.imdb = t.imdb;
        return f;
      } catch (e) { if (e instanceof AuthError) throw e; return null; }
    }));
    const prof = getProfile(), v = verdicts(), off = rulesOff();
    for (const f of facts) if (f && match(f)) out.push({ f, ev: evaluate(f, prof, v, off, ctx) });
  }
  state.done = state.next >= films.length;
  state.examined = (state.examined || 0) + examined;
  out.sort((a, b) => promiseKey(b, weighted(b.f)) - promiseKey(a, weighted(a.f)));
  return out;
}
const byPromise = (a, b) => promiseKey(b, weighted(b.f)) - promiseKey(a, weighted(a.f));

function dedupe(list, key = (x) => (x.media_type || '') + x.id) {
  const seen = new Set();
  return list.filter(x => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; });
}

const weighted = (f) => (f.vote || 0) * Math.min(1, (f.votes || 0) / 400) + Math.min(f.votes || 0, 4000) / 4000;

function section(title, count, ...kids) {
  return h('section.section', h('header', h('h2.sec', title, count != null ? h('span.count', count) : null)), ...kids);
}

function parseHash() {
  const raw = (location.hash || '#/').slice(1);
  const i = raw.indexOf('?');
  return { path: (i < 0 ? raw : raw.slice(0, i)) || '/', q: new URLSearchParams(i < 0 ? '' : raw.slice(i + 1)) };
}
function go(path, params) {
  const qs = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString() : '';
  location.hash = '#' + path + (qs ? '?' + qs : '');
}

// ---------------- scores waiting to be added on IMDb ----------------
function pendingImdb() {
  const prof = getProfile();
  const list = Object.values(verdicts()).filter(x => x.status === 'seen' && x.rating && !x.imdbDone);
  // a score the latest IMDb export already shows is on IMDb: mark it done quietly
  const onImdb = list.filter(x => x.imdb && prof?.byImdb.get(x.imdb)?.exportRating === x.rating);
  onImdb.forEach(x => setVerdict(x, { imdbDone: true }));
  return list.filter(x => !onImdb.includes(x));
}
function updatePendingBadge() {
  const a = document.querySelector('[data-nav="saved"]');
  if (!a) return;
  a.querySelector('.pend')?.remove();
  const n = pendingImdb().length;
  if (n) a.append(h('span.pend', { title: `${n} score${n > 1 ? 's' : ''} not on IMDb yet` }, String(n)));
}

// ---------------- trail (every place visited this session, tappable) ----------------
function trailGet() { try { return JSON.parse(sessionStorage.getItem('ra:trail') || '[]'); } catch { return []; } }
function trailSet(t) { try { sessionStorage.setItem('ra:trail', JSON.stringify(t)); } catch { /* ignore */ } }
function trailPush(label, kind) {
  const hash = location.hash || '#/';
  let t = trailGet();
  const i = t.findIndex(x => x.hash === hash);
  if (i >= 0) t[i].label = label; else t.push({ hash, label, kind });
  if (t.length > 40) t = t.slice(-40);
  trailSet(t); renderTrail();
}
function renderTrail() {
  const t = trailGet();
  const bar = document.getElementById('trail');
  const inner = document.getElementById('trailInner');
  bar.hidden = t.length < 2;
  if (bar.hidden) return;
  const hash = location.hash || '#/';
  const kids = [h('span.lab', 'Trail')];
  t.forEach((x, i) => {
    if (i) kids.push(h('span.sep', '›'));
    kids.push(h('a' + (x.hash === hash ? '.cur' : ''), { href: x.hash, title: x.label }, x.label));
  });
  kids.push(h('button.clear', { type: 'button', onclick: () => { trailSet([]); renderTrail(); } }, 'Clear'));
  inner.replaceChildren(...kids);
  inner.querySelector('.cur')?.scrollIntoView({ block: 'nearest', inline: 'center' });
}

// ---------------- TMDB key panel ----------------
function keyForm() {
  const input = h('input', { type: 'password', placeholder: 'Paste your TMDB API key or read access token', autocomplete: 'off', spellcheck: 'false', value: store.get('tmdbKey') || '', 'aria-label': 'TMDB key' });
  const status = h('span.note');
  const save = async () => {
    const k = input.value.trim();
    status.classList.remove('err');
    if (!k) { status.textContent = 'Paste the key first.'; return; }
    store.set('tmdbKey', k);
    status.textContent = 'Checking…';
    try {
      await tmdb.api('/configuration', {}, { fresh: true });
      status.textContent = '';
      toast('Key works. Matching your ratings in the background.');
      startSync();
      route();
    } catch (e) {
      store.del('tmdbKey');
      status.textContent = e instanceof AuthError ? 'TMDB rejected that key. Check you copied all of it.' : 'Could not reach TMDB: ' + e.message;
      status.classList.add('err');
    }
  };
  return h('div.section', h('form.keyrow', { onsubmit: (e) => { e.preventDefault(); save(); } }, input, h('button.btn.primary', { type: 'submit' }, 'Save key')), status);
}

function keyPanel(message) {
  return h('section.panel.onboard',
    h('h2.sec', message ? 'TMDB key needed' : 'One step before the first jump'),
    h('p.lede', message || 'Posters, cast, trailers and discovery come live from TMDB, which needs a free personal key. It stays in this browser only.'),
    h('ol',
      h('li', 'Sign in or create a free account at ', h('a', { href: 'https://www.themoviedb.org/signup', target: '_blank', rel: 'noopener' }, 'themoviedb.org'), '.'),
      h('li', 'Open ', h('a', { href: 'https://www.themoviedb.org/settings/api', target: '_blank', rel: 'noopener' }, 'Settings → API'), ' and request a Developer key (personal use; any URL works for the form).'),
      h('li', 'Copy the "API Read Access Token" (or the shorter "API Key") and paste it here.')),
    keyForm());
}

function renderError(e) {
  if (e instanceof AuthError) {
    view.replaceChildren(keyPanel(hasKey() ? 'TMDB rejected the saved key. Paste it again or make a new one.' : null));
    return;
  }
  console.error(e);
  view.replaceChildren(h('section.panel',
    h('h2.sec', 'Something went wrong'),
    h('p.err', e.message || String(e)),
    h('p.note', 'Usually a network hiccup or TMDB rate limit.'),
    h('div.row', h('button.btn.primary', { type: 'button', onclick: route }, 'Try again'), h('a.btn', { href: '#/' }, 'Home'))));
}

// ---------------- router ----------------
async function route() {
  const token = ++navToken;
  const live = () => token === navToken;
  const { path, q } = parseHash();
  closeSuggest();
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on', path === '/' + a.dataset.nav));
  view.replaceChildren(loading());
  window.scrollTo(0, 0);
  const needsKey = !['/', '/saved', '/settings', '/seeds'].includes(path);
  try {
    if (needsKey && !hasKey()) { view.replaceChildren(keyPanel()); return; }
    let m;
    if (path === '/') await homeView(live);
    else if ((m = path.match(/^\/(movie|tv)\/(\d+)$/))) await titleView(m[1], +m[2], live);
    else if ((m = path.match(/^\/person\/(\d+)$/))) await personView(+m[1], q, live);
    else if ((m = path.match(/^\/imdb\/(tt\d+)$/))) await imdbJump(m[1], live);
    else if (path === '/discover') await discoverView(q, live);
    else if (path === '/search') await searchView(q, live);
    else if (path === '/countries') await countriesView(live);
    else if (path === '/genres') await genresView(q, live);
    else if (path === '/decades') await decadesView(q, live);
    else if (path === '/seeds') await seedsView(q, live);
    else if (path === '/people') await peopleView(q, live);
    else if (path === '/films') await filmsView(live);
    else if (path === '/saved') await savedView(q, live);
    else if (path === '/settings') await settingsView(live);
    else view.replaceChildren(h('p.empty', 'That page does not exist.'), h('a.btn', { href: '#/' }, 'Home'));
  } catch (e) {
    if (live()) renderError(e);
  }
  if (live()) { renderTrail(); updatePendingBadge(); }
}

// ---------------- Home ----------------
function door(title, sub, onclick, n) {
  return h('button.door', { type: 'button', onclick }, n ? h('span.d-n', n) : null, h('span.d-t', title), h('span.d-s', sub));
}

function seedHref(e) { return e.synced ? `#/${e.tmdbType}/${e.tmdbId}` : `#/imdb/${e.imdb}`; }
function seedCard(e) {
  const p = posterBox(e.poster, e.title);
  p.append(h('span.badge', 'You ' + e.rating));
  return h('a.card', { href: seedHref(e), title: `${e.title} (${e.year})` }, p, h('div.t', e.title), h('div.m', h('span', String(e.year || '')), h('span', (e.countries || []).slice(0, 2).join('/'))));
}

async function homeView(live) {
  document.title = 'Cinema';
  const prof = getProfile();
  const kids = [];
  if (!hasKey()) kids.push(keyPanel());
  const nCountries = [...prof.groups.keys()].filter(k => k.startsWith('c:')).length;
  const canPromise = hasKey() && tasteData()?.total;
  const promWrap = h('div.rail', loading('Finding your best bets'));
  if (canPromise) {
    kids.push(section('Promising for you', `(${prof.total} movies reviewed)`,
      h('p.note', 'Ranked by people whose ratings look like yours, then checked against your rules.'),
      promWrap,
      h('div.row', h('a.btn.small', { href: '#/discover?sort=promising' }, 'More promising films'), h('a.btn.small', { href: '#/genres' }, 'Promising by genre'))));
  }
  kids.push(h('section.section',
    h('h1.h-display', 'Start from'),
    h('div.doors',
      door('Actor', 'New faces from your best bets, and your favourites', () => go('/people', { role: 'actor' })),
      door('Director', 'Directors you haven\'t tried yet, and your best', () => go('/people', { role: 'director' })),
      door('Film', 'Your most promising films, or one you loved', () => go('/films')),
      door('Country', `${nCountries} countries in your ratings`, () => go('/countries')),
      door('Genre', 'Promising first, then top rated', () => go('/genres')),
      door('Decade', '1920s to now', () => go('/decades')),
    )));

  const tens = prof.entries.filter(e => e.rating === 10).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (tens.length) {
    kids.push(section('Start from a 10', `${tens.length} titles`,
      h('div.rail', tens.slice(0, 30).map(seedCard)),
      h('div.row', h('a.btn.small', { href: '#/seeds?min=9' }, 'All your 9s and 10s'))));
  }

  const v = Object.values(verdicts()).filter(x => x.status === 'watchlist');
  if (v.length) {
    kids.push(section('Your list', `${v.length}`, h('div.rail', v.slice(0, 20).map(x => {
      const p = posterBox(x.poster, x.title);
      return h('a.card', { href: `#/${x.type}/${x.id}` }, p, h('div.t', x.title), h('div.m', h('span', String(x.year || ''))));
    }))));
  }

  kids.push(h('div.statline',
    h('span', h('b', String(prof.total)), ' ratings loaded'),
    h('span', h('b', Math.round(prof.hitRate * 100) + '%'), ' of them at 8+ (the bar to beat)'),
    h('span', h('b', `${prof.syncedCount}/${prof.total}`), ' matched on TMDB'),
    h('a', { href: '#/settings', style: { color: 'var(--bulb)' } }, 'Rules and data')));

  if (!live()) return;
  view.replaceChildren(...kids);
  trailPush('Home', 'home');

  if (canPromise) {
    const vis = await topPromising(18, 260, live);
    if (!vis) return;
    promWrap.replaceChildren(...(vis.length ? vis.slice(0, 18).map(card) : [h('p.empty', 'Nothing in your taste list passes your rules yet.')]));
  }
}

// The best-predicted titles that pass the rules (walks the taste list; results are cached per browser).
async function topPromising(want, cap, live) {
  const st = { next: 0 }; const got = [];
  while (got.filter(x => !x.ev.hide.length).length < want && !st.done && (st.examined || 0) < cap) {
    got.push(...await walkTaste(st, { want, maxExamine: 60 }));
    if (!live()) return null;
  }
  return got.filter(x => !x.ev.hide.length).sort(byPromise);
}

// ---------------- Start pages: Actors / Directors / Films ----------------
function inlineSearch({ placeholder, mode }) {
  const results = h('div.section');
  const input = h('input.filter-input.wide', { type: 'search', placeholder, 'aria-label': placeholder, autocomplete: 'off', enterkeyhint: 'search' });
  let token = 0;
  const run = debounce(async () => {
    const s = input.value.trim(); const my = ++token;
    if (s.length < 2) { results.replaceChildren(); return; }
    results.replaceChildren(loading('Searching'));
    try {
      if (mode === 'film') {
        const r = await tmdb.search(s);
        const titles = r.results.filter(x => x.media_type === 'movie' || x.media_type === 'tv').slice(0, 18);
        const checked = await check(titles, 'movie');
        if (my !== token) return;
        const list = new ResultList({ showHidden: true, empty: 'No films or series match.' });
        list.add(checked);
        results.replaceChildren(list.el);
      } else {
        const r = await tmdb.searchPeople(s);
        if (my !== token) return;
        const want = mode === 'director' ? 'Directing' : 'Acting';
        const ppl = r.results.slice().sort((a, b) => (b.known_for_department === want) - (a.known_for_department === want)).slice(0, 18);
        results.replaceChildren(ppl.length
          ? h('div.grid.people', ppl.map(p => personCard(p, [p.known_for_department, (p.known_for || []).map(k => k.title || k.name).slice(0, 2).join(', ')].filter(Boolean).join(' · '), mode === 'director' ? 'directing' : 'acting')))
          : h('p.empty', 'Nobody by that name on TMDB.'));
      }
    } catch (e) { if (my === token) results.replaceChildren(h('p.err', e.message)); }
  }, 250);
  input.addEventListener('input', run);
  return h('div.section', input, results);
}

function peopleFromRatings(role) {
  const m = new Map();
  for (const e of getProfile().entries) {
    const refs = role === 'director' ? (e.directorRefs || []) : (e.castRefs || []).slice(0, 3);
    for (const p of refs) {
      let g = m.get(p.id);
      if (!g) m.set(p.id, g = { id: p.id, name: p.name, n: 0, sum: 0, n8: 0 });
      g.n++; g.sum += e.rating; if (e.rating >= 8) g.n8++;
    }
  }
  return [...m.values()].map(g => ({ ...g, avg: g.sum / g.n }));
}

async function withPhotos(people) {
  const paths = await Promise.all(people.map(p => tmdb.api('/person/' + p.id).then(r => r.profile_path).catch(() => null)));
  return people.map((p, i) => ({ ...p, profile_path: paths[i] }));
}

async function peopleView(q, live) {
  const role = q.get('role') === 'director' ? 'director' : 'actor';
  const as = role === 'director' ? 'directing' : 'acting';
  const title = role === 'director' ? 'Directors' : 'Actors';
  document.title = title + ' · Cinema';
  const yours = peopleFromRatings(role).filter(g => g.n >= 2 && g.avg >= 7.5).sort((a, b) => b.n8 - a.n8 || b.avg - a.avg).slice(0, 24);
  const yoursGrid = h('div.grid.people', yours.map(g => personCard(g, `avg ${g.avg.toFixed(1)} · ${g.n} rated`, as)));
  const newWrap = h('div.section', loading('Reading your most promising films (first time takes a moment)'));
  view.replaceChildren(
    h('h1.h-display', title),
    inlineSearch({ placeholder: role === 'director' ? 'Search a director' : 'Search an actor', mode: role }),
    section('New to you', null, h('p.note', role === 'director'
      ? 'Directors behind your most promising films, none of whose work you have rated.'
      : 'Leads of your most promising films whom you have never rated.'), newWrap),
    yours.length ? section(`Your best ${title.toLowerCase()}`, `${yours.length}`, h('p.note', 'From your ratings: average 7.5 or higher across 2 or more titles.'), yoursGrid) : null);
  trailPush(title, 'pick');

  withPhotos(yours).then(ps => { if (live()) yoursGrid.replaceChildren(...ps.map(g => personCard(g, `avg ${g.avg.toFixed(1)} · ${g.n} rated`, as))); });

  if (!tasteData()?.total) { newWrap.replaceChildren(h('p.empty', 'No taste data loaded.')); return; }
  const top = await topPromising(70, 240, live);
  if (!top) return;
  const known = new Set(getProfile().entries.flatMap(e => role === 'director' ? (e.directorRefs || []).map(d => d.id) : (e.castRefs || []).slice(0, 6).map(c => c.id)));
  const agg = new Map();
  for (const x of top) {
    const ppl = role === 'director' ? x.f.directors : x.f.cast.slice(0, 3);
    const t = tasteOf(x.f.imdb);
    for (const p of ppl) {
      if (known.has(p.id)) continue;
      let g = agg.get(p.id);
      if (!g) agg.set(p.id, g = { id: p.id, name: p.name, films: [], sum: 0 });
      if (!g.films.includes(x.f.title)) { g.films.push(x.f.title); g.sum += t ? t.score : 0; }
    }
  }
  const fresh = [...agg.values()].sort((a, b) => b.films.length - a.films.length || b.sum - a.sum).slice(0, 18);
  const sub = (g) => g.films.slice(0, 2).join(', ') + (g.films.length > 2 ? ` +${g.films.length - 2}` : '');
  if (!live()) return;
  if (!fresh.length) { newWrap.replaceChildren(h('p.empty', 'Everyone behind your best bets is already in your ratings.')); return; }
  newWrap.replaceChildren(h('div.grid.people', fresh.map(g => personCard(g, sub(g), as))));
  const ps = await withPhotos(fresh);
  if (live()) newWrap.replaceChildren(h('div.grid.people', ps.map(g => personCard(g, sub(g), as))));
}

async function filmsView(live) {
  document.title = 'Films · Cinema';
  const prof = getProfile();
  const favs = prof.entries.filter(e => e.rating >= 9).sort((a, b) => b.rating - a.rating || String(b.date).localeCompare(String(a.date))).slice(0, 20);
  const promWrap = h('div.section', loading('Finding your best bets'));
  view.replaceChildren(
    h('h1.h-display', 'Films'),
    inlineSearch({ placeholder: 'Search a film or series', mode: 'film' }),
    section('Most promising for you', null, h('p.note', 'Ranked by people whose ratings look like yours, then checked against your rules.'), promWrap,
      h('div.row', h('a.btn.small', { href: '#/discover?sort=promising' }, 'Narrow by genre, country or decade'))),
    favs.length ? section('Start from one you loved', null, h('div.rail', favs.map(seedCard)), h('div.row', h('a.btn.small', { href: '#/seeds?min=9' }, 'All your 9s and 10s'))) : null);
  trailPush('Films', 'pick');
  if (!tasteData()?.total) { promWrap.replaceChildren(h('p.empty', 'No taste data loaded.')); return; }
  const top = await topPromising(24, 300, live);
  if (!top) return;
  const list = new ResultList({ showHidden: settings().showHidden, empty: 'Nothing in your taste list passes your rules yet.' });
  list.add(top.slice(0, 24));
  promWrap.replaceChildren(list.el);
}

async function imdbJump(tt, live) {
  const r = await tmdb.find(tt);
  if (!live()) return;
  const hit = r.movie_results[0] ? ['movie', r.movie_results[0]] : r.tv_results[0] ? ['tv', r.tv_results[0]] : null;
  if (!hit) {
    view.replaceChildren(h('section.panel', h('h2.sec', 'Not on TMDB'), h('p.note', `TMDB has no match for ${tt}.`), h('a.btn', { href: `https://www.imdb.com/title/${tt}/`, target: '_blank', rel: 'noopener' }, 'Open on IMDb', icons.ext())));
    return;
  }
  location.replace(`#/${hit[0]}/${hit[1].id}`);
}

// ---------------- Title (film or series) ----------------
async function titleView(type, id, live) {
  const d = await tmdb.details(type, id);
  if (!live()) return;
  const f = tmdb.factsFrom(d, type);
  tmdb.cachePut(f);
  const prof = getProfile();
  let ev = evaluate(f, prof, verdicts(), rulesOff());
  document.title = `${f.title}${f.year ? ' (' + f.year + ')' : ''} · Cinema`;

  const dec = f.year ? Math.floor(f.year / 10) * 10 : null;
  const writers = (d.credits?.crew || []).filter(c => ['Screenplay', 'Writer', 'Novel', 'Story'].includes(c.job));
  const mine = ev.rated?.rating ?? (ev.verdict?.status === 'seen' ? ev.verdict.rating : null);

  // hero
  const hero = h('section.hero',
    d.backdrop_path ? h('div.backdrop', h('img', { src: img(d.backdrop_path, 'w1280'), alt: '' })) : null,
    h('div.hero-grid',
      posterBox(d.poster_path, f.title, 'w500'),
      h('div',
        d.tagline ? h('div.tagline', d.tagline) : null,
        h('h1', f.title),
        f.orig && f.orig !== f.title ? h('div.orig', f.orig) : null,
        h('div.meta',
          type === 'tv' ? h('span', 'Series') : null,
          f.year ? h('a', { href: `#/discover?type=${type}&decade=${dec}` }, String(f.year)) : null,
          f.runtime ? h('span', fmtRuntime(f.runtime) + (type === 'tv' ? ' / ep' : '')) : null,
          type === 'tv' && d.number_of_seasons ? h('span', `${d.number_of_seasons} season${d.number_of_seasons > 1 ? 's' : ''} · ${d.status}`) : null,
          ...(f.countries || []).map(c => h('a', { href: `#/discover?type=${type}&country=${c}` }, countryName(c)))),
        h('div.row', { style: { marginTop: '12px' } }, (d.genres || []).map(g => h('a.chip', { href: `#/discover?type=${type}&genre=${g.id}` }, g.name))),
        h('div.scores',
          f.vote ? h('div.score', h('span.v', f.vote.toFixed(1)), h('span.k', `TMDB · ${fmtVotes(f.votes)} votes`)) : null,
          ev.rated?.imdbRating ? h('div.score', h('span.v', ev.rated.imdbRating.toFixed(1)), h('span.k', 'IMDb')) : null,
          mine ? h('div.score.mine', h('span.v', String(mine)), h('span.k', 'You')) : null))));

  // verdict / your rules
  const vbox = h('div.panel.verdict');
  const drawVerdict = () => {
    ev = evaluate(f, getProfile(), verdicts(), rulesOff());
    const items = [];
    if (ev.hide.length) items.push(h('div.banner-hide', 'Your rules would hide this'));
    const list = h('ul.vlist',
      ev.hide.map(x => h('li.hide', x.text)),
      !ev.hide.length ? h('li.ok', 'Passes your hard rules') : null,
      ev.flags.map(x => h('li.flag', x)));
    const info = [...new Map(ev.veto.info.map(g => [g.key, g])).values()].slice(0, 5);
    const t = tasteOf(f.imdb), tr = tier(t), td = tasteData();
    if (!ev.rated) {
      const line = !t ? h('li.info', 'No verdict: too few people with your taste have rated it.')
        : tr.id === 'below' ? h('li.flag', `${tr.label}: the ${t.raters} people with taste like yours who rated it mostly scored it below your average.`)
        : h('li' + (tr.id === 'mid' ? '.info' : '.good'), `${tr.label}: ranked in the top ${Math.max(1, Math.round(tr.pct * 100))}% of ${td.total.toLocaleString()} films, from ${t.raters} people with taste like yours.`);
      items.push(h('h3', 'Your taste'), h('ul.vlist', line));
    }
    items.push(h('h3', 'Your rules'), list);
    if (info.length) items.push(h('h3', 'Your data'), h('ul.vlist', info.map(g => h('li.info', `${g.label.replace(/^Your /, '')}: ${g.n} rated · ${g.n8} at 8+ · avg ${g.avg.toFixed(1)}`))));
    items.push(h('h3', 'Check before watching'), h('div.links',
      h('a', { href: `https://www.doesthedogdie.com/search?q=${encodeURIComponent(f.title)}`, target: '_blank', rel: 'noopener' }, 'Does the Dog Die? (animal content)'),
      f.imdb ? h('a', { href: `https://www.imdb.com/title/${f.imdb}/parentalguide`, target: '_blank', rel: 'noopener' }, 'IMDb Parents Guide') : null,
      f.imdb ? h('a', { href: `https://www.imdb.com/title/${f.imdb}/`, target: '_blank', rel: 'noopener' }, 'IMDb page (HD trailer)') : null));
    vbox.replaceChildren(...items);

    drawScore();
  };

  // Your score: one tap saves it here; IMDb takes it via one more tap in its app or site.
  const scorebox = h('section.panel.scorebox');
  const imdbUrl = f.imdb ? `https://www.imdb.com/title/${f.imdb}/` : `https://www.imdb.com/find/?q=${encodeURIComponent(f.title + ' ' + (f.year || ''))}`;
  const drawScore = () => {
    const v = verdicts()[f.type + ':' + f.id];
    const appScore = v?.status === 'seen' ? v.rating : null;
    const current = appScore ?? ev.rated?.rating ?? null;
    const pick = (n) => {
      setVerdict(f, { status: 'seen', rating: n, imdbDone: false, imdbOpened: false });
      rebuildProfile();
      toast(`Saved ${n}/10`);
      drawVerdict();
      updatePendingBadge();
    };
    const head = current
      ? h('div.sb-head', h('span.sb-title', 'Your score'), h('span.sb-cur', `${current}/10`),
        appScore ? h('span.mono.dim', v.imdbDone ? 'on IMDb' : 'saved here') : h('span.mono.dim', `on IMDb${ev.rated?.date ? ' since ' + ev.rated.date : ''}`))
      : h('div.sb-head', h('span.sb-title', 'Seen it? Tap your score'));
    const nums = h('div.sb-nums', { role: 'group', 'aria-label': 'Your score out of 10' },
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => h('button.sc' + (current === n ? '.on' : ''), { type: 'button', 'aria-pressed': String(current === n), onclick: () => pick(n) }, String(n))));
    let step = null;
    if (appScore && !v.imdbDone) {
      step = h('div.imdbstep',
        h('div', h('b', `Add ${appScore}/10 to IMDb`), h('div.note', v.imdbOpened ? 'Tap Rate on the IMDb page, pick ' + appScore + ', then come back and confirm.' : 'IMDb only accepts ratings from its own app or site: this opens the film there.')),
        h('div.row',
          h('a.btn.imdb', { href: imdbUrl, target: '_blank', rel: 'noopener', onclick: () => { setVerdict(f, { imdbOpened: true }); setTimeout(drawScore, 400); } }, `Rate ${appScore} on IMDb`, icons.ext()),
          h('button.btn' + (v.imdbOpened ? '.primary' : ''), { type: 'button', onclick: () => { setVerdict(f, { imdbDone: true }); toast('Marked as on IMDb'); drawScore(); updatePendingBadge(); } }, icons.check(), "It's on IMDb")));
    }
    const w = verdicts()[f.type + ':' + f.id];
    const acts = h('div.actions',
      appScore ? null : h('button.btn' + (w?.status === 'watchlist' ? '.on' : ''), { type: 'button', onclick: () => { const on = w?.status === 'watchlist'; setVerdict(f, { status: on ? null : 'watchlist' }); toast(on ? 'Removed from your list' : 'Added to your list'); drawVerdict(); } },
        w?.status === 'watchlist' ? icons.check() : icons.plus(), w?.status === 'watchlist' ? 'On your list' : 'Want to watch'),
      appScore ? null : h('button.btn.danger' + (w?.status === 'notforme' ? '.on' : ''), { type: 'button', onclick: () => { const on = w?.status === 'notforme'; setVerdict(f, { status: on ? null : 'notforme' }); toast(on ? 'Undone' : 'Hidden from now on'); drawVerdict(); } },
        icons.x(), w?.status === 'notforme' ? 'Not for me (undo)' : 'Not for me'),
      appScore ? h('button.btn.ghost.small', { type: 'button', onclick: () => { setVerdict(f, { status: null }); rebuildProfile(); drawVerdict(); updatePendingBadge(); } }, 'Remove my score') : null);
    scorebox.replaceChildren(...[head, nums, step, acts].filter(Boolean));
  };
  drawVerdict();

  const people = (d.credits?.cast || []).slice(0, 16);
  const directors = type === 'movie' ? (d.credits?.crew || []).filter(c => c.job === 'Director') : (d.created_by || []);
  const facts = h('dl.facts',
    directors.length ? [h('dt', type === 'movie' ? 'Director' : 'Created by'), h('dd', directors.map((p, i) => [i ? ', ' : '', h('a', { href: `#/person/${p.id}?as=directing` }, p.name)]))] : null,
    writers.length ? [h('dt', 'Writing'), h('dd', dedupe(writers).slice(0, 3).map((p, i) => [i ? ', ' : '', h('a', { href: `#/person/${p.id}?as=writing` }, p.name)]))] : null,
    d.original_language ? [h('dt', 'Language'), h('dd', (d.spoken_languages || []).map(l => l.english_name).slice(0, 3).join(', ') || d.original_language)] : null,
    type === 'tv' && d.networks?.length ? [h('dt', 'Network'), h('dd', d.networks.map(n => n.name).join(', '))] : null);

  const kw = (d.keywords?.keywords || d.keywords?.results || []).slice(0, 14);

  const main = h('div.title-main',
    trailerBox(tmdb.pickVideos(d.videos), { backdrop: d.backdrop_path, title: f.title, year: f.year }),
    d.overview ? h('p.overview', d.overview) : null,
    people.length ? section('Cast', null, h('div.rail', people.map(p => personCard(p, p.character || p.roles?.[0]?.character)))) : null,
    kw.length ? section('Keywords', null, h('div.row', kw.map(k => h('a.chip.kw', { href: `#/discover?type=${type}&keyword=${k.id}&kwname=${encodeURIComponent(k.name)}` }, k.name)))) : null);
  const side = h('div.title-side', vbox, facts);

  const recWrap = h('div.section');
  const more = section('More like this', null, recWrap);
  if (!live()) return;
  view.replaceChildren(hero, scorebox, h('div.title-body', main, side), more);
  trailPush(f.title, type);

  // recommendations (TMDB recommendations + similar), checked against the rules
  const raw = dedupe([...(d.recommendations?.results || []), ...(d.similar?.results || [])], x => x.id).filter(x => x.id !== id).slice(0, 40);
  if (!raw.length) { recWrap.replaceChildren(h('p.empty', 'TMDB has no recommendations for this title yet. Try the director or a cast member.')); return; }
  recWrap.replaceChildren(loading(`Checking ${raw.length} titles against your rules`));
  const checked = await check(raw, type);
  if (!live()) return;
  checked.sort(byPromise);
  const list = new ResultList({ showHidden: settings().showHidden, empty: 'Every recommendation here breaks one of your rules. Jump through the cast or director instead.' });
  list.add(checked);
  recWrap.replaceChildren(list.el);
  more.querySelector('h2').append(h('span.count', `${list.visibleCount} of ${checked.length} pass`));
}

// ---------------- Person ----------------
async function personView(id, q, live) {
  const p = await tmdb.person(id);
  if (!live()) return;
  document.title = `${p.name} · Cinema`;
  const notSelf = (c) => !/\b(self|himself|herself|themselves|narrator \(voice\)|archive footage)\b/i.test(c.character || '') && !(c.genre_ids || []).includes(99);
  const movie = (x) => ({ ...x, media_type: 'movie' });
  const tv = (x) => ({ ...x, media_type: 'tv' });
  const talk = new Set([10767, 10763, 10764, 99]);
  const roles = {
    directing: dedupe((p.movie_credits?.crew || []).filter(c => c.job === 'Director').map(movie)),
    acting: dedupe((p.movie_credits?.cast || []).filter(notSelf).map(movie)),
    writing: dedupe((p.movie_credits?.crew || []).filter(c => c.department === 'Writing').map(movie)),
    series: dedupe([
      ...(p.tv_credits?.cast || []).filter(c => notSelf(c) && !(c.genre_ids || []).some(g => talk.has(g)) && (c.episode_count || 0) >= 2),
      ...(p.tv_credits?.crew || []).filter(c => ['Creator', 'Director', 'Writer', 'Showrunner'].includes(c.job) && !(c.genre_ids || []).some(g => talk.has(g))),
    ].map(tv)),
  };
  const labels = { directing: 'Directing', acting: 'Acting', writing: 'Writing', series: 'Series' };
  let tab = q.get('as');
  if (!tab || !roles[tab]?.length) tab = p.known_for_department === 'Directing' && roles.directing.length ? 'directing' : roles.acting.length ? 'acting' : Object.keys(roles).find(k => roles[k].length) || 'acting';
  let sort = 'promising', obscure = false, limit = 60;
  const cache = new Map();

  const mine = personRatings(id, p.name);
  const avg = mine.length ? mine.reduce((s, e) => s + e.rating, 0) / mine.length : 0;
  const n8 = mine.filter(e => e.rating >= 8).length;

  const yourLine = mine.length
    ? h('div.yourline', h('span', `You've rated ${mine.length} with them · avg ${avg.toFixed(1)} · ${n8} at 8+`),
      mine.slice(0, 8).map(e => h('a.chip', { href: seedHref(e) }, e.title, ' ', h('b', String(e.rating)))))
    : h('div.yourline.dim', 'None of your rated titles list them as director or lead.');

  const born = [p.birthday && `Born ${p.birthday}`, p.place_of_birth, p.deathday && `Died ${p.deathday}`].filter(Boolean).join(' · ');
  const bio = h('p.bio', p.biography || 'No biography on TMDB.');
  const head = h('section.p-head',
    h('div.face', p.profile_path ? h('img', { src: img(p.profile_path, 'h632'), alt: '' }) : null),
    h('div.section',
      h('div.mono.dim', p.known_for_department || ''),
      h('h1.h-display', p.name),
      born ? h('div.mono.dim', born) : null,
      bio,
      (p.biography || '').length > 320 ? h('button.linkbtn', { type: 'button', onclick: (e) => { bio.classList.toggle('open'); e.target.textContent = bio.classList.contains('open') ? 'Less' : 'Read more'; } }, 'Read more') : null,
      yourLine,
      p.external_ids?.imdb_id ? h('a.chip', { href: `https://www.imdb.com/name/${p.external_ids.imdb_id}/`, target: '_blank', rel: 'noopener' }, 'IMDb', icons.ext()) : null));

  const tabs = h('div.seg', { role: 'tablist' });
  const sortSel = h('select', { 'aria-label': 'Sort', onchange: (e) => { sort = e.target.value; draw(); } },
    [['promising', 'Promising'], ['best', 'Best rated'], ['popular', 'Most popular'], ['newest', 'Newest'], ['oldest', 'Oldest']].map(([v, l]) => h('option', { value: v }, l)));
  const obsc = h('label', h('input', { type: 'checkbox', onchange: (e) => { obscure = e.target.checked; draw(); } }), 'Include obscure');
  const listWrap = h('div.section');
  const moreBtn = h('button.btn', { type: 'button', hidden: true, onclick: () => { limit += 60; draw(); } }, 'Check more titles');
  const countEl = h('span.count');

  const drawTabs = () => tabs.replaceChildren(...Object.keys(roles).filter(k => roles[k].length).map(k =>
    h('button' + (k === tab ? '.on' : ''), { type: 'button', role: 'tab', 'aria-selected': String(k === tab), onclick: () => { tab = k; limit = 60; drawTabs(); draw(); } }, `${labels[k]} ${roles[k].length}`)));

  let drawToken = 0;
  const draw = async () => {
    const my = ++drawToken;
    const date = (x) => x.release_date || x.first_air_date || '';
    let items = roles[tab].filter(x => obscure || (x.vote_count || 0) >= 40);
    const sorters = {
      best: (a, b) => weighted({ vote: b.vote_average, votes: b.vote_count }) - weighted({ vote: a.vote_average, votes: a.vote_count }),
      popular: (a, b) => (b.popularity || 0) - (a.popularity || 0),
      newest: (a, b) => date(b).localeCompare(date(a)),
      oldest: (a, b) => (date(a) || '9999').localeCompare(date(b) || '9999'),
    };
    items.sort(sorters[sort === 'promising' ? 'best' : sort]);
    const total = items.length;
    items = items.slice(0, limit);
    listWrap.replaceChildren(loading(`Checking ${items.length} titles against your rules`));
    const todo = items.filter(x => !cache.has(x.media_type + x.id));
    const checked = await check(todo, 'movie', { personName: tab === 'directing' ? p.name : '' });
    checked.forEach((c, i) => cache.set(todo[i].media_type + todo[i].id, c));
    if (my !== drawToken || !live()) return;
    const list = new ResultList({ showHidden: settings().showHidden, empty: `Nothing in this ${labels[tab].toLowerCase()} list passes your rules.` });
    const ordered = items.map(x => cache.get(x.media_type + x.id)).filter(Boolean);
    if (sort === 'promising') ordered.sort(byPromise);
    list.add(ordered);
    listWrap.replaceChildren(list.el);
    countEl.textContent = `${list.visibleCount} pass · ${total} with ${obscure ? 'any' : '40+'} votes`;
    moreBtn.hidden = total <= limit;
  };

  if (!live()) return;
  view.replaceChildren(head, h('section.section',
    h('header', h('h2.sec', 'Filmography', countEl), h('div.controls', tabs, sortSel, obsc)),
    listWrap, moreBtn));
  trailPush(p.name, 'person');
  drawTabs();
  await draw();
}

// ---------------- Discover (country / genre / decade / keyword) ----------------
const SORTS = [['promising', 'Promising'], ['top', 'Top rated'], ['gems', 'Hidden gems'], ['popular', 'Popular'], ['newest', 'Newest']];
let countryCache = null;
async function allCountries() {
  if (!countryCache) countryCache = (await tmdb.countries()).map(c => [c.iso_3166_1, c.english_name]).sort((a, b) => a[1].localeCompare(b[1]));
  return countryCache;
}

async function discoverView(q, live) {
  const type = q.get('type') === 'tv' ? 'tv' : 'movie';
  const genre = q.get('genre') || '', country = q.get('country') || '', decade = q.get('decade') || '';
  const sort = q.get('sort') || 'promising', keyword = q.get('keyword') || '', kwname = q.get('kwname') || '';
  const state = { type, genre, country, decade, sort, keyword, kwname };
  const set = (patch) => go('/discover', { ...state, ...patch });

  const titleParts = [country && demonym(country), genre && genreName(+genre), decade && decade + 's', kwname && `“${kwname}”`].filter(Boolean);
  const heading = (titleParts.join(' ') || 'Everything') + (type === 'tv' ? ' series' : ' films');
  document.title = heading + ' · Cinema';

  const countries = await allCountries();
  if (!live()) return;
  const prof = getProfile();
  const mineC = [...prof.groups.values()].filter(g => g.key.startsWith('c:')).sort((a, b) => b.n - a.n).map(g => g.key.slice(2));
  const gList = type === 'tv' ? TV_GENRES : MOVIE_GENRES;

  const controls = h('div.controls',
    h('div.seg', [['movie', 'Films'], ['tv', 'Series']].map(([v, l]) => h('button' + (type === v ? '.on' : ''), { type: 'button', onclick: () => set({ type: v, genre: '' }) }, l))),
    h('select', { 'aria-label': 'Genre', onchange: (e) => set({ genre: e.target.value }) }, h('option', { value: '' }, 'Any genre'), gList.map(([id, n]) => h('option', { value: id, selected: String(id) === genre }, n))),
    h('select', { 'aria-label': 'Country', onchange: (e) => set({ country: e.target.value }) }, h('option', { value: '' }, 'Any country'),
      h('optgroup', { label: 'In your ratings' }, mineC.map(c => h('option', { value: c, selected: c === country }, countryName(c)))),
      h('optgroup', { label: 'All countries' }, countries.filter(([c]) => !mineC.includes(c)).map(([c, n]) => h('option', { value: c, selected: c === country }, n)))),
    h('select', { 'aria-label': 'Decade', onchange: (e) => set({ decade: e.target.value }) }, h('option', { value: '' }, 'Any decade'), DECADES.map(d => h('option', { value: d, selected: String(d) === decade }, d + 's'))),
    h('select', { 'aria-label': 'Sort', onchange: (e) => set({ sort: e.target.value }) }, SORTS.map(([v, l]) => h('option', { value: v, selected: v === sort }, l))),
    kwname ? h('span.chip.solid', `Keyword: ${kwname}`, h('button', { type: 'button', 'aria-label': 'Remove keyword', onclick: () => set({ keyword: '', kwname: '' }) }, icons.x())) : null);

  // your stats for this slice
  let statText = '';
  if (country) { const g = prof.groups.get('c:' + country); statText = g ? `You've rated ${g.n} ${demonym(country)} titles · ${g.n8} at 8+` : `No ${demonym(country)} titles in your ratings yet`; }

  const minVotes = settings().minVotes;
  const today = new Date().toISOString().slice(0, 10);
  const params = { with_genres: genre, with_origin_country: country, with_keywords: keyword };
  const df = type === 'movie' ? 'primary_release_date' : 'first_air_date';
  if (decade) { params[df + '.gte'] = `${decade}-01-01`; params[df + '.lte'] = `${+decade + 9}-12-31`; }
  const tvScale = type === 'tv' ? 0.4 : 1;
  if (sort === 'top') Object.assign(params, { sort_by: 'vote_average.desc', 'vote_count.gte': Math.round(minVotes * tvScale) });
  if (sort === 'gems') Object.assign(params, { sort_by: 'vote_average.desc', 'vote_count.gte': Math.round(80 * tvScale), 'vote_count.lte': Math.round(1500 * tvScale) });
  if (sort === 'popular') Object.assign(params, { sort_by: 'popularity.desc', 'vote_count.gte': 50 });
  if (sort === 'newest') Object.assign(params, { sort_by: df + '.desc', [df + '.lte']: today, 'vote_count.gte': 20 });
  // Promising: walk the taste list for this slice; with a country or keyword (unknown offline), or once the
  // taste list runs out, take TMDB's best-known titles in the slice and rank each page by the same key.
  const promising = sort === 'promising';
  if (promising) Object.assign(params, { sort_by: 'vote_count.desc', 'vote_count.gte': type === 'tv' ? 30 : 80 });
  const gNames = genre ? imdbGenres([+genre]) : null;
  const tasteState = { next: 0, done: !promising || !!country || !!keyword || type === 'tv' || !tasteData()?.total };
  const tasteFilter = (t) => (!gNames || t.genres.some(g => gNames.includes(g))) && (!decade || (t.year >= +decade && t.year <= +decade + 9));

  const list = new ResultList({ showHidden: settings().showHidden, empty: 'Nothing on these pages passes your rules. Load more, or loosen a filter.' });
  const status = h('div.status', { hidden: true });
  const moreBtn = h('button.btn', { type: 'button', hidden: true }, 'Load more');
  const countEl = h('span.count');
  const note = h('p.note');
  let page = 1, totalPages = 1, totalResults = 0;

  const loadMore = async () => {
    moreBtn.hidden = true; status.hidden = false; status.replaceChildren(h('span.spin'), promising ? 'Ranking by your taste and checking your rules' : 'Fetching and checking');
    if (!tasteState.done) {
      const got = await walkTaste(tasteState, { filter: tasteFilter, match: (f) => f.type === type, want: 16, maxExamine: 120 });
      if (!live()) return;
      list.add(got);
      status.hidden = true;
      moreBtn.hidden = false;
      countEl.textContent = `${list.visibleCount} pass · ranked by people with your taste`;
      if (tasteState.done) note.textContent = 'Your taste data has no more titles here; "Load more" continues with the best-known titles, still ranked by your taste where possible.';
      if (!list.items.length) list.emptyEl.textContent = 'None of the first matches pass your rules. Load more.';
      return;
    }
    let added = 0, tries = 0;
    while (tries < 3 && page <= totalPages) {
      const r = await tmdb.discover(type, { ...params, page });
      if (!live()) return;
      page++; tries++; totalPages = Math.min(r.total_pages || 1, 500); totalResults = r.total_results || 0;
      const before = list.visibleCount;
      const batch = await check(r.results || [], type);
      if (promising) batch.sort(byPromise);
      list.add(batch);
      if (!live()) return;
      added += list.visibleCount - before;
      if (added >= 12) break;
    }
    status.hidden = true;
    moreBtn.hidden = page > totalPages;
    countEl.textContent = `${list.visibleCount} pass · ${list.items.length} checked of ${fmtVotes(totalResults)}`;
    if (!list.items.length) list.emptyEl.textContent = 'TMDB has nothing for this combination. Loosen a filter.';
  };
  moreBtn.onclick = () => loadMore().catch(renderError);

  if (!live()) return;
  view.replaceChildren(h('section.section',
    h('h1.h-display', heading),
    statText ? h('div.mono.dim', statText) : null,
    controls),
  h('section.section', h('header', h('h2.sec', SORTS.find(s => s[0] === sort)[1], countEl)),
    promising ? h('p.note', country || keyword || type === 'tv'
      ? 'Best-known titles in this slice, each page ordered by how people with your taste rated them.'
      : 'Ordered by how people whose ratings resemble yours rated them, then checked against your rules.') : null,
    list.el, status, note, moreBtn));
  trailPush(heading, 'discover');
  await loadMore();
}

// ---------------- Search ----------------
async function searchView(q, live) {
  const s = (q.get('q') || '').trim();
  const mode = q.get('mode') || '';
  document.title = (s ? `“${s}”` : 'Search') + ' · Cinema';
  if (!s) { view.replaceChildren(h('p.empty', 'Type in the search bar above.')); focusSearch(mode); return; }
  const [r1, r2] = await Promise.all([tmdb.search(s, 1), tmdb.search(s, 2).catch(() => ({ results: [] }))]);
  if (!live()) return;
  const all = [...r1.results, ...(r2.results || [])];
  let people = all.filter(x => x.media_type === 'person');
  if (mode === 'director') people.sort((a, b) => (b.known_for_department === 'Directing') - (a.known_for_department === 'Directing'));
  if (mode === 'actor') people.sort((a, b) => (b.known_for_department === 'Acting') - (a.known_for_department === 'Acting'));
  const titles = all.filter(x => x.media_type === 'movie' || x.media_type === 'tv');

  const kids = [h('h1.h-display', `“${s}”`)];
  const peopleSec = people.length ? section('People', people.length, h('div.rail', people.slice(0, 20).map(p => personCard(p,
    [p.known_for_department, (p.known_for || []).map(k => k.title || k.name).slice(0, 2).join(', ')].filter(Boolean).join(' · '))))) : null;
  const list = new ResultList({ showHidden: true, empty: 'No films or series match.' });
  const titleSec = section('Films and series', titles.length, h('p.note', 'Search shows everything; titles your rules would hide are greyed with the reason.'), list.el);
  if (mode === 'film') kids.push(titleSec, peopleSec); else kids.push(peopleSec, titleSec);
  if (!people.length && !titles.length) kids.push(h('p.empty', 'Nothing found. Check the spelling, or try the original title.'));
  view.replaceChildren(...kids.filter(Boolean));
  trailPush(`“${s}”`, 'search');
  list.emptyEl.textContent = 'Checking…';
  list.add(await check(titles.slice(0, 30), 'movie'));
  if (!live()) return;
  list.emptyEl.textContent = 'No films or series match.';
  list.render();
}

// ---------------- Pickers: countries, genres, decades ----------------
function statFor(g) {
  if (!g) return h('span.p-s', 'not rated yet');
  return h('span.p-s', `${g.n} rated · `, h('b', `${Math.round(100 * g.n8 / g.n)}%`), ' at 8+');
}

async function countriesView(live) {
  document.title = 'Countries · Cinema';
  const countries = await allCountries();
  if (!live()) return;
  const prof = getProfile();
  const mine = [...prof.groups.values()].filter(g => g.key.startsWith('c:')).sort((a, b) => b.n - a.n);
  const mineSet = new Set(mine.map(g => g.key.slice(2)));
  const pick = (iso, name, g) => h('a.pick', { href: `#/discover?country=${iso}`, 'data-name': norm(name) }, h('span.p-n', name), statFor(g));
  const allList = h('div.picklist', countries.filter(([c]) => !mineSet.has(c)).map(([c, n]) => pick(c, n)));
  const filter = h('input.filter-input', { type: 'search', placeholder: 'Filter countries', 'aria-label': 'Filter countries', oninput: (e) => {
    const t = norm(e.target.value);
    view.querySelectorAll('.pick').forEach(a => { a.hidden = t && !a.dataset.name.includes(t); });
  } });
  view.replaceChildren(h('h1.h-display', 'Countries'), filter,
    section('In your ratings', mine.length, h('div.picklist', mine.map(g => pick(g.key.slice(2), countryName(g.key.slice(2)), g)))),
    section('Everywhere else', null, h('p.note', 'Iran, Spain and the Middle East stay listed, but your rules hide what they make.'), allList));
  trailPush('Countries', 'pick');
}

async function genresView(q, live) {
  document.title = 'Genres · Cinema';
  const type = q.get('type') === 'tv' ? 'tv' : 'movie';
  const prof = getProfile();
  const list = type === 'tv' ? TV_GENRES : MOVIE_GENRES;
  const stats = (id) => {
    const names = imdbGenres([id]);
    const items = prof.entries.filter(e => e.genres.some(g => names.includes(g)));
    if (!items.length) return null;
    return { n: items.length, n8: items.filter(e => e.rating >= 8).length };
  };
  view.replaceChildren(h('h1.h-display', 'Genres'),
    h('div.seg', [['movie', 'Films'], ['tv', 'Series']].map(([v, l]) => h('button' + (type === v ? '.on' : ''), { type: 'button', onclick: () => go('/genres', { type: v }) }, l))),
    h('div.picklist', list.map(([id, name]) => h('a.pick', { href: `#/discover?type=${type}&genre=${id}` }, h('span.p-n', name), statFor(stats(id))))));
  trailPush('Genres', 'pick');
}

async function decadesView(q, live) {
  document.title = 'Decades · Cinema';
  const prof = getProfile();
  const stats = (d) => { const it = prof.entries.filter(e => e.year >= d && e.year < d + 10); return it.length ? { n: it.length, n8: it.filter(e => e.rating >= 8).length } : null; };
  view.replaceChildren(h('h1.h-display', 'Decades'),
    h('div.picklist', DECADES.map(d => h('a.pick', { href: `#/discover?decade=${d}` }, h('span.p-n', d + 's'), statFor(stats(d))))));
  trailPush('Decades', 'pick');
}

async function seedsView(q, live) {
  document.title = 'Your favourites · Cinema';
  const min = +(q.get('min') || 9);
  const prof = getProfile();
  const list = prof.entries.filter(e => e.rating >= min).sort((a, b) => b.rating - a.rating || String(b.date).localeCompare(String(a.date)));
  view.replaceChildren(
    h('h1.h-display', 'Start from a favourite'),
    h('p.lede', 'Open any of these to see what TMDB connects it to, filtered by your rules.'),
    h('div.seg', [[10, '10s'], [9, '9 and up'], [8, '8 and up']].map(([v, l]) => h('button' + (min === v ? '.on' : ''), { type: 'button', onclick: () => go('/seeds', { min: v }) }, l))),
    section('Your ratings', list.length, h('div.grid', list.map(seedCard))));
  trailPush('Favourites', 'pick');
}

// ---------------- Saved list ----------------
async function savedView(q, live) {
  document.title = 'Your list · Cinema';
  const tab = q.get('tab') || 'watchlist';
  const all = Object.values(verdicts()).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const by = (s) => all.filter(x => x.status === s);
  const tabs = [['watchlist', 'To watch'], ['seen', 'Scored here'], ['notforme', 'Not for me']];
  const pendingFirst = (a, b) => (!!a.imdbDone - !!b.imdbDone) || String(b.at).localeCompare(String(a.at));
  const items = tab === 'seen' ? by('seen').sort(pendingFirst) : by(tab);
  const imdbHref = (x) => x.imdb ? `https://www.imdb.com/title/${x.imdb}/` : `https://www.imdb.com/find/?q=${encodeURIComponent(x.title + ' ' + (x.year || ''))}`;
  const row = (x) => {
    const pending = x.status === 'seen' && x.rating && !x.imdbDone;
    return h('div.saved-item' + (pending ? '.pending' : ''),
      h('a', { href: `#/${x.type}/${x.id}` }, posterBox(x.poster, x.title, 'w185')),
      h('div', h('a.t', { href: `#/${x.type}/${x.id}` }, x.title),
        h('div.m', [x.year, x.status === 'seen' && x.rating ? `you: ${x.rating}/10` : null, x.at?.slice(0, 10)].filter(Boolean).join(' · ')),
        x.status === 'seen' && x.rating ? h('div.m', pending ? h('span', { style: { color: 'var(--bulb)' } }, 'Not on IMDb yet') : 'On IMDb') : null),
      h('div.row',
        pending ? h('a.btn.small.imdb', { href: imdbHref(x), target: '_blank', rel: 'noopener', onclick: () => setVerdict(x, { imdbOpened: true }) }, `Rate ${x.rating}`) : null,
        pending ? h('button.btn.small', { type: 'button', onclick: () => { setVerdict(x, { imdbDone: true }); toast('Marked as on IMDb'); route(); } }, 'Done') : null,
        h('button.btn.small.ghost', { type: 'button', onclick: () => { setVerdict(x, { status: null }); rebuildProfile(); route(); } }, 'Remove')));
  };
  const pend = pendingImdb();

  const exportText = () => ['Cinema verdicts, exported ' + new Date().toISOString().slice(0, 10),
    ...all.map(x => `${(x.at || '').slice(0, 10)} | ${x.title} (${x.year || '?'})${x.imdb ? ' ' + x.imdb : ''} | ${x.status === 'seen' ? 'seen' + (x.rating ? ' ' + x.rating + '/10' + (x.imdbDone ? ', on IMDb' : ', not on IMDb yet') : '') : x.status === 'notforme' ? 'not for me' : 'to watch'}`)].join('\n');
  const copy = async () => {
    const text = exportText();
    try { await navigator.clipboard.writeText(text); toast('Copied. Paste it to Claude to update the recommender log.'); }
    catch { const ta = h('textarea', { style: { width: '100%', height: '160px' } }, text); view.append(ta); ta.select(); toast('Select-all is ready; copy it manually.'); }
  };
  const download = () => {
    const csv = ['date,title,year,imdb,tmdb_type,tmdb_id,status,rating', ...all.map(x => [(x.at || '').slice(0, 10), `"${(x.title || '').replace(/"/g, '""')}"`, x.year || '', x.imdb || '', x.type, x.id, x.status, x.rating || ''].join(','))].join('\n');
    const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'cinema-verdicts.csv' });
    document.body.append(a); a.click(); a.remove();
  };
  view.replaceChildren(
    h('h1.h-display', 'Your list'),
    h('div.controls', h('div.seg', tabs.map(([v, l]) => h('button' + (tab === v ? '.on' : ''), { type: 'button', onclick: () => go('/saved', { tab: v }) }, `${l} ${by(v).length}`))),
      all.length ? h('button.btn.small', { type: 'button', onclick: copy }, 'Copy for Claude') : null,
      all.length ? h('button.btn.small', { type: 'button', onclick: download }, 'Download CSV') : null),
    tab === 'seen' && pend.length ? h('p.note', `${pend.length} score${pend.length > 1 ? 's are' : ' is'} not on IMDb yet. "Rate" opens the film in IMDb (its app, if installed): tap Rate there, pick the same score, then tap Done here.`) : null,
    items.length ? h('div.saved-list', items.map(row)) : h('p.empty', tab === 'watchlist' ? 'Nothing saved yet. Tap "Want to watch" on any film.' : tab === 'seen' ? 'Tap a score on any film page to log it here.' : 'Titles you dismiss land here, so you can undo.'),
    h('p.note', 'Saved in this browser. "Copy for Claude" gives a log you can paste into a chat to keep the recommender skill in sync.'));
  trailPush('Your list', 'saved');
}

// ---------------- Settings ----------------
let syncProgress = null;
function startSync() {
  const prof = getProfile();
  if (!hasKey() || !prof || isSyncing() || !prof.unsyncedCount) return;
  syncProfile((done, total) => {
    syncProgress = { done, total };
    const note = document.getElementById('dataNote');
    if (note) note.textContent = done < total ? `Matching your ratings on TMDB: ${done}/${total}` : '';
    const bar = document.getElementById('syncBar');
    if (bar) bar.style.width = Math.round(100 * done / total) + '%';
  }).then(() => { syncProgress = null; toast('Your ratings are matched with TMDB'); })
    .catch(e => { syncProgress = null; if (e instanceof AuthError) toast('TMDB rejected the key'); });
}

async function settingsView(live) {
  document.title = 'Settings · Cinema';
  const prof = getProfile();
  const s = settings();
  const off = rulesOff();

  const keyBox = h('div.panel', h('h2', 'TMDB key'),
    h('p.note', hasKey() ? 'A key is saved in this browser.' : 'No key yet. Everything live needs one.'),
    keyForm(),
    hasKey() ? h('button.btn.small.ghost', { type: 'button', onclick: () => { store.del('tmdbKey'); route(); } }, 'Forget key') : null);

  const fileIn = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true, onchange: async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try { const d = await importRatings(await file.text()); toast(`Imported ${d.count} ratings`); startSync(); route(); }
    catch (err) { toast(err.message); }
  } });
  const dataBox = h('div.panel', h('h2', 'Your ratings'),
    h('p.note', `${prof.total} ratings · ${prof.source}${prof.imported ? ' (imported in this browser)' : ' (bundled with the site)'}.`),
    h('p.note', `${prof.syncedCount} matched on TMDB for accurate countries, cast and posters.`),
    h('div.progress', h('i', { id: 'syncBar', style: { width: (syncProgress ? Math.round(100 * syncProgress.done / syncProgress.total) : Math.round(100 * prof.syncedCount / Math.max(1, prof.total))) + '%' } })),
    h('div.row',
      h('button.btn.small', { type: 'button', onclick: () => fileIn.click() }, 'Import IMDb export (CSV)'),
      prof.imported ? h('button.btn.small.ghost', { type: 'button', onclick: async () => { await resetImport(); route(); } }, 'Back to bundled data') : null,
      hasKey() && prof.unsyncedCount ? h('button.btn.small', { type: 'button', onclick: () => { startSync(); toast('Matching started'); } }, `Match ${prof.unsyncedCount} on TMDB`) : null),
    h('p.note', 'Export from IMDb: Your Ratings → ⋯ → Export. Import replaces the bundled list on this device.'),
    fileIn);

  const viewBox = h('div.panel', h('h2', 'Lists'),
    h('label.rule', h('span.switch', h('input', { type: 'checkbox', checked: s.showHidden, onchange: (e) => setSettings({ showHidden: e.target.checked }) }), h('span')),
      h('div', h('div.rt', 'Show hidden titles by default'), h('div.rn', 'Greyed out with the reason. Otherwise one tap on "Show them" under each list.'))),
    h('label.controls', 'Minimum votes for "Top rated"', h('input', { type: 'number', min: 20, max: 5000, step: 10, value: s.minVotes, onchange: (e) => setSettings({ minVotes: Math.max(20, +e.target.value || 200) }) })),
    h('button.btn.small.ghost', { type: 'button', onclick: () => { store.keys('f:').forEach(k => store.del(k)); toast('Cache cleared'); } }, 'Clear cached title checks'));

  const rulesBox = h('div.panel', h('h2', 'Hard rules'),
    h('p.note', 'From your movie-recommender skill (rules as of 2026-10-24). Switch one off to stop it hiding titles.'),
    h('div.rules', HARD_RULES.map(r => h('label.rule',
      h('span.switch', h('input', { type: 'checkbox', checked: !off.has(r.id), onchange: (e) => setRuleOff(r.id, !e.target.checked) }), h('span')),
      h('div', h('div.rt', r.label), h('div.rn', r.note))))),
    h('p.note', 'Flags (never hide): psychological horror, possible animal harm, dystopia sermons, pre-2010 effects, post-2015 US/UK, weak lanes in your data, and "more from a director you already love".'));

  if (!live()) return;
  view.replaceChildren(h('h1.h-display', 'Settings'), h('div.settings-grid', keyBox, dataBox, rulesBox, viewBox));
  trailPush('Settings', 'settings');
}

// ---------------- Header search with live suggestions ----------------
const input = document.getElementById('q');
const sug = document.getElementById('suggest');
const form = document.getElementById('searchForm');
let sugSel = -1;

function focusSearch(mode) {
  input.dataset.mode = mode || '';
  input.placeholder = { actor: 'Search an actor…', director: 'Search a director…', film: 'Search a film or series…' }[mode] || 'Film, series, actor, director…';
  input.value = '';
  input.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function closeSuggest() { sug.hidden = true; sug.replaceChildren(); sugSel = -1; }

const runSuggest = debounce(async () => {
  const s = input.value.trim();
  if (s.length < 2 || !hasKey()) { closeSuggest(); return; }
  try {
    const r = await tmdb.search(s);
    if (input.value.trim() !== s) return;
    const mode = input.dataset.mode;
    let res = r.results.filter(x => ['movie', 'tv', 'person'].includes(x.media_type));
    if (mode === 'actor' || mode === 'director') res = res.filter(x => x.media_type === 'person');
    if (mode === 'film') res = res.filter(x => x.media_type !== 'person');
    if (mode === 'director') res.sort((a, b) => (b.known_for_department === 'Directing') - (a.known_for_department === 'Directing'));
    const qs = new URLSearchParams({ q: s, ...(mode ? { mode } : {}) });
    sug.replaceChildren(...res.slice(0, 8).map(x => {
      const isP = x.media_type === 'person';
      const pic = isP ? x.profile_path : x.poster_path;
      const meta = isP ? [x.known_for_department, (x.known_for || []).map(k => k.title || k.name).slice(0, 2).join(', ')].filter(Boolean).join(' · ')
        : [x.media_type === 'tv' ? 'Series' : 'Film', (x.release_date || x.first_air_date || '').slice(0, 4), x.vote_average ? '★ ' + x.vote_average.toFixed(1) : ''].filter(Boolean).join(' · ');
      return h('a', { href: isP ? `#/person/${x.id}` : `#/${x.media_type}/${x.id}` },
        h('span.thumb' + (isP ? '.round' : ''), { style: pic ? { backgroundImage: `url(${img(pic, 'w92')})` } : {} }),
        h('span', h('div.s-t', x.title || x.name), h('div.s-m', meta)));
    }), h('a.all', { href: '#/search?' + qs }, `All results for “${s}”`));
    sug.hidden = false; sugSel = -1;
  } catch { closeSuggest(); }
}, 220);

input.addEventListener('input', runSuggest);
input.addEventListener('keydown', (e) => {
  const links = [...sug.querySelectorAll('a')];
  if (e.key === 'Escape') { closeSuggest(); input.blur(); return; }
  if (!links.length || sug.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    sugSel = (sugSel + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
    links.forEach((a, i) => a.classList.toggle('sel', i === sugSel));
  } else if (e.key === 'Enter' && sugSel >= 0) { e.preventDefault(); location.hash = links[sugSel].getAttribute('href'); input.value = ''; input.blur(); }
});
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const s = input.value.trim(); if (!s) return;
  go('/search', { q: s, mode: input.dataset.mode || '' });
  input.blur();
});
sug.addEventListener('click', (e) => { if (e.target.closest('a')) { input.value = ''; input.dataset.mode = ''; input.placeholder = 'Film, series, actor, director…'; closeSuggest(); input.blur(); } });
document.addEventListener('click', (e) => { if (!form.contains(e.target)) closeSuggest(); });
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement?.tagName || '')) { e.preventDefault(); focusSearch(''); }
});

// ---------------- boot ----------------
window.addEventListener('hashchange', route);
(async () => {
  view.replaceChildren(loading('Loading your ratings'));
  await Promise.all([loadProfile(), loadTaste()]);
  onProfile(() => {
    const { path } = parseHash();
    if (['/', '/seeds', '/settings'].includes(path) && !isSyncing()) route();
  });
  route();
  startSync();
})();
