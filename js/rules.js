// Cinema rule engine.
// The hard rules and lists come from the movie-recommender skill (rules as of 2026-10-24).
// A "hide" rule removes a title from every list (a toggle can reveal it, with the reason).
// A "flag" only adds a warning badge.

import { norm } from './util.js';

// ---------- Do-not-suggest list (skill, 2026-10-24) ----------
// [title, year, aliases?, tag?]  tag 'animal' = on the animal-suffering never list
const DNS_RAW = [
  ['The Human Condition I: No Greater Love', 1959], ['Samurai Rebellion', 1967], ['The Bad Sleep Well', 1960],
  ['Throne of Blood', 1957], ['Late Spring', 1949], ['Sansho the Bailiff', 1954], ['Cries and Whispers', 1972],
  ['For a Few Dollars More', 1965], ['The Killing', 1956], ['The Bow', 2005], ['Madadayo', 1993],
  ['Autumn Sonata', 1978], ['Shame', 1968], ['The Virgin Spring', 1960], ['Scenes from a Marriage', 1973],
  ['Ugetsu', 1953, ['Ugetsu Monogatari']], ['Fires on the Plain', 1959], ['The Face of Another', 1966],
  ['After Life', 1998], ["Angel's Egg", 1985], ['Pluto', 2023], ['Vinland Saga', 2019], ['Together', 2000],
  ['Ordet', 1955], ['The Man Without a Past', 2002], ['Rocco and His Brothers', 1960], ['Amarcord', 1973],
  ['The Conformist', 1970], ['The Cranes Are Flying', 1957], ['Ballad of a Soldier', 1959], ['The Ascent', 1977],
  ['Dekalog', 1989, ['The Decalogue']], ['4 Months, 3 Weeks and 2 Days', 2007], ['Letters from Iwo Jima', 2006],
  ['Threads', 1984], ['The Duellists', 1977], ['A Fistful of Dollars', 1964], ['La Jetée', 1962],
  ['World on a Wire', 1973], ['Pi', 1998, ['π']], ['The General', 1926], ['Sherlock Jr.', 1924],
  ['The Passion of Joan of Arc', 1928], ['Die Nibelungen: Siegfried', 1924], ['Ace in the Hole', 1951],
  ['The Last Temptation of Christ', 1988], ['Pieta', 2012, ['Pietà']], ['Excalibur', 1981], ['Chernobyl', 2019],
  ['Twin Peaks', 1990], ['Roma', 2018], ['The Great Beauty', 2013], ['Wild Tales', 2014],
  ['The Secret in Their Eyes', 2009], ['Peeping Tom', 1960], ['Mad Max', 1979], ['Battlestar Galactica', 2004],
  ['Godland', 2022, ['Vanskabte Land'], 'animal'], ['Of Horses and Men', 2013, [], 'animal'],
  ['The Wild Bunch', 1969, [], 'animal'], ['Mr. Robot', 2015], ['Mushishi', 2005, ['Mushi-Shi']],
  ['Jin-Roh: The Wolf Brigade', 1999, ['Jin-Roh']], ['The Fountain', 2006], ['Hana-bi', 1997, ['Fireworks']],
  ['Mishima: A Life in Four Chapters', 1985], ['Le Samouraï', 1967], ['Ghost in the Shell 2: Innocence', 2004, ['Innocence']],
  ['The Vanishing', 1988, ['Spoorloos']], ['The Turin Horse', 2011, [], 'animal'], ['Andrei Rublev', 1966, ['Andrei Rublyov'], 'animal'],
  ['Au Hasard Balthazar', 1966, [], 'animal'], ['Walkabout', 1971, [], 'animal'], ['Sátántangó', 1994, ['Satantango'], 'animal'],
  ['Red Cliff', 2008, [], 'animal'], ['Master and Commander: The Far Side of the World', 2003],
  ['I Saw the Devil', 2010], ['Gattaca', 1997], ['Incendies', 2010], ['The Invisible Guest', 2016, ['Contratiempo']],
];
const DNS = DNS_RAW.map(([t, y, al = [], tag]) => ({ names: [t, ...al].map(norm), year: y, title: t, tag }));
export const DNS_COUNT = DNS.length;

function dnsMatch(f) {
  const names = [norm(f.title || ''), norm(f.orig || '')];
  return DNS.find(d => d.names.some(n => names.includes(n)) && (!f.year || !d.year || Math.abs(f.year - d.year) <= 1));
}

