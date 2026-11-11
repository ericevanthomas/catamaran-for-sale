// Sign in to edit, and sign out again.
//
// GET  /api/edit-session?t=<voucher>     → the dashboard vouched for you
// GET  /api/edit-session?k=<service key>  → a machine lane, for kiosks and rigs
// GET  /api/edit-session?out=1            → clears it
//
// Clerk lands in the DASHBOARD, once, and vouches from there. This handler kept
// its job and changed its evidence exactly as planned: it takes a signed
// voucher instead of a key and mints the same cookie pair, so nothing
// downstream moved (Eric, 2026-09-29).
import { readSessionFull, mintSession, sessionCookie, clearCookie, readSession, readHandoff, DEVICE_S, type EditorEnv } from '../_editor-session';

// The browser-readable half. It carries no authority — it only tells the page
// that asking is worthwhile — so it is deliberately not HttpOnly.
const hintCookie = (on: boolean) =>
  `rp_edit_on=${on ? '1' : ''}; Path=/; Max-Age=${on ? 60 * 60 * 24 * 30 : 0}; Secure; SameSite=Lax`;

// "This browser has edited this site before." Kept for a year and NOT cleared
// on sign-out, because its whole job is to put the R button in front of
// someone who comes back later: press it and, if the session has lapsed, a
// single redirect through the dashboard brings it back (Eric, 2026-09-29).
const deviceCookie = (on: boolean) =>
  `rp_editor_device=${on ? '1' : ''}; Path=/; Max-Age=${on ? DEVICE_S : 0}; Secure; SameSite=Lax`;

export const onRequestGet: PagesFunction<EditorEnv> = async ({ request, env }) => {
  const url = new URL(request.url);

  if (url.searchParams.get('out')) {
    const headers = new Headers({ location: url.searchParams.get('to') || '/' });
    headers.append('set-cookie', clearCookie());
    headers.append('set-cookie', hintCookie(false));
    // The device is still remembered: signing out is "not now", not "never
    // again on this machine".
    if (url.searchParams.get('forget')) headers.append('set-cookie', deviceCookie(false));
    return new Response(null, { status: 302, headers });
  }

  // Already signed in: say so, so the editor can ask without a round trip.
  const sess = await readSessionFull(request, env.RP_SERVICE_KEY);
  if (sess && !url.searchParams.get('k') && !url.searchParams.get('t')) {
    // `rp` is what the editor builds the Review mappings row from. It is a
    // claim the SERVER makes about this cookie, not something the page decides
    // about itself: the row is only the visible half, and the half that matters
    // is /api/approvals refusing anyone who is not RP.
    return new Response(JSON.stringify({ who: sess.who, rp: sess.rp, caps: sess.caps }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }

  // The dashboard's voucher, which is how a person gets here.
  let grant = await readHandoff(url.searchParams.get('t') || '', env.RP_EDITOR_VERIFY_KEY, env.RP_SITE);

  // The service key stays as a deliberate, named lane for machines that cannot
  // sign in — the same shape the dashboard uses for its kiosks.
  if (!grant) {
    const key = url.searchParams.get('k') || '';
    // The machine lane carries no person, so it carries no uid either.
    // Holding the service key IS the RP lane: it is the key this project keeps
    // as a Pages secret, and anyone with it is already trusted further than any
    // role claim would take them.
    //
    // It carries every capability for the same reason it carries `rp`: the
    // holder of the service key is already trusted further than a feature flag
    // would take them, and a machine lane that could not reach a feature the
    // client has would be a lane that cannot test the client's own site.
    if (env.RP_SERVICE_KEY && key === env.RP_SERVICE_KEY) grant = { who: url.searchParams.get('as') || 'Eric Thomas', uid: null, rp: true, caps: ['blog'] };
  }
  if (!grant || !env.RP_SERVICE_KEY) {
    // No hint about which half was wrong, and no timing signal worth having.
    return new Response('Not found', { status: 404 });
  }

  const value = await mintSession(grant.who, env.RP_SERVICE_KEY, grant.uid, grant.rp, grant.caps);
  const headers = new Headers({ location: url.searchParams.get('to') || '/' });
  headers.append('set-cookie', sessionCookie(value));
  headers.append('set-cookie', hintCookie(true));
  headers.append('set-cookie', deviceCookie(true));
  // Signing in always lands you in full view.
  //
  // `rp_view` remembers which of the three views was last chosen, and public
  // view hides the R button on purpose. Eric signed out while in public view,
  // signed back in through /admin, and arrived at a page with no way in: the
  // sign-in had worked, the button was just still hidden by a week-old cookie.
  // The editor cannot detect this itself — the voucher arrives on `?t=` and
  // this redirect strips it before any script runs — so the reset belongs
  // here, on the one request that means somebody just found their way back in
  // (Eric, 2026-09-30).
  // Sign-in lands on the PAGE, not in review mode. The menu is the client's
  // menu now and review is one row inside it (2026-10-13), so a signed-in
  // creator should see what a client sees and step into the review when he
  // means to. This used to write rp_view=staff, which also meant a stale
  // 'client' cookie survived a fresh sign-in and kept him locked out of his own
  // approvals with nothing on screen to say why.
  headers.append('set-cookie', 'rp_view=client; Path=/; Max-Age=604800; SameSite=Lax');
  return new Response(null, { status: 302, headers });
};
