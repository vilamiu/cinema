// localStorage wrapper. Every read and write is guarded: private windows and full storage must not break the app.
const NS = 'ra:';

export const store = {
  get(k, d = null) {
    try { const v = localStorage.getItem(NS + k); return v == null ? d : JSON.parse(v); } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem(NS + k, JSON.stringify(v)); return true; } catch { return false; }
  },
  del(k) { try { localStorage.removeItem(NS + k); } catch { /* ignore */ } },
  keys(prefix = '') {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(NS + prefix)) out.push(k.slice(NS.length));
      }
    } catch { /* ignore */ }
    return out;
  },
};

// ---- Verdicts: watchlist / seen / not for me, keyed "movie:123" ----
export function verdicts() { return store.get('verdicts', {}); }
export function setVerdict(f, patch) {
  const all = verdicts();
  const key = f.type + ':' + f.id;
  const prev = all[key] || {};
  const next = { ...prev, ...patch, title: f.title, year: f.year, imdb: f.imdb || prev.imdb || null, poster: f.poster || prev.poster || null, type: f.type, id: f.id, at: new Date().toISOString() };
  if (next.status == null) delete all[key]; else all[key] = next;
  store.set('verdicts', all);
  return all;
}

// ---- Settings ----
export function settings() { return { showHidden: false, minVotes: 200, includeTv: true, ...store.get('settings', {}) }; }
export function setSettings(patch) { const s = { ...settings(), ...patch }; store.set('settings', s); return s; }
export function rulesOff() { return new Set(store.get('rulesOff', [])); }
export function setRuleOff(id, off) { const s = rulesOff(); off ? s.add(id) : s.delete(id); store.set('rulesOff', [...s]); }
