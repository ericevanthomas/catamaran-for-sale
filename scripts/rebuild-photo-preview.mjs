// Rebuild photo-preview.html: keep the current numbering, add caption overlay
// and a live search box that filters by number / filename / caption.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const html = fs.readFileSync(path.join(root, 'photo-preview.html'), 'utf8');

// 1. Parse the existing tiles: { num, src, filename }
const tileRe = /<div class="tile"><div class="num">(\d+)<\/div><img src="(public\/images\/gallery\/([^"]+))"[^>]*>[\s\S]*?<\/div>\s*<\/div>/g;
const tiles = [];
let m;
while ((m = tileRe.exec(html)) !== null) {
	tiles.push({ num: parseInt(m[1], 10), src: m[2], filename: m[3] });
}

// 2. Load captions + alt keyed by image filename
const gdir = path.join(root, 'src/content/gallery');
const captions = {};
for (const f of fs.readdirSync(gdir)) {
	if (!f.endsWith('.md')) continue;
	const t = fs.readFileSync(path.join(gdir, f), 'utf8');
	const imgMatch = t.match(/^image:\s*['"]?([^'"\n]+?)['"]?\s*$/m);
	if (!imgMatch) continue;
	const imgPath = imgMatch[1];
	const fname = path.basename(imgPath);
	// Caption may be plain string or a block scalar (|-). Capture the rest of the block.
	const capMatch = t.match(/^caption:\s*((?:\|-?\s*\n(?:  .*\n?)+)|.+?)(?=\n\w+:|\n---)/ms);
	let caption = '';
	if (capMatch) {
		caption = capMatch[1];
		if (caption.startsWith('|')) {
			caption = caption.replace(/^\|-?\s*\n/, '').replace(/^ {2}/gm, '');
		}
		caption = caption.replace(/^['"]|['"]$/g, '').replace(/\s+/g, ' ').trim();
	}
	captions[fname] = caption;
}

// 3. Render new HTML
const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const tileHtml = tiles
	.map((t) => {
		const cap = captions[t.filename] || '';
		const searchable = `${t.num} ${t.filename} ${cap}`.toLowerCase();
		return `<div class="tile" data-search="${escapeAttr(searchable)}"><div class="num">${t.num}</div><img src="${t.src}" loading="lazy" alt=""><div class="fn">${t.filename}</div><div class="cap">${escapeText(cap || '—')}</div></div>`;
	})
	.join('\n');

const out = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Tropicalia Photo Preview</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #111; color: #fff; margin: 0; padding: 1rem; }
  h1 { margin: 0 0 0.5rem; font-size: 1.4rem; font-weight: 500; color: #fff; }
  .info { font-size: 0.9rem; color: #888; margin: 0 0 1rem; }
  .toolbar { position: sticky; top: 0; z-index: 10; background: #111; padding: 0.5rem 0 0.75rem; display: flex; gap: 0.75rem; align-items: center; }
  .toolbar input { flex: 1; max-width: 520px; background: #222; color: #fff; border: 1px solid #333; border-radius: 4px; padding: 0.55rem 0.75rem; font: inherit; font-size: 0.95rem; }
  .toolbar input:focus { outline: 2px solid #0e918c; outline-offset: 1px; }
  .toolbar .count { color: #888; font-size: 0.85rem; }
  .grid { column-count: 5; column-gap: 0.75rem; }
  @media (max-width: 1800px) { .grid { column-count: 4; } }
  @media (max-width: 1200px) { .grid { column-count: 3; } }
  @media (max-width: 800px) { .grid { column-count: 2; } }
  @media (max-width: 500px) { .grid { column-count: 1; } }
  .tile { position: relative; break-inside: avoid; margin-bottom: 0.75rem; background: #222; border-radius: 4px; overflow: hidden; }
  .tile[hidden] { display: none; }
  .tile img { width: 100%; height: auto; display: block; }
  .num { position: absolute; top: 0; left: 0; background: rgba(0,0,0,0.8); color: #0e918c; font-weight: 700; font-size: 1.6rem; padding: 0.35rem 0.7rem; border-bottom-right-radius: 4px; z-index: 2; }
  .cap { background: rgba(0,0,0,0.85); color: #e8ecf0; font-size: 0.82rem; line-height: 1.4; padding: 0.55rem 0.7rem; }
  .fn { background: rgba(0,0,0,0.6); color: #888; font-size: 0.66rem; padding: 0.25rem 0.7rem; font-family: ui-monospace, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-top: 1px solid #2a2a2a; }
</style>
</head><body>
<h1>Tropicalia — All ${tiles.length} Photos</h1>
<p class="info">Search by number, filename, or caption. Tell me the numbers for each feature card.</p>
<div class="toolbar">
  <input id="search" type="search" placeholder="Search captions…" autocomplete="off" autofocus>
  <span class="count" id="count">${tiles.length} of ${tiles.length}</span>
</div>
<div class="grid" id="grid">
${tileHtml}
</div>
<script>
  const grid = document.getElementById('grid');
  const tiles = Array.from(grid.querySelectorAll('.tile'));
  const input = document.getElementById('search');
  const count = document.getElementById('count');
  function filter() {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    for (const t of tiles) {
      const hit = !q || t.dataset.search.includes(q);
      t.hidden = !hit;
      if (hit) shown++;
    }
    count.textContent = shown + ' of ' + tiles.length;
  }
  input.addEventListener('input', filter);
</script>
</body></html>
`;

fs.writeFileSync(path.join(root, 'photo-preview.html'), out);
console.log(`rebuilt photo-preview.html — ${tiles.length} tiles, ${Object.keys(captions).length} captions mapped`);
