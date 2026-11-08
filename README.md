# Cinema

A personal film explorer. Start from an actor, director, film, country, genre or decade, then jump between connected titles. Every list is checked against my own rules and ratings before it shows up.

**Live:** https://vilamiu.github.io/cinema/

## What it does

- **Promising:** the default order everywhere (home, genre/country/decade lists, filmographies, "More like this"). Scores in `data/taste.json` come from a user-based nearest-neighbour model on MovieTweetings: people whose IMDb ratings resemble mine, weighted by similarity. In a 5-fold backtest on my own ratings, about 62% of its top 10% were titles I rated 8+ (my base rate is 38%; ranking by crowd average gave about 54%). Everything it suggests still goes through the rules.
- **Start anywhere:** search any person or title, or pick a country, genre or decade. Every name, country, genre, year and keyword on a page is a link, so one tap moves you on.
- **Trail:** a film-strip bar under the header keeps every place visited this session. Tap any step to go back to it.
- **Title pages:** poster, backdrop, embedded YouTube trailer (highest-resolution official trailer first, with a picker for the others), cast and crew, keywords, "More like this" from TMDB's recommendations and similar titles.
- **Rules:** titles that break a hard rule are hidden, with a count and the reason one tap away. Soft flags (psychological horror, possible animal harm, pre-2010 effects, weak lanes in my data, "more from a director I already love") show as badges.
- **My data:** `data/ratings.json` holds my IMDb ratings. Each title page shows how I've rated its country, director and leads. The own-data veto hides titles from groups that have never worked for me.
- **Your score:** a 1–10 bar under every title. A score counts at once (hides the title, feeds the own-data veto). IMDb has no API that accepts ratings from other sites, so each new score shows a "Rate on IMDb" button that opens the title in IMDb's app or site; tap the same score there, then "It's on IMDb". Scores not yet on IMDb wait in Your list → Scored here, with a count on the List icon.
- **List:** to-watch, seen (with my rating) and not-for-me, stored in the browser. "Copy for Claude" exports a log for the recommender skill.

## Sign-in

`data/access.json` (built with `node tools/access.mjs --client-id … --user admin:… --user viewer:…`) turns on a Google sign-in screen. Emails are stored only as salted hashes; no TMDB key is stored in the repo, so each device pastes one once. Admin: everything. Viewer: browse and keep a personal "Want to watch" list; no scores, no "Not for me", no Settings. It is a client-side gate: on GitHub Pages the code and data files remain publicly readable. Without `data/access.json` the gate is off.

## Setup

The site needs a free TMDB key (Settings → API on themoviedb.org). Paste it on first visit; it is stored only in that browser.

## Updating my ratings

- Quick, per device: Settings → Import IMDb export (CSV).
- For every device: replace `data/ratings.json` (built from the IMDb export plus the movies-database enrichment), rebuild `data/taste.json` from it, and push.

## Rules source

`js/rules.js` mirrors the hard rules, do-not-suggest list and monkey list from the movie-recommender skill (rules as of 2026-10-24). Each hard rule can be switched off in Settings.

## Tech

Before each commit run `python3 tools/stamp.py`: it versions every module, the stylesheet and `version.json`, and the page reloads itself once when a newer version is live, so browsers never keep stale code.


Static site, no build step: `index.html`, `css/app.css`, ES modules in `js/`. Data and images from [TMDB](https://www.themoviedb.org). This product uses the TMDB API but is not endorsed or certified by TMDB.
