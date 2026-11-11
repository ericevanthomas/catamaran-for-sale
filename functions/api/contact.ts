// Cloudflare Pages Function — POST /api/contact
// Receives the contact form, validates, stores in KV, and forwards via Resend.
// Env vars required: RESEND_API_KEY, NOTIFY_EMAIL, FROM_EMAIL. Optional: CONTACT_SUBMISSIONS (KV), TURNSTILE_SECRET_KEY.
// Spam prevention: honeypot field + Cloudflare Turnstile (when TURNSTILE_SECRET_KEY is set).

interface Env {
	CONTACT_SUBMISSIONS?: KVNamespace;
	RESEND_API_KEY: string;
	NOTIFY_EMAIL: string;
	FROM_EMAIL: string;
	DOMAIN?: string;
	TURNSTILE_SECRET_KEY?: string; // Cloudflare Turnstile secret key
	// This tenant's own database, bound as DB in wrangler.prod.toml. Optional
	// in the type because a preview deployment may not have it, and an enquiry
	// must never be lost to a missing binding.
	DB?: D1Database;
}

interface ContactBody {
	name?: string;
	email?: string;
	phone?: string;
	message?: string;
	website?: string; // honeypot — real users leave this blank
	'cf-turnstile-response'?: string; // Cloudflare Turnstile token
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

function escapeHtml(s: string) {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
	let data: ContactBody;
	try {
		const ct = request.headers.get('content-type') ?? '';
		if (ct.includes('application/json')) {
			data = await request.json();
		} else {
			const form = await request.formData();
			data = Object.fromEntries(form.entries()) as ContactBody;
		}
	} catch {
		return json({ ok: false, error: 'Bad request body' }, 400);
	}

	// Honeypot — silently succeed for bots that fill the hidden field
	if (data.website && data.website.trim() !== '') {
		return json({ ok: true });
	}

	// Cloudflare Turnstile verification — runs when TURNSTILE_SECRET_KEY is configured
	if (env.TURNSTILE_SECRET_KEY) {
		const token = data['cf-turnstile-response'] ?? '';
		if (!token) {
			return json({ ok: false, error: 'Security check missing. Please refresh and try again.' }, 400);
		}
		const ip = request.headers.get('cf-connecting-ip') ?? '';
		const verifyForm = new FormData();
		verifyForm.append('secret', env.TURNSTILE_SECRET_KEY);
		verifyForm.append('response', token);
		if (ip) verifyForm.append('remoteip', ip);
		try {
			const verifyResp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
				method: 'POST',
				body: verifyForm,
			});
			const verifyData = await verifyResp.json() as { success: boolean };
			if (!verifyData.success) {
				return json({ ok: false, error: 'Security check failed. Please refresh and try again.' }, 400);
			}
		} catch (e) {
			console.error('Turnstile verification failed', e);
			return json({ ok: false, error: 'Security check unavailable. Please try again shortly.' }, 500);
		}
	}

	const name = (data.name ?? '').trim();
	const email = (data.email ?? '').trim();
	const phone = (data.phone ?? '').trim();
	const message = (data.message ?? '').trim();

	if (!name || name.length > 120) return json({ ok: false, error: 'Name is required' }, 400);
	if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
		return json({ ok: false, error: 'A valid email is required' }, 400);
	}
	if (!message || message.length < 5 || message.length > 5000) {
		return json({ ok: false, error: 'Message is required (5–5000 chars)' }, 400);
	}

	const submittedAt = new Date().toISOString();
	const id = crypto.randomUUID();
	const record = { id, submittedAt, name, email, phone, message };

	// ── where an enquiry is kept ───────────────────────────────────────────
	//
	// ⚠️ THE KV ARCHIVE BELOW HAS NEVER RUN. `CONTACT_SUBMISSIONS` is not bound
	// on this Pages project and never has been (checked against the Cloudflare
	// API, 2026-11-11), so every enquiry this site has ever taken existed only
	// as an email. If that email bounced, was filtered, or was deleted, the
	// enquiry was gone. The block is left in place because binding a namespace
	// would make it work; it is simply not the archive anybody had.
	//
	// The archive is the `leads` table in this tenant's own database, which is
	// where the dashboard's Inbox and Live View read from — the same table
	// functions/api/lead.ts writes, with the same columns in the same order, so
	// an enquiry taken by this form and one taken by the platform endpoint are
	// the same kind of row.
	//
	// Best-effort and last: it runs AFTER validation and BEFORE the email, and a
	// failure is logged and swallowed. An enquiry that is recorded but not
	// emailed is recoverable; one that is neither is not; and refusing to send
	// the email because a write failed would turn a database hiccup into a lost
	// customer.
	if (env.DB) {
		try {
			const url = new URL(request.url);
			await env.DB.prepare(
				`INSERT INTO leads
				   (id, created_at, name, email, phone, message, source_path, referrer,
				    utm_source, utm_medium, utm_campaign, gclid,
				    status, emailed, crm_synced, spam)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', 0, 0, 0)`,
			)
				.bind(
					id, submittedAt, name, email, phone || null, message,
					url.searchParams.get('path') || '/contact/',
					request.headers.get('referer') || null,
					url.searchParams.get('utm_source') || null,
					url.searchParams.get('utm_medium') || null,
					url.searchParams.get('utm_campaign') || null,
					url.searchParams.get('gclid') || null,
				)
				.run();
		} catch (e) {
			console.error('lead write failed', String(e).slice(0, 200));
		}
	}

	// Best-effort KV archive — never blocks the email. Dead unless a namespace
	// is bound; see above.
	if (env.CONTACT_SUBMISSIONS) {
		try {
			await env.CONTACT_SUBMISSIONS.put(`submission:${submittedAt}:${id}`, JSON.stringify(record));
		} catch (e) {
			console.error('KV write failed', e);
		}
	}

	if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL || !env.FROM_EMAIL) {
		console.error('Missing Resend env vars');
		return json({ ok: false, error: 'Email delivery is not configured yet.' }, 500);
	}

	const subject = `New inquiry from ${name} — Catamaran For Sale`;
	const textBody =
		`New inquiry submitted ${submittedAt}\n\n` +
		`Name:    ${name}\n` +
		`Email:   ${email}\n` +
		`Phone:   ${phone || '—'}\n\n` +
		`Message:\n${message}\n`;
	const htmlBody =
		`<p><strong>New inquiry submitted ${escapeHtml(submittedAt)}</strong></p>` +
		`<p><strong>Name:</strong> ${escapeHtml(name)}<br>` +
		`<strong>Email:</strong> <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a><br>` +
		`<strong>Phone:</strong> ${escapeHtml(phone || '—')}</p>` +
		`<p><strong>Message:</strong></p>` +
		`<p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`;

	try {
		const resp = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: {
				'authorization': `Bearer ${env.RESEND_API_KEY}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify({
				from: `Tropicalia Inquiries <${env.FROM_EMAIL}>`,
				to: env.NOTIFY_EMAIL.split(',').map((addr) => addr.trim()).filter(Boolean),
				reply_to: email,
				subject,
				text: textBody,
				html: htmlBody,
			}),
		});

		if (!resp.ok) {
			const err = await resp.text().catch(() => '');
			console.error('Resend send failed', resp.status, err);
			return json(
				{ ok: false, error: 'We could not deliver your message. Please try again shortly.' },
				500,
			);
		}
	} catch (e) {
		console.error('Resend fetch threw', e);
		return json(
			{ ok: false, error: 'We could not deliver your message. Please try again shortly.' },
			500,
		);
	}

	return json({ ok: true });
};

// Reject anything other than POST with a JSON 405
export const onRequest: PagesFunction = () =>
	json({ ok: false, error: 'Method not allowed' }, 405);
