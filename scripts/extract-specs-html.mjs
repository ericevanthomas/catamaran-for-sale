// Extract spec content from site source and emit a print-ready HTML document.
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

// Pre-compress PDF images so the output stays small.
async function compressForPdf(relPath, maxWidth, quality) {
	const src = path.join('public', relPath);
	const dstDir = 'public/pdf-assets';
	fs.mkdirSync(dstDir, { recursive: true });
	const dst = path.join(dstDir, path.basename(relPath).replace(/\.webp$/, `@${maxWidth}.jpg`));
	if (!fs.existsSync(dst) || fs.statSync(dst).mtimeMs < fs.statSync(src).mtimeMs) {
		await sharp(src).resize({ width: maxWidth }).jpeg({ quality, progressive: true }).toFile(dst);
	}
	return `pdf-assets/${path.basename(dst)}`;
}

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
const equipMatch = astro.match(/<section class="s-equip">[\s\S]*?<\/section>/);
let equipHtml = equipMatch ? equipMatch[0] : '';
equipHtml = equipHtml.replace(/<span class="s-equip__badge[^"]*">([^<]*)<\/span>/g, '<span class="badge badge--$1">$1</span>');
equipHtml = equipHtml.replace(/<section class="s-equip">/, '').replace(/<\/section>\s*$/, '');
equipHtml = equipHtml
	.replace(/class="s-equip__inner"/g, 'class="equip-inner"')
	.replace(/class="s-equip__section"/g, 'class="equip-section"')
	.replace(/class="s-equip__note"/g, 'class="equip-note"');

// 3) Hero image (photo #16) + layout diagram + end-of-doc gallery
const heroImageRaw = 'images/gallery/PXL_20260416_172152808.webp';
const heroImage = await compressForPdf(heroImageRaw, 1600, 78);
const layoutImage = await compressForPdf('images/layout-diagram.jpg', 1600, 82);
const galleryImagesRaw = [
	// Exteriors & sailing
	'images/gallery/IMG_0784.webp',
	'images/gallery/IMG_0780.webp',
	'images/gallery/IMG_0787.webp',
	'images/gallery/IMG_0791.webp',
	'images/gallery/PXL_20251219_143447444.webp',
	'images/gallery/PXL_20251221_132503993.webp',
	'images/gallery/PXL_20260416_172336494.webp',
	'images/gallery/PXL_20260416_172319024.webp',
	'images/gallery/PXL_20260419_215615486.RAW-01.COVER.webp',
	'images/gallery/PXL_20260331_141833141.webp',
	'images/gallery/IMG_9832.webp',
	'images/gallery/IMG_9375.webp',
	// Salon + cockpit
	'images/gallery/PXL_20260419_203159996.RAW-01.COVER.webp',
	'images/gallery/PXL_20260419_202850473.RAW-01.COVER.webp',
	'images/gallery/IMG_0886.webp',
	'images/gallery/PXL_20260419_194708255.RAW-01.COVER.webp',
	'images/gallery/PXL_20260419_195711723.RAW-01.COVER.webp',
	'images/gallery/PXL_20260419_221712663.RAW-01.COVER.webp',
	// Galley
	'images/gallery/PXL_20260419_213232411.RAW-01.COVER.webp',
	'images/gallery/PXL_20260419_214726424.RAW-01.COVER.webp',
	'images/gallery/PXL_20260419_213539234.RAW-01.COVER.webp',
	// Cabins & heads
	'images/gallery/PXL_20260421_151534879.webp',
	'images/gallery/PXL_20260421_140901397.webp',
	'images/gallery/PXL_20260420_212136257.webp',
	'images/gallery/PXL_20260420_211125377.webp',
	'images/gallery/PXL_20260420_211011201.webp',
	'images/gallery/PXL_20260421_151648267.webp',
	'images/gallery/PXL_20260420_203359126.webp',
	// Systems
	'images/gallery/PXL_20260419_200035726.RAW-01.COVER.webp',
	'images/gallery/PXL_20260419_213951875.RAW-01.COVER.webp',
	'images/gallery/PXL_20260421_143222305.webp',
	'images/gallery/PXL_20260421_164327039.webp',
	'images/gallery/PXL_20260421_171817700.webp',
	'images/gallery/PXL_20260421_142559846.webp',
	// Dinghy, sails, rigging
	'images/gallery/PXL_20260419_195052100.RAW-01.COVER.webp',
	'images/gallery/PXL_20260419_220008817.RAW-01.COVER.webp',
	// Lifestyle
	'images/gallery/IMG_9775.webp',
];
const galleryImages = await Promise.all(galleryImagesRaw.map(p => compressForPdf(p, 900, 72)));

