// Build-time image pipeline.
// Scans public/images/, converts any non-WebP source to WebP, and generates
// responsive variants into public/_img/. Emits src/generated/image-manifest.json
// consumed by <ResponsiveImage />.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'public', 'images');
const OUT_DIR = path.join(ROOT, 'public', '_img');
const MANIFEST_PATH = path.join(ROOT, 'src', 'generated', 'image-manifest.json');

const WIDTHS = [400, 800, 1200, 1600];
const QUALITY = 72;
const MAX_ORIGINAL_WIDTH = 2000;
const IMG_EXT = /\.(jpe?g|png|webp|avif)$/i;

function walk(dir, out = []) {
	if (!fs.existsSync(dir)) return out;
	for (const name of fs.readdirSync(dir)) {
		const full = path.join(dir, name);
		const stat = fs.statSync(full);
		if (stat.isDirectory()) walk(full, out);
		else if (IMG_EXT.test(name)) out.push(full);
	}
	return out;
}

function toPosix(p) {
	return p.split(path.sep).join('/');
}

async function ensureDir(p) {
	await fs.promises.mkdir(p, { recursive: true });
}

async function processImage(absSrc, manifest) {
	const rel = path.relative(path.join(ROOT, 'public'), absSrc); // images/gallery/foo.webp
	const key = '/' + toPosix(rel); // /images/gallery/foo.webp
	const parsed = path.parse(rel);
	const relDir = parsed.dir; // images/gallery
	const base = parsed.name; // foo

	const meta = await sharp(absSrc).metadata();
	const origW = meta.width ?? 0;
	const origH = meta.height ?? 0;
	if (!origW || !origH) return;

	const outVariantDir = path.join(OUT_DIR, relDir, base);
	await ensureDir(outVariantDir);

	const variants = [];
	const targetWidths = [...new Set(WIDTHS.filter((w) => w < origW)), Math.min(origW, MAX_ORIGINAL_WIDTH)]
		.sort((a, b) => a - b);

	for (const w of targetWidths) {
		const outFile = path.join(outVariantDir, `${w}.webp`);
		const outRel = '/' + toPosix(path.relative(path.join(ROOT, 'public'), outFile));
		const needsBuild = !fs.existsSync(outFile) || fs.statSync(outFile).mtimeMs < fs.statSync(absSrc).mtimeMs;
		if (needsBuild) {
			await sharp(absSrc)
				.resize({ width: w, withoutEnlargement: true })
				.webp({ quality: QUALITY })
				.toFile(outFile);
		}
		const h = Math.round((origH / origW) * w);
		variants.push({ w, h, src: outRel });
	}

	manifest[key] = {
		width: origW,
		height: origH,
		aspectRatio: origW / origH,
		variants,
	};
}

async function main() {
	const sources = walk(SRC_DIR);
	const manifest = {};
	let processed = 0;
	const t0 = Date.now();
	for (const abs of sources) {
		await processImage(abs, manifest);
		processed++;
	}
	await ensureDir(path.dirname(MANIFEST_PATH));
	fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
	console.log(
		`[optimize-images] processed ${processed} images → ${Object.keys(manifest).length} manifest entries in ${Date.now() - t0}ms`,
	);
}

main().catch((err) => {
	console.error('[optimize-images] failed:', err);
	process.exit(1);
});