// ---------- Monkey list: directors he already rates highly (skill + recomputed from data) ----------
export const MONKEY_FIXED = ['Peter Jackson', 'Hayao Miyazaki', 'Spike Jonze', 'Kim Ki-duk', 'Lukas Moodysson',
  'Darren Aronofsky', 'David O. Russell', 'Fritz Lang', 'David Lean', 'Wolfgang Petersen', 'George Lucas',
  'Sergio Leone', 'Ingmar Bergman', 'Isao Takahata', 'Stanley Kubrick', 'Akira Kurosawa', 'Goro Miyazaki',
  'Joseph L. Mankiewicz', 'Joel Coen', 'Ethan Coen', 'Hirokazu Koreeda', 'George Cukor', 'Brian De Palma',
  'Takeshi Kitano', 'Milos Forman'];

// ---------- Region and keyword vocabularies ----------
const MIDEAST = new Set(['IR', 'IQ', 'SY', 'LB', 'JO', 'IL', 'PS', 'SA', 'YE', 'OM', 'AE', 'QA', 'BH', 'KW', 'EG', 'LY', 'TN', 'DZ', 'MA', 'SD', 'TR']);
const MIDEAST_KW = /\b(middle east|middle eastern|arab|arabian|arabs|lebanon|lebanese|beirut|syria|syrian|damascus|aleppo|iraq|iraqi|baghdad|gulf war|persian gulf|iran|iranian|tehran|egypt|egyptian|cairo|alexandria, egypt|israel|israeli|palestine|palestinian|gaza|jerusalem|west bank|saudi arabia|yemen|kuwait|dubai|qatar|oman|libya|libyan|tunisia|algeria|algerian|algiers|morocco|moroccan|marrakech|tangier|casablanca, morocco|sudan|north africa|bedouin)\b/;
const JORDAN_KW = /(^jordan$|, jordan$)/;
const SUPERHERO_KW = /\b(superhero|super hero|superheroes|marvel cinematic universe|dc extended universe|dc universe|dcu|mcu|marvel comics|dc comics|superhero team)\b/;
const SUPERHERO_CO = new Set([420, 7505, 19551, 429, 9993, 128064, 184898]);
const GORE_KW = /\b(slasher|splatter|gore|gory|torture|torture porn|body horror|cannibal|cannibalism|zombie|zombies|found footage|mutilation|dismemberment|snuff|grindhouse|maniac|massacre|chainsaw|serial killer|killing spree|exploitation)\b/;
const PSYCH_KW = /\b(psychological horror|psychological thriller|psychological|paranoia|madness|folk horror|surreal|surrealism|hallucination|dread|existential)\b/;
const SERIAL_KW = /\bserial killer\b/;
const ANIMAL_KW = /\b(animal cruelty|animal abuse|animal killing|killing an animal|dead animal|animal death|animal sacrifice|slaughterhouse|slaughter|hunting|hunter|bullfight|bullfighting|dogfight|dog fighting|cockfight|whaling|butcher|skinning)\b/;
const DYSTOPIA_KW = /\bdystopia|dystopian\b/;
const OPPRESSION_KW = /\b(totalitarian|totalitarianism|police state|resistance|rebellion|oppression|authoritarian|surveillance state|revolution)\b/;
const EPIC_KW = /\b(epic|swashbuckler|sword and sandal|historical epic)\b/;

const GEN = { action: 28, adventure: 12, animation: 16, comedy: 35, crime: 80, documentary: 99, drama: 18, family: 10751, fantasy: 14, history: 36, horror: 27, music: 10402, mystery: 9648, romance: 10749, scifi: 878, thriller: 53, war: 10752, western: 37, actionAdv: 10759, scifiFantasy: 10765, warPolitics: 10768 };

// ---------- Hard rules (toggleable in Settings) ----------
export const HARD_RULES = [
  { id: 'rated', label: 'Already rated by you', note: 'Everything in your IMDb export or marked seen here.' },
  { id: 'verdict', label: 'Marked "not for me"', note: 'Titles you dismissed in this app.' },
  { id: 'dns', label: 'Do-not-suggest list', note: 'Titles withdrawn or flagged, including the animal-suffering never list.' },
  { id: 'iran', label: 'Iranian films', note: 'Iran in production countries, or Persian-language.' },
  { id: 'spain', label: 'Spanish films', note: 'Spain anywhere in the production countries (2026-10-24).' },
  { id: 'mideast', label: 'Middle East and North Africa', note: 'Produced there, or keywords place it there. Setting counts, not just production.' },
  { id: 'superhero', label: 'Superhero, Marvel or DC', note: 'Superhero keywords or Marvel/DC studios.' },
  { id: 'uscomedy', label: 'USA comedy', note: 'US-led production whose main genre is Comedy.' },
  { id: 'horror', label: 'Horror and gore', note: 'Gore, slasher or serial-killer horror always out; plain horror out unless it reads as psychological (then flagged).' },
  { id: 'depp', label: 'Johnny Depp', note: 'In the top-billed cast.' },
  { id: 'crowe', label: 'Russell Crowe leads', note: 'Inference from "a mid actor": hidden when he is one of the two leads.' },
  { id: 'cancelled', label: 'Series cancelled after one season', note: 'Status "Canceled" with a single season.' },
  { id: 'veto', label: 'Your own-data veto', note: '3+ rated in a group (country, director, lead actor, genre lane) and none reached 8, or a director/lead averaging under 6.' },
];