// 4) Assemble final HTML
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

const galleryHtml = `
<div class="section-break"></div>
<h1 class="inventory-title">Photo Gallery</h1>
<p class="inventory-sub">A selection of images from across the boat.</p>
<figure class="layout-figure">
	<img src="${layoutImage}" alt="Voyage 500 3-cabin owner's version layout" />
	<figcaption>3-Cabin Owner's Version — bow at top. Entire starboard hull is the master suite; two ensuite guest cabins in the port hull.</figcaption>
</figure>
<div class="photo-grid">
${galleryImages.map(src => `	<div class="photo-grid__item"><img src="${src}" loading="eager" /></div>`).join('\n')}
</div>
`;


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
		padding: 0 0 18pt;
		border-bottom: 2pt solid #0e918c;
		margin-bottom: 16pt;
		page-break-after: avoid;
	}
	.cover-img {
		width: 100%;
		height: 3.3in;
		object-fit: cover;
		margin-bottom: 14pt;
		border-radius: 3pt;
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
	.equip-inner > * { break-inside: avoid-page; }
	.equip-section { margin-bottom: 10pt; }
	.equip-section ul {
		margin: 4pt 0 0;
		padding: 0;
		list-style: none;
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
	.inventory-title {
		font-size: 20pt;
		font-weight: 700;
		margin: 0 0 4pt;
		color: #0a1929;
		border-bottom: 2pt solid #0e918c;
		padding-bottom: 6pt;
	}
	.inventory-sub {
		font-size: 9pt;
		color: #5a6b7a;
		margin: 4pt 0 14pt;
	}
	.layout-figure {
		margin: 0 0 10pt;
		break-inside: avoid;
		text-align: center;
	}
	.layout-figure img {
		width: 100%;
		max-width: 6.8in;
		height: auto;
		display: block;
		margin: 0 auto;
		border-radius: 2pt;
	}
	.layout-figure figcaption {
		font-size: 8.5pt;
		color: #5a6b7a;
		margin-top: 4pt;
	}
	.photo-grid {
		column-count: 2;
		column-gap: 6pt;
	}
	.photo-grid__item {
		break-inside: avoid;
		display: inline-block;
		width: 100%;
		margin: 0 0 6pt;
	}
	.photo-grid__item img {
		width: 100%;
		height: auto;
		display: block;
		border-radius: 2pt;
	}
</style>
</head>
<body>

<header class="cover">
	<img class="cover-img" src="${heroImage}" alt="Tropicalia at anchor" />
	<p class="eyebrow">Voyage 500 · S/V Tropicalia</p>
	<h1>Specifications &amp; Equipment</h1>
	<p class="subtitle">2010 Voyage 500 catamaran — for sale by owner, $379,000</p>
	<p class="meta">www.catamaran-for-sale.com</p>
</header>

<section class="specs">
	${groupsHtml}
</section>

<div class="section-break"></div>

<h1 class="inventory-title">Equipment Inventory</h1>
<p class="inventory-sub">Detailed list of systems, gear, and appointments aboard Tropicalia.</p>

${equipHtml}

${galleryHtml}

</body>
</html>`;

fs.writeFileSync('public/specs-sheet.html', html);
console.log('Wrote public/specs-sheet.html — ' + html.length + ' bytes');
