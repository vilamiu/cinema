"""Stamp a new version into index.html so browsers never run stale code.
Run before every commit:  python3 tools/stamp.py
- version.json holds the current version; a tiny inline script in index.html reloads once
  (with ?v=<new>) when the page it got from cache is older than version.json.
- An import map points every module URL at ?v=<version>, so cached modules are never reused
  across releases; the stylesheet and main script get the same query.
"""
import json, pathlib, re, time
root = pathlib.Path(__file__).resolve().parent.parent
v = time.strftime('%Y%m%d%H%M%S')
mods = sorted(p.name for p in (root / 'js').glob('*.js'))
imap = {'imports': {f'./js/{m}': f'./js/{m}?v={v}' for m in mods}}
html = (root / 'index.html').read_text()
block = (f'<!-- version:start -->\n<script>window.__V="{v}";(function(){{fetch("version.json",{{cache:"no-store"}}).then(function(r){{return r.json()}})'
         f'.then(function(d){{if(d.v&&d.v!==window.__V){{var u=new URL(location.href);if(u.searchParams.get("v")!==d.v){{u.searchParams.set("v",d.v);location.replace(u.toString())}}}}}}).catch(function(){{}})}})();</script>\n'
         f'<script type="importmap">{json.dumps(imap)}</script>\n<!-- version:end -->')
if '<!-- version:start -->' in html:
    html = re.sub(r'<!-- version:start -->.*?<!-- version:end -->', block, html, flags=re.S)
else:
    html = html.replace('<link rel="preconnect" href="https://fonts.googleapis.com">', block + '\n<link rel="preconnect" href="https://fonts.googleapis.com">', 1)
html = re.sub(r'href="css/app\.css(\?v=\d+)?"', f'href="css/app.css?v={v}"', html)
html = re.sub(r'src="js/main\.js(\?v=\d+)?"', f'src="js/main.js?v={v}"', html)
(root / 'index.html').write_text(html)
(root / 'version.json').write_text(json.dumps({'v': v}) + '\n')
print('stamped', v)