// ---------- Own-data profile groups ----------
// Built by profile.js: groups[key] = {label, n, n8, sum, avg, items}
export function vetoCheck(f, profile) {
  const out = { hard: [], soft: [], info: [] };
  if (!profile || !profile.groups) return out;
  const G = profile.groups;
  const look = (key) => G.get(key);
  const test = (g, kind) => {
    if (!g || g.n < 3) return;
    const line = `${g.label}: ${g.n} rated, ${g.n8 ? g.n8 + ' at 8+' : 'none at 8+'}, avg ${g.avg.toFixed(1)}`;
    if (g.n8 === 0) out.hard.push(line);
    else if (kind === 'person' && g.avg < 6) out.hard.push(line);
    else if (kind === 'lane' && g.n >= 5 && g.avg < 6 && g.n8 / g.n < 0.15) out.soft.push('Weak lane for you · ' + line);
  };
  const countries = f.countries || [];
  for (const c of countries) { const g = look('c:' + c); test(g, 'lane'); if (g) out.info.push(g); }
  for (const d of f.directors || []) { const g = look('d:' + norm(d.name)); test(g, 'person'); if (g) out.info.push(g); }
  for (const a of (f.cast || []).slice(0, 3)) { const g = look('a:' + norm(a.name)); test(g, 'person'); if (g) out.info.push(g); }
  const dec = f.year ? Math.floor(f.year / 10) * 10 : null;
  const gnames = imdbGenres(f.genres || []);
  for (const c of countries.slice(0, 2)) for (const gn of gnames) {
    test(look(`cg:${c}|${gn}`), 'lane');
    if (dec) test(look(`cdg:${c}|${dec}|${gn}`), 'lane');
  }
  out.hard = [...new Set(out.hard)];
  out.soft = [...new Set(out.soft)].slice(0, 2);
  return out;
}

// TMDB genre ids → IMDb genre names (his data uses IMDb names)
const TMDB_TO_IMDB = { 28: ['Action'], 12: ['Adventure'], 16: ['Animation'], 35: ['Comedy'], 80: ['Crime'], 99: ['Documentary'], 18: ['Drama'], 10751: ['Family'], 14: ['Fantasy'], 36: ['History'], 27: ['Horror'], 10402: ['Music'], 9648: ['Mystery'], 10749: ['Romance'], 878: ['Sci-Fi'], 53: ['Thriller'], 10752: ['War'], 37: ['Western'], 10759: ['Action', 'Adventure'], 10765: ['Sci-Fi', 'Fantasy'], 10768: ['War'], 10762: ['Family'] };
export function imdbGenres(ids) { return [...new Set(ids.flatMap(id => TMDB_TO_IMDB[id] || []))]; }

