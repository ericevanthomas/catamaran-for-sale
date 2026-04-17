import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const MAX_WIDTH = 2000;
const QUALITY = 80;
const root = 'public/images';

async function walk(dir) {
	const out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await walk(full)));
		else if (/\.(jpe?g|png)$/i.test(entry.name)) out.push(full);
	}
	return out;
}

const files = await walk(root);
let beforeTotal = 0, afterTotal = 0;

for (const file of files) {
	const before = fs.statSync(file).size;
	beforeTotal += before;
	const md = await sharp(file).metadata();
	const out = file.replace(/\.(jpe?g|png)$/i, '.webp');

	let pipeline = sharp(file);
	if (md.width > MAX_WIDTH) pipeline = pipeline.resize({ width: MAX_WIDTH });
	await pipeline.webp({ quality: QUALITY }).toFile(out + '.tmp');
	fs.renameSync(out + '.tmp', out);

	if (out !== file) fs.unlinkSync(file);
	const after = fs.statSync(out).size;
	afterTotal += after;
	const pct = ((1 - after / before) * 100).toFixed(0);
	console.log(`${path.basename(file)} → ${path.basename(out)}  ${(before/1024).toFixed(0)}KB → ${(after/1024).toFixed(0)}KB  (-${pct}%)`);
}

console.log(`\nTotal: ${(beforeTotal/1024/1024).toFixed(1)}MB → ${(afterTotal/1024/1024).toFixed(1)}MB  (-${((1 - afterTotal/beforeTotal)*100).toFixed(0)}%)`);
