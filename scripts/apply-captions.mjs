// Apply new captions from scripts/.caption-merged.json into the gallery markdown files.
// Updates the `caption:` line in frontmatter (or inserts one if missing).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const GALLERY = path.join(ROOT, 'src/content/gallery');
const captions = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/.caption-merged.json'), 'utf8'));

function yamlQuote(s) {
	// Double-quote the caption and escape internal `"` → `\"` and `\` → `\\`.
	return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

let updated = 0;
let missing = 0;
let unchanged = 0;
for (const [file, newCaption] of Object.entries(captions)) {
	const p = path.join(GALLERY, file);
	if (!fs.existsSync(p)) {
		console.warn('MISSING:', file);
		missing++;
		continue;
	}
	const original = fs.readFileSync(p, 'utf8');
	const fmEnd = original.indexOf('\n---', 4);
	if (fmEnd === -1) {
		console.warn('NO FRONTMATTER:', file);
		missing++;
		continue;
	}
	const frontmatter = original.slice(0, fmEnd);
	const rest = original.slice(fmEnd);
	let newFm;
	const quoted = yamlQuote(newCaption);
	if (/^caption:\s*.+$/m.test(frontmatter)) {
		newFm = frontmatter.replace(/^caption:\s*.+$/m, `caption: ${quoted}`);
	} else {
		newFm = frontmatter.trimEnd() + `\ncaption: ${quoted}`;
	}
	const next = newFm + rest;
	if (next === original) {
		unchanged++;
		continue;
	}
	fs.writeFileSync(p, next);
	updated++;
}
console.log(`updated ${updated}, unchanged ${unchanged}, missing ${missing}`);
