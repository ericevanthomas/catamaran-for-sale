// Produce a per-photo context sheet used to rewrite captions.
// Output: scripts/.caption-context.json with { photos: [{ file, image, alt, caption, features: [{title, description}] }] }
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

function readFrontmatter(p) {
	const t = fs.readFileSync(p, 'utf8');
	const m = t.match(/^---\n([\s\S]*?)\n---/);
	if (!m) return {};
	const out = {};
	const lines = m[1].split('\n');
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const kv = line.match(/^(\w+):\s*(.*)$/);
		if (kv) {
			const [, k, vRaw] = kv;
			let v = vRaw.trim();
			if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
			out[k] = v;
			i++;
			continue;
		}
		// list starts with `photos:` etc
		const key = line.match(/^(\w+):\s*$/);
		if (key) {
			const arr = [];
			i++;
			while (i < lines.length && /^\s+- /.test(lines[i])) {
				arr.push(lines[i].replace(/^\s+- /, '').trim());
				i++;
			}
			out[key[1]] = arr;
			continue;
		}
		i++;
	}
	return out;
}

const galleryDir = path.join(ROOT, 'src/content/gallery');
const photos = fs
	.readdirSync(galleryDir)
	.filter((f) => f.endsWith('.md'))
	.map((f) => {
		const fm = readFrontmatter(path.join(galleryDir, f));
		return {
			file: f,
			image: fm.image,
			alt: fm.alt || '',
			caption: fm.caption || '',
		};
	});

const featuresDir = path.join(ROOT, 'src/content/features');
const features = fs
	.readdirSync(featuresDir)
	.filter((f) => f.endsWith('.md'))
	.map((f) => {
		const t = fs.readFileSync(path.join(featuresDir, f), 'utf8');
		const fm = readFrontmatter(path.join(featuresDir, f));
		// photos may be an array in nested format; re-parse loosely
		const photosMatch = t.match(/^photos:\s*\n((?:\s*-\s*.+\n)+)/m);
		const paths = photosMatch
			? photosMatch[1]
					.split('\n')
					.map((l) => l.replace(/^\s*-\s*/, '').trim())
					.filter(Boolean)
			: [];
		return {
			file: f,
			title: fm.title || '',
			description: fm.description || '',
			photos: paths,
		};
	});

// For each photo path, find which features reference it
const photoToFeatures = new Map();
for (const feat of features) {
	for (const p of feat.photos) {
		if (!photoToFeatures.has(p)) photoToFeatures.set(p, []);
		photoToFeatures.get(p).push({ title: feat.title, description: feat.description });
	}
}

const enriched = photos.map((p) => ({
	...p,
	features: photoToFeatures.get(p.image) || [],
}));

fs.writeFileSync(
	path.join(ROOT, 'scripts/.caption-context.json'),
	JSON.stringify(enriched, null, 2),
);
console.log(`wrote scripts/.caption-context.json — ${enriched.length} photos`);
