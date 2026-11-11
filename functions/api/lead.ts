// CF Pages Function: POST /api/lead — the RP lead-capture pipeline.
//
//   parse form body
//     → validate (name/email/message required, email shape, length caps)
//     → spam checks (honeypot + time-trap)  → silent fake-success on hit
//     → write lead row to D1 (system of record)
//     → channel fan-out (email, and a CRM nudge to the dashboard) — best-effort, never fatal
//     → 302 redirect back to /contact
//
// D1 binding: DB → rp-fourlakes.  Email: Resend, key from RESEND_API_KEY.
// Zero client JS on the site — this is a plain HTML form POST with a server
// redirect; ?sent / ?err drive a no-JS :target notice on the contact page.

interface Env {
  DB: D1Database;
  RESEND_API_KEY?: string;
  // The dashboard tenant slug this site belongs to, and the key that lets it
  // ask for an immediate CRM push. Both are Pages settings, not code, because
  // this file is the template every RP client site is cut from.
  RP_SITE?: string;
  RP_SERVICE_KEY?: string;
  RP_DASH?: string;
}

// The custom domain, not rp-dashboard-cw0.pages.dev: Cloudflare refuses a
// same-account *.pages.dev fetch from inside a Worker with error 1042.
const DASH = 'https://app.remodelerpilot.com';

const CAPS = { name: 200, email: 200, phone: 60, message: 4000, visitor: 64 } as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const redirect = (request: Request, to: string) =>
  // 302; the browser re-requests the static /contact page via GET.
  Response.redirect(new URL(to, request.url).href, 302);

function str(form: FormData, key: string, cap: number): string {
  return (form.get(key) || '').toString().trim().slice(0, cap);
}

// ── channel adapters ──────────────────────────────────────────────────────
// Fan-out is modelled as adapters so a CRM channel can be added beside email
// later. Each returns whether it succeeded; a failure never fails the lead.

interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string;
  message: string;
  source_path: string;
}

async function emailAdapter(lead: Lead, env: Env): Promise<{ ok: boolean; id?: string }> {
  if (!env.RESEND_API_KEY) {
    // Expected on deploys without the Pages secret set. Lead still saved.
    console.warn('lead: RESEND_API_KEY absent — skipping email notification');
    return { ok: false };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: 'onboarding@resend.dev',
        to: 'eric@electromagneticweb.com',
        reply_to: lead.email,
        subject: `New inquiry: ${lead.name}`,
        text: `New project inquiry\n\n` +
          `Name:  ${lead.name}\n` +
          `Email: ${lead.email}\n` +
          `Phone: ${lead.phone || '—'}\n` +
          `From:  ${lead.source_path}\n` +
          `Lead:  ${lead.id}\n\n` +
          `${lead.message}\n`,
      }),
    });
    if (!res.ok) {
      console.warn(`lead: Resend responded ${res.status}: ${await res.text()}`);
      return { ok: false };
    }
    const data = (await res.json()) as { id?: string };
    return { ok: true, id: data.id };
  } catch (err) {
    console.warn(`lead: email adapter threw — ${err}`);
    return { ok: false };
  }
}

