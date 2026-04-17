import sharp from 'sharp';
import fs from 'fs';

const SRC = '/Users/ericthomas/Documents/Personal/Boat Trip/Voyage 500 Gods Grace/Blog/cropped-logo-red-round.png';
const targets = [
	{ name: 'favicon-16.png', size: 16 },
	{ name: 'favicon-32.png', size: 32 },
	{ name: 'favicon-48.png', size: 48 },
	{ name: 'apple-touch-icon.png', size: 180 },
	{ name: 'icon-192.png', size: 192 },
	{ name: 'icon-512.png', size: 512 },
];

for (const t of targets) {
	await sharp(SRC).resize(t.size, t.size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toFile(`public/${t.name}`);
	const kb = (fs.statSync(`public/${t.name}`).size / 1024).toFixed(1);
	console.log(`  ✓ ${t.name} (${kb}KB)`);
}

// Also write the 32x32 PNG as favicon.ico — all modern browsers accept PNG here.
await sharp(SRC).resize(32, 32).png().toFile('public/favicon.ico');
console.log(`  ✓ favicon.ico (32x32 PNG)`);