// ---------- Evaluate one title ----------
// f: facts (see tmdb.js factsFrom). ctx: {personName} when browsing a person's page.
export function evaluate(f, profile, verdicts, off = new Set(), ctx = {}) {
  const hide = [], flags = [];
  const on = (id) => !off.has(id);
  const kw = (f.keywords || []).join(' | ');
  const kwList = f.keywords || [];
  const has = (re) => kwList.some(k => re.test(k));
  const C = new Set(f.countries || []);
  const G = new Set(f.genres || []);
  const castIds = (f.cast || []).map(c => c.id);

  // rated / verdicts
  const rated = f.imdb && profile?.byImdb.get(f.imdb);
  const v = verdicts?.[f.type + ':' + f.id];
  if (rated && on('rated')) hide.push({ id: 'rated', text: `You rated it ${rated.rating}` });
  else if (v?.status === 'seen' && on('rated')) hide.push({ id: 'rated', text: v.rating ? `You rated it ${v.rating} here` : 'You marked it seen' });
  if (v?.status === 'notforme' && on('verdict')) hide.push({ id: 'verdict', text: 'You marked it not for me' });

  const dns = dnsMatch(f);
  if (dns && on('dns')) hide.push({ id: 'dns', text: dns.tag === 'animal' ? 'On your animal-suffering never list' : 'On your do-not-suggest list' });

  if (on('iran') && (C.has('IR') || f.lang === 'fa')) hide.push({ id: 'iran', text: 'Iranian film' });
  if (on('spain') && C.has('ES')) hide.push({ id: 'spain', text: 'Spain in the production credits' });

  if (on('mideast')) {
    const prod = [...C].filter(c => MIDEAST.has(c) && c !== 'IR');
    const kwHit = kwList.find(k => MIDEAST_KW.test(k) || JORDAN_KW.test(k));
    if (prod.length) hide.push({ id: 'mideast', text: 'Middle East / North Africa production (' + prod.join(', ') + ')' });
    else if (kwHit) hide.push({ id: 'mideast', text: `Set in or about the Middle East / North Africa ("${kwHit}")` });
  }

  if (on('superhero') && (has(SUPERHERO_KW) || (f.companies || []).some(c => SUPERHERO_CO.has(c)))) hide.push({ id: 'superhero', text: 'Superhero / Marvel / DC' });

  const usLed = C.has('US') && [...C].every(c => ['US', 'GB', 'CA'].includes(c));
  const firstGenre = (f.genres || [])[0];
  if (usLed && G.has(GEN.comedy)) {
    if (firstGenre === GEN.comedy && on('uscomedy')) hide.push({ id: 'uscomedy', text: 'USA comedy' });
    else flags.push('US production with comedy in the mix');
  }

  const isHorror = G.has(GEN.horror);
  const gore = has(GORE_KW);
  if (on('horror')) {
    if (isHorror && gore) hide.push({ id: 'horror', text: 'Gore-driven horror (' + kwList.find(k => GORE_KW.test(k)) + ')' });
    else if (isHorror && !has(PSYCH_KW)) hide.push({ id: 'horror', text: 'Horror, not confirmed psychological' });
    else if (isHorror) flags.push('Psychological horror: rarely OK, check the trailer');
    else if (has(SERIAL_KW) && kwList.some(k => /\b(gore|gory|torture|slasher|mutilation|splatter)\b/.test(k))) hide.push({ id: 'horror', text: 'Serial-killer gore' });
    else if (has(SERIAL_KW)) flags.push('Serial-killer story: check it isn\'t gore-driven');
  }

  if (on('depp') && castIds.slice(0, 6).includes(85)) hide.push({ id: 'depp', text: 'Johnny Depp in the cast' });
  if (on('crowe') && castIds.slice(0, 2).includes(934)) hide.push({ id: 'crowe', text: 'Russell Crowe leads' });

  if (on('cancelled') && f.type === 'tv' && /cancel/i.test(f.status || '') && f.seasons === 1) hide.push({ id: 'cancelled', text: 'Cancelled after one season' });

  // own-data veto
  const veto = vetoCheck(f, profile);
  if (on('veto') && veto.hard.length) hide.push({ id: 'veto', text: 'Your data · ' + veto.hard[0] });
  flags.push(...veto.soft);

  // soft flags
  if (has(ANIMAL_KW)) flags.push('Possible on-screen animal harm (' + kwList.find(k => ANIMAL_KW.test(k)) + '): check before watching');
  if (has(DYSTOPIA_KW) && has(OPPRESSION_KW)) flags.push('Oppressive-state dystopia: the kind that read as a sermon before');
  const effects = G.has(GEN.scifi) || G.has(GEN.action) || G.has(GEN.adventure) || G.has(GEN.scifiFantasy) || G.has(GEN.actionAdv) || has(EPIC_KW);
  if (f.year && f.year >= 1975 && f.year < 2010 && effects) flags.push('Pre-2010 effects-driven: judge the trailer for a dated look');
  if (f.year && f.year >= 2016 && C.size && [...C].every(c => c === 'US' || c === 'GB')) flags.push('Post-2015 US/UK: needs a specific reason to pass');
  const monkey = (f.directors || []).find(d => profile?.monkey.has(norm(d.name)) && norm(d.name) !== norm(ctx.personName || ''));
  if (monkey) flags.push(`More ${monkey.name}: you'd find this yourself`);

  return { hide, flags, rated: rated || null, verdict: v || null, monkey: !!monkey, veto };
}

export function summarizeHidden(evals) {
  const counts = new Map();
  for (const e of evals) for (const h of e.hide.slice(0, 1)) counts.set(h.id, (counts.get(h.id) || 0) + 1);
  const label = { rated: 'rated', verdict: 'not for me', dns: 'do-not-suggest', iran: 'Iranian', spain: 'Spanish', mideast: 'Middle East', superhero: 'superhero', uscomedy: 'US comedy', horror: 'horror', depp: 'Depp', crowe: 'Crowe', cancelled: 'cancelled', veto: 'your data' };
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => `${n} ${label[id] || id}`).join(' · ');
}
