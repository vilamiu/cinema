# Reel Atlas

A personal film explorer. Start from an actor, director, film, country, genre or decade, then jump between connected titles. Every list is checked against my own rules and ratings before it shows up.

**Live:** https://vilamiu.github.io/reel-atlas/

## What it does

- **Start anywhere:** search any person or title, or pick a country, genre or decade. Every name, country, genre, year and keyword on a page is a link, so one tap moves you on.
- **Trail:** a film-strip bar under the header keeps every place visited this session. Tap any step to go back to it.
- **Title pages:** poster, backdrop, embedded YouTube trailer (highest-resolution official trailer first, with a picker for the others), cast and crew, keywords, "More like this" from TMDB's recommendations and similar titles.
- **Rules:** titles that break a hard rule are hidden, with a count and the reason one tap away. Soft flags (psychological horror, possible animal harm, pre-2010 effects, weak lanes in my data, "more from a director I already love") show as badges.
- **My data:** `data/ratings.json` holds my IMDb ratings. Each title page shows how I've rated its country, director and leads. The own-data veto hides titles from groups that have never worked for me.
- **List:** to-watch, seen (with my rating) and not-for-me, stored in the browser. "Copy for Claude" exports a log for the recommender skill.

## Setup

The site needs a free TMDB key (Settings → API on themoviedb.org). Paste it on first visit; it is stored only in that browser.

## Updating my ratings

- Quick, per device: Settings → Import IMDb export (CSV).
- For every device: replace `data/ratings.json` (built from the IMDb export plus the movies-database enrichment) and push.

## Rules source

`js/rules.js` mirrors the hard rules, do-not-suggest list and monkey list from the movie-recommender skill (rules as of 2026-10-24). Each hard rule can be switched off in Settings.

## Tech

Static site, no build step: `index.html`, `css/app.css`, ES modules in `js/`. Data and images from [TMDB](https://www.themoviedb.org). This product uses the TMDB API but is not endorsed or certified by TMDB.
