// Classify gallery photos by subject and reorder per Eric's requested sequence:
// 1 exterior whole-boat, 2 interior salon, 3 interior cabins,
// 4 interior hull spaces (office/laundry/watermaker/owner bathroom),
// 5 cockpit, 6 technical spaces (engine, electrics, etc.), 7 lifestyle.
// Within each category, preserve the current relative order.
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'src/content/gallery';

function readCaption(raw) {
	// Caption can be quoted, unquoted, or a YAML block scalar (|-). Grab everything
	// between "caption: " and the next top-level YAML key or frontmatter close.
	const m = raw.match(/^caption:\s*((?:\|-?\s*\n(?:  .*\n?)+)|.+?)(?=\n\w+:|\n---)/ms);
	if (!m) return '';
	let v = m[1];
	if (v.startsWith('|')) {
		v = v.replace(/^\|-?\s*\n/, '').replace(/^ {2}/gm, '');
	}
	return v.replace(/^['"]|['"]$/g, '').replace(/\s+/g, ' ').trim();
}

function classify(caption, alt) {
	const t = (caption + ' ' + alt).toLowerCase();

	// 7 lifestyle — explicit people / activity
	if (/\bkid(s)?\b|\bfamily\b|\breading\b|\bswimming\b|\bsnorkel(ing|ed)?\b|\bbeach trip\b/.test(t)) return 7;

	// 1 exterior whole-boat — strong cues that outrank any hardware mentioned in caption
	if (/\b(port|starboard)? ?profile\b|\bbow-on\b|\bstern-on\b|\bbeam\b.*\b(on|at|shot|dock|anchor|view)\b|\bat anchor\b|\bat the dock\b|\bfrom the bow\b|\btopsides\b|\bcove stripe\b|\bbottom job\b|\bhull geometry\b|\bhull portrait\b|\bbvi anchorage\b|\b27[- ]?foot beam\b|\bsailing\b|\ba sailor\b|\btransom\b|\bfoil\b|\btriple-spreader\b|\bstack pack\b|\bsail bag\b|\bhardtop bimini\b|\banchored\b|\bunder (way|sail)\b|\bmast\b (pulled|stored|unstepped)|\bsugar scoop\b|\bstern arch\b|\bgraphic on\b/.test(t)) return 1;

	// 4 hull spaces — office, laundry, watermaker, owner bathroom/head, central vacuum
	if (/\bwatermaker\b|\brainman\b|\bdow filmtec\b|\bmembrane\b/.test(t)) return 4;
	if (/\boffice\b|\bworkstation\b|\b(external|dual)[- ]monitor\b|\bmechanical keyboard\b|\bowner's desk\b|\bbookshelf\b/.test(t)) return 4;
	if (/\blaundry\b|\bwasher\b|\bwashing machine\b|\bcentral vacuum\b/.test(t)) return 4;
	if (/\b(owner'?s? |guest |stall |separate |molded fiberglass )?(head|shower|toilet|vanity|bathroom)\b|\bcomposting\b|\bpedestal sink\b|\bgranite vanity\b|\bensuite\b/.test(t) && !/\bfull-batten\b|\bhead up\b|\bhead-stay\b/.test(t)) return 4;

	// 3 cabins — berth, cabin, closet, mattress
	if (/\bberth\b|\b(guest |owner'?s? |master |queen |king )cabin\b|\bowner'?s? suite\b|\bstateroom\b|\bmattress\b|\bwalk-in closet\b|\bhanging (locker|rod)\b/.test(t)) return 3;

	// 5 cockpit — helm, cockpit, nav pod, companionway, teak grate, wet bar (when at helm/cockpit)
	if (/\bcockpit\b|\bhelm\b|\bnav pod\b|\bcompanionway\b|\bteak grate\b|\bwet bar\b/.test(t)) return 5;

	// 2 salon / galley / nav station / dinette
	if (/\bsalon\b|\bsaloon\b|\bgalley\b|\bu-galley\b|\bu-shaped galley\b|\bbar seating\b|\b4-seat bar\b|\bfour-seat bar\b|\bnav station\b|\bpanoramic (windows|salon)\b|\bfire tv\b|\balpes inox\b|\bsharp convection\b|\bmicrowave\b|\bcorian\b|\bsliding glass doors\b|\bsettee\b|\bdinette\b|\bdining table\b|\bstemware\b|\bdish (stowage|cubby|shelf)\b|\bgalley counter\b|\bgalley shelf\b|\bgranite dining\b/.test(t)) return 2;

	// 6 technical — engines, electrics, plumbing, ground tackle, fridges, A/C, fuel, tanks
	if (/\byanmar\b|\bengine bay\b|\bengine room\b|\bsd60\b|\bsaildrive\b|\bautoprop\b|\bvictron\b|\bcerbo\b|\bmppt\b|\bmultiplus\b|\bquattro\b|\binverter\b|\bcharger\b|\blithium\b|\blitime\b|\bbattery bank\b|\bbreaker\b|\bbusbar\b|\bfuse\b|\bshunt\b|\bschneider\b|\bonan\b|\bgenerator\b|\bwindlass\b|\blofrans\b|\bpropane\b|\badler barbour\b|\bfridge\b|\bfreezer\b|\bdanfoss\b|\binkbird\b|\bmabru\b|\ba\/c\b|\bair conditioning\b|\bwater tank\b|\bwema\b|\btank-level\b|\brocna\b|\bground tackle\b|\bpump\b|\bmanifold\b|\bjabsco\b|\bseacock\b|\bfuel filter\b|\bengine mounts?\b|\bsoft mount\b|\bheat exchanger\b|\bcoolant\b|\bvibration\b|\bac distribution\b|\bac panel\b|\bdc panel\b|\bshore inlet\b|\bdatahub\b|\bacu-200\b|\bais650\b|\bpredictwind\b|\btransceiver\b|\bmmsi\b|\bgalvanic isolator\b|\bfurler\b/.test(t)) return 6;

	// Default: exterior whole-boat
	return 1;
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.md'));
const items = files.map((f) => {
	const raw = fs.readFileSync(path.join(DIR, f), 'utf8');
	const caption = readCaption(raw);
	const alt = (raw.match(/^alt:\s*['"]?(.+?)['"]?\s*$/m) || [])[1] || '';
	const oldOrder = parseInt((raw.match(/^order:\s*(\d+)/m) || [])[1] || '9999', 10);
	const category = classify(caption, alt);
	return { f, caption, alt, oldOrder, category, raw };
});

// Sort by (category asc, oldOrder asc) then assign new orders 1..N
items.sort((a, b) => a.category - b.category || a.oldOrder - b.oldOrder);
items.forEach((item, i) => (item.newOrder = i + 1));

// Show summary
const byCat = {};
for (const i of items) {
	byCat[i.category] = (byCat[i.category] || 0) + 1;
}
console.log('Category counts:', byCat);
console.log('Totals:', items.length);

// Write back, only updating the order line
let updated = 0;
for (const item of items) {
	if (item.oldOrder === item.newOrder) continue;
	const next = item.raw.replace(/^order:\s*\d+/m, `order: ${item.newOrder}`);
	if (next !== item.raw) {
		fs.writeFileSync(path.join(DIR, item.f), next);
		updated++;
	}
}
console.log('Files updated:', updated);

// Emit a plain-text audit of the final order for review
const audit = items.map((i) => `${i.newOrder.toString().padStart(3)} [cat ${i.category}] ${i.f}  ::  ${i.caption.slice(0, 120)}`).join('\n');
fs.writeFileSync('scripts/.gallery-order-audit.txt', audit);
console.log('Audit: scripts/.gallery-order-audit.txt');
