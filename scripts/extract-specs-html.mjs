// Extract spec content from site source and emit a print-ready HTML document.
import fs from 'fs';

// 1) Specs collection (structured key-value)
const specsDir = 'src/content/specs';
const specs = fs.readdirSync(specsDir)
	.filter(f => f.endsWith('.md'))
	.map(f => {
		const t = fs.readFileSync(`${specsDir}/${f}`, 'utf8');
		const g = (k) => (t.match(new RegExp(`^${k}:\\s*"?([^"\\n]+?)"?\\s*$`, 'm')) || [])[1];
		return {
			label: g('label'),
			value: g('value'),
			group: g('group'),
			order: Number(g('order')),
		};
	});

const groupOrder = ['Dimensions', 'Engines & Propulsion', 'Tankage', 'Accommodations', 'Construction'];
const grouped = new Map();
for (const s of specs.sort((a, b) => a.order - b.order)) {
	if (!grouped.has(s.group)) grouped.set(s.group, []);
	grouped.get(s.group).push(s);
}
const sortedGroups = [...grouped.entries()].sort(([a], [b]) => {
	const ai = groupOrder.indexOf(a), bi = groupOrder.indexOf(b);
	return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
});

// 2) Equipment inventory (parse from specs.astro)
const astro = fs.readFileSync('src/pages/specs.astro', 'utf8');
// Extract content inside <section class="s-equip">...</section>
const equipMatch = astro.match(/<section class="s-equip">[\s\S]*?<\/section>/);
let equipHtml = equipMatch ? equipMatch[0] : '';
// Strip all <span class="s-equip__badge..."...>text</span>
equipHtml = equipHtml.replace(/<span class="s-equip__badge[^"]*">([^<]*)<\/span>/g, '<span class="badge badge--$1">$1</span>');
// Unwrap strong / note / etc. minimal cleanup
equipHtml = equipHtml.replace(/<section class="s-equip">/, '').replace(/<\/section>\s*$/, '');
// Replace s-equip class prefixes with 'equip'
equipHtml = equipHtml
	.replace(/class="s-equip__inner"/g, 'class="equip-inner"')
	.replace(/class="s-equip__section"/g, 'class="equip-section"')
	.replace(/class="s-equip__note"/g, 'class="equip-note"');

// 3) Assemble final HTML
const groupsHtml = sortedGroups.map(([group, items]) => `
		<div class="spec-group">
			<h2>${group}</h2>
			<table class="spec-table">
				<tbody>
					${items.map(i => `<tr><th>${i.label}</th><td>${i.value}</td></tr>`).join('')}
				</tbody>
			</table>
		</div>
`).join('');

const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>S/V Tropicalia — Specifications & Equipment</title>
<style>
	@page { size: Letter; margin: 0.6in 0.55in; }
	* { box-sizing: border-box; }
	body {
		font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
		color: #1a2a3a;
		font-size: 9.5pt;
		line-height: 1.4;
		margin: 0;
	}
	.cover {
		text-align: left;
		padding: 0 0 24pt;
		border-bottom: 2pt solid #0e918c;
		margin-bottom: 18pt;
		page-break-after: avoid;
	}
	.eyebrow {
		font-size: 8pt;
		font-weight: 700;
		letter-spacing: 2pt;
		text-transform: uppercase;
		color: #0e918c;
		margin: 0 0 6pt;
	}
	h1 {
		font-size: 26pt;
		font-weight: 700;
		margin: 0 0 6pt;
		letter-spacing: -0.5pt;
		color: #0a1929;
	}
	.subtitle {
		font-size: 11pt;
		color: #5a6b7a;
		margin: 0 0 6pt;
	}
	.meta {
		font-size: 8pt;
		color: #7a8b9a;
		margin: 6pt 0 0;
	}
	h2 {
		font-size: 12pt;
		font-weight: 700;
		margin: 16pt 0 6pt;
		padding: 0 0 4pt;
		border-bottom: 1pt solid #cfd8dc;
		color: #0a1929;
		page-break-after: avoid;
	}
	h3 {
		font-size: 10pt;
		font-weight: 700;
		margin: 10pt 0 4pt;
		color: #0a1929;
	}
	.spec-group { margin-bottom: 6pt; break-inside: avoid; }
	.spec-table { width: 100%; border-collapse: collapse; margin: 0; }
	.spec-table th, .spec-table td {
		text-align: left;
		vertical-align: top;
		padding: 3.5pt 8pt 3.5pt 0;
		border-bottom: 0.5pt solid #e5e9ec;
	}
	.spec-table th {
		font-weight: 500;
		color: #5a6b7a;
		width: 34%;
	}
	.spec-table td {
		font-weight: 500;
		color: #0a1929;
	}
	/* Equipment inventory */
	.equip-inner > * { break-inside: avoid-page; }
	.equip-section {
		margin-bottom: 10pt;
	}
	.equip-section ul {
		margin: 4pt 0 0;
		padding: 0;
		list-style: none;
		columns: 1;
	}
	.equip-section li {
		padding: 3pt 0;
		border-bottom: 0.5pt solid #eceff1;
		font-size: 9pt;
		line-height: 1.35;
	}
	.equip-section li:last-child { border-bottom: none; }
	.equip-note {
		font-size: 8.5pt;
		color: #5a6b7a;
		font-style: italic;
		margin: 0 0 6pt;
	}
	.badge {
		display: inline-block;
		font-size: 6.5pt;
		font-weight: 700;
		letter-spacing: 0.5pt;
		padding: 1pt 5pt;
		border-radius: 2pt;
		background: #0e918c;
		color: #fff;
		margin-left: 4pt;
		vertical-align: middle;
		text-transform: uppercase;
	}
	.badge--Upgraded { background: #546e7a; }
	.section-break { page-break-before: always; }
	.wrap { max-width: 100%; }
	.inventory-title {
		font-size: 15pt;
		font-weight: 700;
		margin: 0 0 4pt;
		color: #0a1929;
	}
	.inventory-sub {
		font-size: 9pt;
		color: #5a6b7a;
		margin: 0 0 12pt;
	}
</style>
</head>
<body>

<header class="cover">
	<p class="eyebrow">Voyage 500 · S/V Tropicalia</p>
	<h1>Specifications &amp; Equipment</h1>
	<p class="subtitle">2010 Voyage 500 catamaran — for sale by owner, $379,000</p>
	<p class="meta">Prepared ${now} · www.catamaran-for-sale.com</p>
</header>

<section class="specs">
	${groupsHtml}
</section>

<div class="section-break"></div>

<h1 class="inventory-title">Equipment Inventory</h1>
<p class="inventory-sub">Detailed list of systems, gear, and appointments aboard Tropicalia.</p>

${equipHtml}

</body>
</html>`;

fs.writeFileSync('public/specs-sheet.html', html);
console.log('Wrote public/specs-sheet.html — ' + html.length + ' bytes');
