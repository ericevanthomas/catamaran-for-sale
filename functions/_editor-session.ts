// Who is allowed to edit this site.
//
// Eventually this is Clerk: a magic link once per device, a passkey after that
// (the 2026-07-13 spec). Until the editing flow itself is proven there is no
// point standing up an identity provider in front of a door that does not open
// yet, so the gate is a signed cookie minted from the service key this project
// already holds as a Pages secret.
//
// It is a real gate, not a placeholder that waves everyone through: the cookie
// is an HMAC over its own expiry, so it cannot be forged or extended by the
// browser holding it, and every write re-checks it.

export interface EditorEnv {
  DB: D1Database;
  RP_SERVICE_KEY?: string;
  RP_SITE?: string;
  /** The dashboard's public signing key, for vouchers it issues. */
  RP_EDITOR_VERIFY_KEY?: string;
  /** Where to send someone who needs to sign in. */
  RP_DASH?: string;
}

const COOKIE = 'rp_edit';
// Thirty days, renewed every time it is used.
//
// A working day was the wrong length: it expired overnight, so every session
// began with a sign-in and the editor felt like a thing you had to get into
// rather than a thing that was there. Sliding renewal means an active client's
// cookie is never more than a few days from their last visit (Eric,
// 2026-09-29).
const LIFETIME_S = 60 * 60 * 24 * 30;

// And a year of "this browser has edited this site before". It is a FLAG, not
// a credential: forging it loads the editor, which asks the API, is refused
// and removes itself. What it buys is the R button being there at the moment
// someone looks at their own site and wants to change something — which is
// the moment the editor has to exist, and the one a link from us cannot reach.
export const DEVICE_S = 60 * 60 * 24 * 365;

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
}

// ── what this TENANT can do, as opposed to who is signed in ────────────────
// A capability is a feature the client's own account has, decided once in the
// dashboard's client registry and carried inside the signed voucher. It is not
// a role: `rp` says whose session this is, and a capability says what this
// WEBSITE has been sold.
//
// The first one is `blog`. Until 2026-11-11 the composer's "Write a new post"
// row was gated on `rp`, with a flag in its own comments saying that was the
// wrong axis — a client either has a blog or does not, and that has nothing to
// do with whether Remodeler Pilot is the one looking at the screen. Keeping it
// in the voucher means one place decides, signed and central, and turning a
// blog on rebuilds nothing on the client's site (Eric, 2026-11-11: "this is a
// toggle in our database, not any sort of variation that ships and deploys
// with the client's own content").
//
// Names are lowercase words joined by commas, because they travel inside a
// pipe-delimited HMAC payload and a JSON blob in a cookie would be a second
// encoding to get wrong.
const OK_CAP = /^[a-z][a-z0-9-]{0,23}$/;
const capList = (caps?: string[] | null) =>
  (caps || []).filter((c) => OK_CAP.test(c)).sort().join(',');

/** The cookie value for a session that expires `LIFETIME_S` from now. */
export async function mintSession(who: string, secret: string, uid?: string | null, rp?: boolean, caps?: string[] | null): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + LIFETIME_S;
  // who|uid|rp|exp|mac. The uid is the Clerk id of the person the dashboard
  // vouched for, carried so a chat started here belongs to THEM and shows up
  // in their own dashboard chat (Eric 2026-10-05). Empty for an admin demoing.
  //
  // `rp` is the ROLE and it is the reason this file changed on 2026-10-13: it
  // says this session belongs to Remodeler Pilot rather than to the client who
  // owns the site. It is inside the HMAC, so a browser cannot grant it to
  // itself by editing a cookie. Before this, the only thing distinguishing the
  // two was the display NAME the dashboard happened to write, and nothing was
  // checking it -- so any signed-in client could approve their own mappings and
  // unlock every field we had mapped but not yet signed off.
  //
  // `caps` is the SIXTH field, added 2026-11-11. It sits inside the HMAC for
  // the same reason `rp` does: a browser must not be able to grant itself a
  // feature by editing a cookie.
  const payload = `${who}|${uid || ''}|${rp ? '1' : ''}|${capList(caps)}|${exp}`;
  return `${payload}|${await sign(payload, secret)}`;
}

/** The signed-in editor's name, or null. Constant-time on the signature. */
export async function readSession(request: Request, secret?: string): Promise<string | null> {
  if (!secret) return null;
  const raw = (request.headers.get('cookie') || '')
    .split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  const full = await readSessionFull(request, secret);
  return full ? full.who : null;
}

