// Build-time image pipeline.
// Scans public/images/, generates responsive WebP variants into public/_img/
// keyed by source content hash so the cache restores correctly on CI.
// Emits src/generated/image-manifest.json consumed by <ResponsiveImage />.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'public', 'images');
const OUT_DIR = path.join(ROOT, 'public', '_img');
const HASH_DB = path.join(OUT_DIR, '.source-hashes.json');
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

function hashFile(absPath) {
	const h = crypto.createHash('sha1');
	h.update(fs.readFileSync(absPath));
	return h.digest('hex');
}

async function ensureDir(p) {
	await fs.promises.mkdir(p, { recursive: true });
}

async function processImage(absSrc, manifest, prevHashes, newHashes, stats) {
	const rel = path.relative(path.join(ROOT, 'public'), absSrc);
	const key = '/' + toPosix(rel);
	const parsed = path.parse(rel);
	const relDir = parsed.dir;
	const base = parsed.name;

	const srcHash = hashFile(absSrc);
	newHashes[key] = srcHash;

	const meta = await sharp(absSrc).metadata();
	const origW = meta.width ?? 0;
	const origH = meta.height ?? 0;
	if (!origW || !origH) return;

	const outVariantDir = path.join(OUT_DIR, relDir, base);
	await ensureDir(outVariantDir);

	const targetWidths = [...new Set(WIDTHS.filter((w) => w < origW)), Math.min(origW, MAX_ORIGINAL_WIDTH)]
		.sort((a, b) => a - b);

	const variants = [];
	const srcUnchanged = prevHashes[key] === srcHash;

	for (const w of targetWidths) {
		const outFile = path.join(outVariantDir, `${w}.webp`);
		const outRel = '/' + toPosix(path.relative(path.join(ROOT, 'public'), outFile));
		const skip = srcUnchanged && fs.existsSync(outFile);
		if (!skip) {
			await sharp(absSrc)
				.resize({ width: w, withoutEnlargement: true })
				.webp({ quality: QUALITY })
				.toFile(outFile);
			stats.generated++;
		} else {
			stats.skipped++;
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
	const prevHashes = fs.existsSync(HASH_DB) ? JSON.parse(fs.readFileSync(HASH_DB, 'utf8')) : {};
	const newHashes = {};
	const stats = { generated: 0, skipped: 0 };
	const t0 = Date.now();
	for (const abs of sources) {
		await processImage(abs, manifest, prevHashes, newHashes, stats);
	}
	await ensureDir(path.dirname(MANIFEST_PATH));
	fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
	await ensureDir(OUT_DIR);
	fs.writeFileSync(HASH_DB, JSON.stringify(newHashes, null, 2));
	console.log(
		`[optimize-images] ${sources.length} sources · ${stats.skipped} variants cached, ${stats.generated} generated · ${Date.now() - t0}ms`,
	);
}

main().catch((err) => {
	console.error('[optimize-images] failed:', err);
	process.exit(1);
});
