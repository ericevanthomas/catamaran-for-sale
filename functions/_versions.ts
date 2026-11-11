// Which addresses one version of the site says differently from another.
//
// ⚠️ SHARED BY THE ENDPOINT AND ITS TEST, for the same reason _assemble.mjs is:
// a test with its own copy of this would be testing a lookalike, and the two
// could agree with each other while disagreeing with what actually runs.
import { EDITABLE, readPath, KEYED } from '../src/config/editable.js';

// Every address the allowlist knows, with `*` filled in from the records this
// site actually has. An address nobody can edit is not worth restoring.
export function addresses(s: any): string[] {
  const pool = (root: string): string[] => {
    const v = s?.[root];
    if (!Array.isArray(v)) return [];
    const key = (KEYED as any)[root] || 'id';
    return v.map((it: any, i: number) => String(it?.[key] ?? i));
  };
  const out: string[] = [];
  for (const path of Object.keys(EDITABLE)) {
    const seg = path.split('.');
    const i = seg.indexOf('*');
    if (i < 0) { out.push(path); continue; }
    if (i !== 1) continue;                       // only a record id is expandable here
    for (const id of pool(seg[0])) out.push([seg[0], id, ...seg.slice(2)].join('.'));
  }
  return out.filter((a) => !a.includes('*'));
}

// What `then` says that `now` says differently. Whole values, both sides, so
// there is no base to be wrong about — which is the entire difference between
// this and the patch-walking revert it replaces.
export function diffFrom(then: any, now: any): { field: string; value: unknown }[] {
  const out: { field: string; value: unknown }[] = [];
  for (const field of addresses(now)) {
    const a = readPath(then, field);
    const b = readPath(now, field);
    if (a === undefined && b === undefined) continue;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    out.push({ field, value: a });
  }
  return out;
}
