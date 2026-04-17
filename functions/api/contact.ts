// Cloudflare Pages Function — POST /api/contact
// Receives the contact form, validates, stores in KV, and forwards via MailChannels.

interface Env {
	CONTACT_SUBMISSIONS?: KVNamespace;
	NOTIFY_EMAIL: string;
	FROM_EMAIL: string;
	DOMAIN: string;
}

interface ContactBody {
	name?: string;
	email?: string;
	phone?: string;
	message?: string;
	website?: string; // honeypot — real users leave this blank
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

	// Best-effort KV archive (set up the KV binding once; until then this no-ops)
	if (env.CONTACT_SUBMISSIONS) {
		try {
			await env.CONTACT_SUBMISSIONS.put(`submission:${submittedAt}:${id}`, JSON.stringify(record));
		} catch (e) {
			// KV failure shouldn't block the email send
			console.error('KV write failed', e);
		}
	}

	// Send the notification via MailChannels. Requires SPF + DKIM + _mailchannels
	// TXT records on the sending domain; those are configured in CF DNS (see README).
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

	const mcResp = await fetch('https://api.mailchannels.net/tx/v1/send', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			personalizations: [{ to: [{ email: env.NOTIFY_EMAIL }] }],
			from: { email: env.FROM_EMAIL, name: 'Tropicalia Inquiries' },
			reply_to: { email, name },
			subject,
			content: [
				{ type: 'text/plain', value: textBody },
				{ type: 'text/html', value: htmlBody },
			],
		}),
	});

	if (!mcResp.ok) {
		const err = await mcResp.text();
		console.error('MailChannels send failed', mcResp.status, err);
		return json(
			{ ok: false, error: 'We could not deliver your message. Please try again or check back later.' },
			502,
		);
	}

	return json({ ok: true });
};

// Reject anything other than POST
export const onRequest: PagesFunction = () =>
	json({ ok: false, error: 'Method not allowed' }, 405);
