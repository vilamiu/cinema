// Sign-in gate. Google Identity Services returns a signed ID token; the app reads the email from it and checks a
// SHA-256 of it against data/access.json. Roles: "admin" (everything) and "viewer" (browse only).
// This keeps other people out of the app, but it runs in the browser: on GitHub Pages the code and data files
// stay publicly readable. The TMDB token is stored encrypted per allowed account (AES-GCM, key derived from
// the email with PBKDF2), so it can only be unlocked by signing in as one of them.
import { store } from './store.js';
import { h } from './util.js';
import { initCloud, cloudSignedIn, cloudSignIn, cloudSignOut, startCloud } from './cloud.js';

const SESSION_DAYS = 60;
let session = null;

export const role = () => session?.role || 'admin';
export const isAdmin = () => role() === 'admin';
export const currentUser = () => session;

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export async function emailId(email, salt) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(`${salt}:${email.trim().toLowerCase()}`))); }

async function unlockKey(email, salt, box) {
  const base = await crypto.subtle.importKey('raw', enc.encode(email.trim().toLowerCase()), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: enc.encode(salt + ':tmdb'), iterations: 150000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct));
  return new TextDecoder().decode(pt);
}

function decodeJwt(token) {
  const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const json = decodeURIComponent(atob(part.padEnd(part.length + (4 - part.length % 4) % 4, '=')).split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
  return JSON.parse(json);
}

function loadGis() {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = res; s.onerror = () => rej(new Error('Could not load Google sign-in. Check your connection and reload.'));
    document.head.append(s);
  });
}

function applyRole() {
  document.body.classList.toggle('viewer', role() === 'viewer');
  const out = document.getElementById('signOut');
  if (out) out.hidden = !session;
}

export async function signOut() {
  store.del('session');
  await cloudSignOut();
  try { window.google?.accounts?.id?.disableAutoSelect(); } catch { /* ignore */ }
  location.replace(location.pathname);
}

// Resolves once someone allowed is signed in (or immediately when the gate is not configured).
export async function ensureSignedIn() {
  let access;
  try { access = await (await fetch('data/access.json', { cache: 'no-cache' })).json(); } catch { access = null; }
  if (!access?.googleClientId || !access.users?.length) { session = null; applyRole(); return; }
  let cloud = false;
  try { cloud = await initCloud(); } catch (e) { console.warn('shared list unavailable', e); }

  const saved = store.get('session');
  if (saved && saved.exp > Date.now() && access.users.some(u => u.id === saved.id && u.role === saved.role) && (!cloud || cloudSignedIn())) {
    session = saved; applyRole();
    if (cloud) await startCloud(session.role).catch(e => console.warn('sync', e));
    return;
  }
  store.del('session');

  document.body.classList.add('locked');
  const msg = h('p.gate-msg');
  const btn = h('div.gate-btn');
  const gate = h('main.gate', { id: 'gate' },
    h('div.gate-card',
      h('div.mark.gate-mark', h('span.bulbs', { 'aria-hidden': 'true' }, [1, 2, 3, 4, 5, 6].map(() => h('i'))), h('span', 'Cine', h('span.word2', 'ma'))),
      h('p.gate-lede', 'Private. Sign in with an invited Google account.'),
      btn, msg));
  document.body.append(gate);

  await new Promise((resolve) => {
    const onCredential = async ({ credential }) => {
      msg.textContent = 'Checking…'; msg.classList.remove('err');
      try {
        const claims = decodeJwt(credential);
        if (claims.aud !== access.googleClientId || !claims.email_verified || claims.exp * 1000 < Date.now()) throw new Error('bad');
        const id = await emailId(claims.email, access.salt);
        const user = access.users.find(u => u.id === id);
        if (!user) { msg.textContent = `${claims.email} doesn't have access.`; msg.classList.add('err'); try { google.accounts.id.disableAutoSelect(); } catch { /* ignore */ } return; }
        if (user.key && (!store.get('tmdbKey') || user.role !== 'admin')) {
          try { store.set('tmdbKey', await unlockKey(claims.email, access.salt, user.key)); } catch { /* admin can still paste one */ }
        }
        if (cloud) {
          msg.textContent = 'Opening the shared list…';
          try { await cloudSignIn(credential); await startCloud(user.role); }
          catch (e) { console.warn('shared list sign-in failed', e); msg.textContent = 'Signed in, but the shared list refused the connection (' + (e.code || e.message) + ').'; msg.classList.add('err'); return; }
        }
        session = { id, role: user.role, name: claims.given_name || claims.name || '', exp: Date.now() + SESSION_DAYS * 864e5 };
        store.set('session', session);
        gate.remove(); document.body.classList.remove('locked'); applyRole();
        resolve();
      } catch {
        msg.textContent = 'Sign-in failed. Try again.'; msg.classList.add('err');
      }
    };
    loadGis().then(() => {
      google.accounts.id.initialize({ client_id: access.googleClientId, callback: onCredential, auto_select: true, cancel_on_tap_outside: false, ux_mode: 'popup' });
      google.accounts.id.renderButton(btn, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', width: 260 });
      google.accounts.id.prompt();
    }).catch(e => { msg.textContent = e.message; msg.classList.add('err'); });
  });
}
