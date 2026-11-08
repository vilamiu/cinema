// Reusable UI pieces: poster cards, result lists with the hidden-by-rules toggle, people, trailer player.
import { h } from './util.js';
import { img } from './tmdb.js';
import { summarizeHidden } from './rules.js';
import { tasteOf, tier } from './taste.js';

export const icons = {
  play: () => svg('<path d="M7 4.5v15l13-7.5z" fill="currentColor"/>'),
  plus: () => svg('<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
  check: () => svg('<path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
  x: () => svg('<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
  ext: () => svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
};
function svg(inner) { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = inner; return s; }

export function posterBox(path, title, size = 'w342') {
  const box = h('div.poster');
  if (path) box.append(h('img', { src: img(path, size), alt: '', loading: 'lazy', decoding: 'async' }));
  else box.append(h('div.noimg', title || ''));
  return box;
}

export function titleHref(f) { return `#/${f.type}/${f.id}`; }

export function card({ f, ev }) {
  const p = posterBox(f.poster, f.title);
  const mine = ev?.rated?.rating ?? (ev?.verdict?.status === 'seen' ? ev.verdict.rating : null);
  if (mine) p.append(h('span.badge', 'You ' + mine));
  if (ev?.verdict?.status === 'watchlist') p.append(h('span.badge.list', 'On list'));
  const hidden = ev?.hide?.length;
  if (hidden) p.append(h('div.why', ev.hide[0].text));
  const meta = [f.type === 'tv' ? 'Series' : null, f.year, (f.countries || []).slice(0, 2).join('/'), f.vote ? '★ ' + f.vote.toFixed(1) : null].filter(Boolean);
  const nf = ev?.flags?.length || 0;
  const tr = tier(tasteOf(f.imdb));
  const match = tr && (tr.id === 'top' || tr.id === 'good') ? h('span.match', tr.id === 'top' ? 'Top match' : 'Good match') : null;
  return h('a.card' + (hidden ? '.is-hidden' : ''), { href: titleHref(f), title: f.title + (f.year ? ` (${f.year})` : '') },
    p, h('div.t', f.title),
    h('div.m', meta.map(x => h('span', String(x))), match, nf ? h('span.fl', nf === 1 ? '1 flag' : nf + ' flags') : null));
}

// A grid of checked titles with a "N hidden by your rules · Show" bar. Supports appending pages.
export class ResultList {
  constructor({ empty = 'Nothing here passes your rules.', showHidden = false, hiddenFirstLine = '' } = {}) {
    this.items = []; this.keys = new Set(); this.show = showHidden; this.hiddenFirstLine = hiddenFirstLine;
    this.grid = h('div.grid');
    this.emptyEl = h('p.empty', empty);
    this.bar = h('div.hiddenbar');
    this.el = h('div.section', this.grid, this.emptyEl, this.bar);
    this.render();
  }
  add(items) {
    for (const it of items) {
      const k = it.f.type + ':' + it.f.id;
      if (this.keys.has(k)) continue;
      this.keys.add(k); this.items.push(it);
    }
    this.render();
  }
  reset(items = []) { this.items = []; this.keys.clear(); this.add(items); }
  get visibleCount() { return this.items.filter(x => !x.ev.hide.length).length; }
  render() {
    const vis = this.items.filter(x => !x.ev.hide.length);
    const hid = this.items.filter(x => x.ev.hide.length);
    const list = this.show ? [...vis, ...hid] : vis;
    this.grid.replaceChildren(...list.map(card));
    this.emptyEl.hidden = !!list.length || !this.items.length;
    this.grid.hidden = !list.length;
    this.bar.replaceChildren();
    this.bar.hidden = !hid.length;
    if (hid.length) {
      this.bar.append(
        h('span', h('b', `${hid.length} hidden by your rules`), ' · ', summarizeHidden(hid.map(x => x.ev))),
        h('button.btn.small', { type: 'button', onclick: () => { this.show = !this.show; this.render(); } }, this.show ? 'Hide them' : 'Show them'),
      );
    }
  }
}

export function personCard(p, sub, as) {
  const initials = (p.name || '?').split(/\s+/).map(s => s[0]).slice(0, 2).join('');
  return h('a.person', { href: `#/person/${p.id}${as ? '?as=' + as : ''}`, title: p.name },
    h('div.face', p.profile_path ? h('img', { src: img(p.profile_path, 'w185'), alt: '', loading: 'lazy', decoding: 'async' }) : h('div.noimg', initials)),
    h('div.n', p.name), sub ? h('div.r', sub) : null);
}

export function loading(text = 'Loading') { return h('div.status', h('span.spin'), text); }

// Trailer: cover image with a play button; the YouTube embed loads only on tap.
export function trailerBox(videos, { backdrop, title, year }) {
  if (!videos.length) {
    return h('div.trailer.notrailer',
      h('strong', 'No trailer listed on TMDB'),
      h('a.btn.small', { href: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} ${year || ''} official trailer`)}`, target: '_blank', rel: 'noopener' }, 'Search YouTube', icons.ext()));
  }
  let cur = videos[0];
  const box = h('div.trailer');
  const label = (v) => `${v.type}${v.size ? ' · ' + v.size + 'p' : ''}${v.iso_639_1 && v.iso_639_1 !== 'en' ? ' · ' + v.iso_639_1.toUpperCase() : ''}`;
  const play = () => {
    box.replaceChildren(h('iframe', {
      src: `https://www.youtube-nocookie.com/embed/${cur.key}?autoplay=1&rel=0&playsinline=1&modestbranding=1`,
      title: cur.name, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
      referrerpolicy: 'strict-origin-when-cross-origin',
    }));
    pick.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.key === cur.key));
  };
  const cover = () => {
    const src = backdrop ? img(backdrop, 'w1280') : `https://i.ytimg.com/vi/${cur.key}/hqdefault.jpg`;
    box.replaceChildren(h('button.cover', { type: 'button', onclick: play, 'aria-label': 'Play ' + cur.name },
      h('img', { src, alt: '' }), h('span.play', icons.play(), 'Play trailer'), h('span.vlabel', label(cur))));
  };
  const pick = h('div.vids', videos.length > 1 ? videos.map(v => h('button.btn.small' + (v === cur ? '.on' : ''), {
    type: 'button', 'data-key': v.key, title: v.name, onclick: () => { cur = v; play(); },
  }, label(v))) : null);
  cover();
  return h('div.section', box, videos.length > 1 ? pick : null);
}
