// Build data/access.json for the sign-in gate. Emails are stored only as salted SHA-256 hashes; the TMDB token is
// stored once per account, AES-GCM-encrypted with a key derived from that account's email (PBKDF2, 150k rounds).
// Usage: node tools/access.mjs --client-id <id>.apps.googleusercontent.com --tmdb <token> \
//          --user admin:someone@gmail.com --user viewer:other@gmail.com
import { webcrypto as crypto } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const users = args.flatMap((a, i) => (a === '--user' ? [args[i + 1]] : []));
const clientId = get('--client-id'), tmdb = get('--tmdb'), salt = get('--salt') || 'cinema-v1';
if (!clientId || !tmdb || !users.length) { console.error('need --client-id, --tmdb and at least one --user role:email'); process.exit(1); }

const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const b64 = (b) => Buffer.from(b).toString('base64');

async function box(email) {
  const base = await crypto.subtle.importKey('raw', enc.encode(email), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: enc.encode(salt + ':tmdb'), iterations: 150000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return { iv: b64(iv), ct: b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(tmdb))) };
}

const out = { googleClientId: clientId, salt, users: [] };
for (const u of users) {
  const [role, raw] = u.split(':');
  const email = raw.trim().toLowerCase();
  if (!['admin', 'viewer'].includes(role) || !email.includes('@')) { console.error('bad --user ' + u); process.exit(1); }
  out.users.push({ id: hex(await crypto.subtle.digest('SHA-256', enc.encode(`${salt}:${email}`))), role, key: await box(email) });
}
const path = fileURLToPath(new URL('../data/access.json', import.meta.url));
writeFileSync(path, JSON.stringify(out, null, 1) + '\n');
console.log('wrote', path, out.users.map(u => u.role).join(', '));