// The CRM channel the comment above promised. It does not push the lead itself;
// it asks the dashboard to, because the tokens for a client's CRM live in that
// client's own D1 and are never handed to a website.
//
// Eric 2026-09-10: a lead written straight into D1 by a site like this one never
// reached a CRM at all, because only the collector called autoPush. rp-fleet
// now sweeps every five minutes and covers this whether or not the call below
// works, so every failure mode here is a delay and not a lost lead.
//
// RP_SITE is required and has no default ON PURPOSE. This file is copied to
// every new client site; a forgotten setting must mean "the sweep handles it",
// never "push this client's leads into whichever tenant the template shipped
// pointing at".
function crmAdapter(env: Env, leadId: string): Promise<unknown> | null {
  if (!env.RP_SITE || !env.RP_SERVICE_KEY) return null;
  const base = env.RP_DASH || DASH;
  const qs = `action=sync&site=${encodeURIComponent(env.RP_SITE)}&lead=${encodeURIComponent(leadId)}`;
  return fetch(`${base}/api/crm?${qs}`, {
    method: 'POST',
    headers: { 'x-rp-service-key': env.RP_SERVICE_KEY, 'user-agent': 'rp-site-kit-lead/1' },
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
}

// ── handler ───────────────────────────────────────────────────────────────

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return redirect(request, '/contact?err=1#err');
  }

  const source_path = new URL(request.url).pathname === '/api/lead'
    ? str(form, 'source_path', 300) || '/contact'
    : '/contact';
  // A cost-guide form posts the guide's own path and lands on its thank-you
  // page; the dashboard reads that path as the download (Eric, 2026-09-22).
  const guidePath = str(form, 'guide_path', 300) || null;
  const done = guidePath && /^\/resources\/[a-z0-9-]+$/.test(guidePath)
    ? `${guidePath}/thank-you`
    : '/contact?sent=1#sent';
  const referrer = str(form, 'referrer', 500) || request.headers.get('referer') || null;

  // ── spam: honeypot + time-trap ──
  // A hit is recorded (spam=1) then answered with a fake success — the bot
  // learns nothing, and we keep the row for cheap forensics.
  const honeypotHit = str(form, 'website', 200).length > 0;

  const tsRaw = str(form, 'ts', 20);
  const ts = Number.parseInt(tsRaw, 10);
  // Time-trap: reject submissions that arrive < 3s after the form was rendered.
  // NOTE: the site is static, so `ts` is stamped at BUILD time (see
  // ContactForm.astro). Against a scrape-and-fire bot on a freshly built page
  // this fires; on an old build it cannot, so the honeypot is the primary
  // defense here. The check is correct the moment a render-time timestamp
  // source (edge/SSR) exists — no code change needed then.
  const timeTrapHit = Number.isFinite(ts) && ts > 0 && (Date.now() - ts) < 3000;

  const isSpam = honeypotHit || timeTrapHit;

  // ── validate ──
  const name = str(form, 'name', CAPS.name);
  const email = str(form, 'email', CAPS.email);
  const phone = str(form, 'phone', CAPS.phone);
  const message = str(form, 'message', CAPS.message);

  if (!isSpam && (!name || !email || !message || !EMAIL_RE.test(email))) {
    // Real validation failure: no row, bounce back with an error notice.
    return redirect(request, '/contact?err=1#err');
  }

  // The anonymous browser id the visit tracker stamped into the form, if it was
  // running. It is what lets the dashboard's Live View say "this visitor has
  // become a customer" without knowing who anyone is — an id matching an id.
  // Absent whenever the tracker is not on the page or the visitor sends Do Not
  // Track; the lead is written either way, just without the link.
  const visitor_id = str(form, 'rp_visitor_id', CAPS.visitor) || null;

  // ── write to D1 (system of record) ──
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO leads
         (id, created_at, name, email, phone, message, source_path, referrer,
          utm_source, utm_medium, utm_campaign, gclid,
          status, emailed, crm_synced, spam, visitor_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`
    )
      .bind(
        id,
        new Date().toISOString(),
        name || '(spam)',
        email || '(spam)',
        phone || null,
        message || '(spam)',
        source_path,
        referrer,
        str(form, 'utm_source', 200) || null,
        str(form, 'utm_medium', 200) || null,
        str(form, 'utm_campaign', 200) || null,
        str(form, 'gclid', 200) || null,
        isSpam ? 'spam' : 'new',
        isSpam ? 1 : 0,
        visitor_id
      )
      .run();
  } catch (err) {
    console.error(`lead: D1 insert failed — ${err}`);
    // Persisting the lead is the one thing that must work; surface an error.
    return redirect(request, '/contact?err=1#err');
  }

  // Spam hits get the same success page a human sees, but no fan-out.
  if (isSpam) {
    return redirect(request, done);
  }

  // ── channel fan-out (best-effort) ──
  // The CRM nudge goes out through waitUntil: the visitor's redirect must never
  // wait on the dashboard, and a dashboard that is down must never turn a saved
  // lead into an error page.
  const nudge = crmAdapter(env, id);
  if (nudge) waitUntil(nudge);

  const emailResult = await emailAdapter(
    { id, name, email, phone, message, source_path },
    env
  );
  if (emailResult.ok) {
    try {
      await env.DB.prepare('UPDATE leads SET emailed = 1 WHERE id = ?').bind(id).run();
    } catch (err) {
      console.warn(`lead: emailed-flag update failed — ${err}`);
    }
    if (emailResult.id) console.log(`lead: emailed via Resend (${emailResult.id})`);
  }

  return redirect(request, done);
};
