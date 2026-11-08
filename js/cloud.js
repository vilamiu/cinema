// Shared data in Firebase (Firestore), used when data/firebase.json exists.
// - verdicts/{type:id}: the one shared list (to watch, scores, not for me). The admin writes anything; the viewer
//   may only add or remove "watchlist" entries. Firestore security rules enforce this server-side.
// - shared/config: the TMDB token, so a signed-in viewer never has to paste one.
// Sign-in reuses the Google ID token from the gate (signInWithCredential), so there is a single Google prompt.
import { store, verdicts, replaceVerdicts, onVerdictWrite } from './store.js';

const V = '10.12.2';
const CDN = `https://www.gstatic.com/firebasejs/${V}/`;
let fb = null;            // { app, auth, db, A (auth module), F (firestore module) }
let role = 'admin';
let firstSnapshot = true;
const listeners = new Set();

export const cloudOn = () => !!fb;
export function onRemoteChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export async function initCloud() {
  let config = null;
  try { const r = await fetch('data/firebase.json', { cache: 'no-cache' }); if (r.ok) config = await r.json(); } catch { /* no cloud */ }
  if (!config?.projectId) return false;
  const [{ initializeApp }, A, F] = await Promise.all([
    import(CDN + 'firebase-app.js'), import(CDN + 'firebase-auth.js'), import(CDN + 'firebase-firestore.js')]);
  const app = initializeApp(config);
  fb = { app, auth: A.getAuth(app), db: F.getFirestore(app), A, F };
  await fb.auth.authStateReady();
  return true;
}

export function cloudSignedIn() { return !!fb?.auth.currentUser; }

export async function cloudSignIn(idToken) {
  const { A, auth } = fb;
  await A.signInWithCredential(auth, A.GoogleAuthProvider.credential(idToken));
}

export async function cloudSignOut() { try { await fb?.auth.signOut(); } catch { /* ignore */ } }

// Start syncing. Resolves after the first snapshot so the first page already shows the shared list.
export async function startCloud(userRole) {
  role = userRole;
  const { db, F } = fb;

  // TMDB token: viewers read it; the admin publishes the one on this device if the shared copy is missing.
  try {
    const snap = await F.getDoc(F.doc(db, 'shared', 'config'));
    const remoteKey = snap.exists() ? snap.data().tmdbKey : null;
    const localKey = store.get('tmdbKey');
    if (remoteKey && !localKey) store.set('tmdbKey', remoteKey);
    else if (role === 'admin' && localKey && remoteKey !== localKey) await F.setDoc(F.doc(db, 'shared', 'config'), { tmdbKey: localKey }, { merge: true });
  } catch (e) { console.warn('shared config', e); }

  onVerdictWrite((key, value) => {
    const ref = F.doc(db, 'verdicts', key);
    (value ? F.setDoc(ref, clean(value)) : F.deleteDoc(ref)).catch(e => console.warn('save failed', key, e));
  });

  await new Promise((resolve) => {
    F.onSnapshot(F.collection(db, 'verdicts'), (qs) => {
      const remote = {};
      qs.forEach(d => { remote[d.id] = d.data(); });
      if (firstSnapshot) {
        firstSnapshot = false;
        // Upload anything saved on this device before sharing was on (only what this role may write).
        const local = verdicts();
        for (const [k, v] of Object.entries(local)) {
          if (remote[k]) continue;
          if (role !== 'admin' && v.status !== 'watchlist') continue;
          remote[k] = v;
          F.setDoc(F.doc(db, 'verdicts', k), clean(v)).catch(e => console.warn('upload failed', k, e));
        }
        replaceVerdicts(remote);
        resolve();
        return;
      }
      replaceVerdicts(remote);
      listeners.forEach(fn => fn());
    }, (e) => { console.warn('sync stopped', e); resolve(); });
  });
}

export async function publishKey(key) {
  if (!fb || role !== 'admin') return;
  try { await fb.F.setDoc(fb.F.doc(fb.db, 'shared', 'config'), { tmdbKey: key }, { merge: true }); } catch (e) { console.warn('key publish', e); }
}

const clean = (v) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined));