// The same check, returning the person as well as their name. Cookies minted
// before `uid` have three parts and before `rp` have four; both still verify
// against the payload shape they were signed with, so nobody is signed out by
// either change. An old four-part cookie simply carries no role, which reads as
// "not RP" -- the safe direction: a creator signs in again, a client is never
// silently promoted.
export async function readSessionFull(
  request: Request,
  secret?: string,
): Promise<{ who: string; uid: string | null; rp: boolean; caps: string[] } | null> {
  if (!secret) return null;
  const raw = (request.headers.get('cookie') || '')
    .split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  const parts = decodeURIComponent(raw.slice(COOKIE.length + 1)).split('|');
  if (parts.length < 3 || parts.length > 6) return null;
  // 6 = who|uid|rp|caps|exp|mac, 5 = who|uid|rp|exp|mac, 4 = who|uid|exp|mac,
  // 3 = who|exp|mac. Each still verifies against the payload shape it was
  // signed with, so nobody is signed out by a new field; an older cookie simply
  // carries no capabilities, which reads as "none" — the safe direction, and the
  // next request from the editor re-mints it with them (functions/api/edit.ts).
  const [who, uid, rp, caps, exp, mac] =
    parts.length === 6 ? parts
      : parts.length === 5 ? [parts[0], parts[1], parts[2], '', parts[3], parts[4]]
        : parts.length === 4 ? [parts[0], parts[1], '', '', parts[2], parts[3]]
          : [parts[0], '', '', '', parts[1], parts[2]];
  if (!/^\d+$/.test(exp) || Number(exp) * 1000 < Date.now()) return null;
  const payload =
    parts.length === 6 ? `${who}|${uid}|${rp}|${caps}|${exp}`
      : parts.length === 5 ? `${who}|${uid}|${rp}|${exp}`
        : parts.length === 4 ? `${who}|${uid}|${exp}`
          : `${who}|${exp}`;
  const want = await sign(payload, secret);
  if (want.length !== mac.length) return null;
  let diff = 0;
  for (let i = 0; i < want.length; i += 1) diff |= want.charCodeAt(i) ^ mac.charCodeAt(i);
  // The role is only ever read from a payload shape that HAD it inside the
  // signature, and the same goes for the capabilities.
  if (diff !== 0) return null;
  return {
    who,
    uid: uid || null,
    rp: (parts.length === 5 || parts.length === 6) && rp === '1',
    caps: parts.length === 6 ? caps.split(',').filter((c) => OK_CAP.test(c)) : [],
  };
}

export const sessionCookie = (value: string) =>
  `${COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${LIFETIME_S}; HttpOnly; Secure; SameSite=Lax`;

export const clearCookie = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

// ── coming in from the dashboard ─────────────────────────────────────────────
// The dashboard already knows who you are: Clerk, an org that maps to a site,
// and `rp_admin` for the operator who may edit any of them. Rather than stand a
// second identity system in front of the editor, the dash vouches for you once
// and this site mints its own short session from that.
//
// The voucher is signed with a key only the dashboard holds; every client site
// carries the PUBLIC half, so a site can check a voucher and cannot forge one
// for itself or for anyone else. It is good for a minute, names the site it is
// for, and is spent on arrival (Eric, 2026-09-29).
const HANDOFF_S = 60;

const b64toBytes = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export interface Handoff { site: string; who: string; uid?: string | null; rp?: boolean; caps?: string[]; exp: number }

export async function readHandoff(token: string, publicKeyB64?: string, expectSite?: string): Promise<{ who: string; uid: string | null; rp: boolean; caps: string[] } | null> {
  if (!token || !publicKeyB64) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    const key = await crypto.subtle.importKey('spki', b64toBytes(publicKeyB64), { name: 'Ed25519' }, false, ['verify']);
    const ok = await crypto.subtle.verify('Ed25519', key, b64toBytes(sig), enc.encode(body));
    if (!ok) return null;
    const claim = JSON.parse(new TextDecoder().decode(b64toBytes(body))) as Handoff;
    // A voucher for another site is not a voucher for this one, however
    // correctly it is signed.
    if (expectSite && claim.site !== expectSite) return null;
    if (!claim.exp || claim.exp * 1000 < Date.now()) return null;
    if (claim.exp * 1000 > Date.now() + (HANDOFF_S + 30) * 1000) return null;   // nonsense future
    // The caller wants the uid and the role as well. `rp` comes from the
    // dashboard's own `grant.admin`, inside a claim signed with a key only the
    // dashboard holds -- a client site can check this and can never write one.
    // `caps` is this TENANT'S feature list, read from the client registry at
    // mint time. A voucher that predates capabilities carries none, which reads
    // as a site with no blog — the safe direction, and the one a single
    // dashboard deploy corrects for every client at once.
    return {
      who: claim.who || 'Someone at Remodeler Pilot',
      uid: claim.uid || null,
      rp: claim.rp === true,
      caps: Array.isArray(claim.caps) ? claim.caps.filter((c) => typeof c === 'string' && OK_CAP.test(c)) : [],
    };
  } catch {
    return null;
  }
}
