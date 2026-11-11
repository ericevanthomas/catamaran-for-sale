// Authenticating as a GitHub App, so that adding a client needs no new
// credential.
//
// ⚠️ THIS FILE IS IDENTICAL IN ALL THREE REPOS — electromagneticweb,
// rp-launch and rp-site-kit. Nothing in it is tenant-shaped: WHICH repository
// to dispatch at comes from the GITHUB_REPO var, and WHICH installation covers
// that repository is looked up at run time. Diff the three before trusting any
// of them. On 2026-10-30 publisher/src/index.ts was copied into the kit
// carrying EMW's database binding, and every tick threw for twelve days with
// nobody watching, which is the whole argument for keeping the shared parts
// byte-identical and commenting every real difference.
//
// ── why an app and not a PAT (2026-11-11) ──────────────────────────────────
// The first version of this pipeline fired `repository_dispatch` with a
// fine-grained personal access token per Worker: one per repository, each tied
// to Eric's personal account, each with an expiry, each mintable only by hand
// in GitHub's UI. At twenty clients that is twenty credentials to create and
// twenty expiries to remember, and the first rotation anybody forgets stops a
// client's edits reaching their site silently. Eric chose an app instead, on
// the day the second PAT was due.
//
// One app, one private key, installed per repository with a click. Every
// Worker holds the SAME key and mints its own installation token, scoped to its
// own repository and good for an hour. Adding a client needs NO new credential:
// install the app on the repo and the Worker works.
//
//   1. sign a JWT as the app            RS256, iss = app id, 9 minutes
//   2. GET /repos/{owner}/{repo}/installation      which installation covers it
//   3. POST /app/installations/{id}/access_tokens  an hour-long token
//   4. POST /repos/{owner}/{repo}/dispatches       with that token (index.ts)
//
// ⚠️ Step 2 is the step that makes provisioning credential-free, and it is the
// one most likely to be "simplified" away. An installation id in config is a
// per-client value, which is exactly the thing an app was adopted to delete.
// The repository already knows which installation covers it, so ask it.
//
// ── ⚠️ PKCS#1 vs PKCS#8 ────────────────────────────────────────────────────
// GitHub hands you `BEGIN RSA PRIVATE KEY`, which is PKCS#1. WebCrypto's
// importKey accepts PKCS#8 only (`BEGIN PRIVATE KEY`) and fails with a bare
// "InvalidAccessError" / "Data provided to an operation does not meet
// requirements" that says nothing about why. So the key is converted once,
// before it is ever put in a secret:
//
//   openssl pkcs8 -topk8 -nocrypt -in <downloaded>.pem -out <downloaded>-pkcs8.pem
//
// and if a PKCS#1 key reaches this code anyway, it says so in those words and
// gives that command, rather than costing somebody an hour.
//
// Nothing here ever logs or returns key material or a minted token. The only
// things that come back out are an installation id, an expiry and a reason.

export interface GhAppEnv {
  GH_APP_ID?: string;          // plain var in wrangler.toml — not sensitive
  GH_APP_PRIVATE_KEY?: string; // Worker secret — the app's PKCS#8 private key
  GITHUB_REPO?: string;        // owner/repo — committed, not secret
}

/**
 * Which half broke. Named rather than free text so that `/status` and the
 * shadow note can both say the same thing about the same failure, and so a
 * reader can tell "not installed on this repo" (a click to fix) from "the key
 * is the wrong format" (a conversion to fix) without parsing prose.
 */
export type GhFailureKind =
  | 'no-app-id'
  | 'no-key'
  | 'no-repo'
  | 'key-pkcs1'
  | 'key-encrypted'
  | 'key-unrecognised'
  | 'key-rejected'
  | 'jwt-refused'
  | 'not-installed'
  | 'lookup-failed'
  | 'exchange-refused';

export type GhAuth =
  | { ok: true; token: string; expires_at: string; installation_id: number; cached: boolean }
  | { ok: false; kind: GhFailureKind; detail: string };

// ── the windows ────────────────────────────────────────────────────────────
// GitHub caps an app JWT at 10 minutes and recommends backdating `iat` by a
// minute for clock skew between us and them. 9 minutes leaves room for both.
const JWT_LIFETIME_SECONDS = 9 * 60;
const CLOCK_SKEW_SECONDS = 60;

// An installation token lasts an hour. Refresh when a quarter of it is left
// rather than when a request fails: on a 5-minute cron the alternative is
// discovering the token died during the one tick that had something to post,
// and a dispatch that is a minute late is a client edit that is a tick late.
const REFRESH_WHEN_UNDER_SECONDS = 15 * 60;

// The installation id only changes if the app is uninstalled and reinstalled,
// so it does not need looking up every hour. It is dropped the moment a token
// exchange says it no longer exists, which is the case that would otherwise
// wedge for twelve hours.
const INSTALLATION_TTL_SECONDS = 12 * 60 * 60;

const UA = 'rp-publisher/1';
const API = 'https://api.github.com';

// What the app is called in GitHub's UI, for the one message somebody will read
// before they know what any of this is. A label only: GH_APP_ID is the truth,
// and both appear in that message so a renamed app does not mislead anybody.
const APP_LABEL = '"Remodeler Pilot Publisher"';

// ── in-memory cache ────────────────────────────────────────────────────────
// Module scope, so it lives as long as the isolate and is shared by the cron,
// /tick and /status. It is deliberately not Cache API or KV: a short-lived
// credential belongs in memory, and an isolate that is recycled simply mints
// another one. Keyed by app id and repo (both public facts), never by anything
// derived from the key.
type TokenEntry = { token: string; expiresAtMs: number; installationId: number };
let tokenCache: { key: string; entry: TokenEntry } | null = null;
let installationCache: { key: string; id: number; atMs: number } | null = null;
let keyCache: { pem: string; key: CryptoKey } | null = null;

/** For tests and for proving the early-refresh path. Not used in production. */
export function resetGhAppCache(): void {
  tokenCache = null;
  installationCache = null;
  keyCache = null;
}

/**
 * What is missing before any of this can be attempted, in one phrase fit to
 * drop into a sentence. Null when the credential is complete.
 *
 * `decide()` uses this instead of testing the vars itself, so that the words a
 * live tick refuses with and the words a shadow tick warns with cannot drift
 * apart.
 */
export function appCredentialGap(env: GhAppEnv): string | null {
  if (!env.GH_APP_ID) return 'GH_APP_ID is not set';
  if (!env.GH_APP_PRIVATE_KEY) return 'GH_APP_PRIVATE_KEY is not set';
  return null;
}

const b64url = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64urlText = (text: string): string =>
  b64url(new TextEncoder().encode(text));

/**
 * PEM armour off, DER bytes out — and a straight answer when the key is the
 * wrong kind.
 *
 * Exported because this is the part that can be proved on a laptop against a
 * locally generated key, without the real one existing.
 *
 * It hands back a plain ArrayBuffer rather than a view: WebCrypto takes either,
 * and a view's type carries an ArrayBufferLike that TypeScript 5.7 and later
 * will not accept as a BufferSource without a cast nobody should have to read.
 */
export function pkcs8Der(
  pem: string,
): { ok: true; der: ArrayBuffer } | { ok: false; kind: GhFailureKind; detail: string } {
  // A secret pasted through a shell or a .dev.vars line arrives with literal
  // backslash-n instead of newlines. Harmless to fix, and the alternative is a
  // base64 error that reads like a corrupt key.
  const text = pem.replace(/\\n/g, '\n').trim();

  if (/BEGIN RSA PRIVATE KEY/.test(text)) {
    return {
      ok: false,
      kind: 'key-pkcs1',
      detail:
        'GH_APP_PRIVATE_KEY is a PKCS#1 key (it begins "BEGIN RSA PRIVATE KEY"). ' +
        'WebCrypto can only import PKCS#8 ("BEGIN PRIVATE KEY"), which is why GitHub\'s ' +
        'downloaded .pem has to be converted once before it goes in the secret: ' +
        'openssl pkcs8 -topk8 -nocrypt -in <downloaded>.pem -out <downloaded>-pkcs8.pem ' +
        '— then put the converted file in with: npx wrangler secret put GH_APP_PRIVATE_KEY',
    };
  }
  if (/BEGIN ENCRYPTED PRIVATE KEY/.test(text)) {
    return {
      ok: false,
      kind: 'key-encrypted',
      detail:
        'GH_APP_PRIVATE_KEY is passphrase-encrypted ("BEGIN ENCRYPTED PRIVATE KEY") and this ' +
        'Worker has no passphrase to give it. Convert it unencrypted: ' +
        'openssl pkcs8 -topk8 -nocrypt -in <downloaded>.pem -out <downloaded>-pkcs8.pem',
    };
  }

  const armoured = text.match(/-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/);
  // A key whose armour someone stripped is still usable; a key that is neither
  // armoured nor base64 is not, and saying which is cheaper than guessing.
  const body = armoured ? armoured[1] : text;
  const base64 = body.replace(/\s+/g, '');
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return {
      ok: false,
      kind: 'key-unrecognised',
      detail:
        'GH_APP_PRIVATE_KEY is not a PEM private key. Expected a PKCS#8 file beginning ' +
        '"-----BEGIN PRIVATE KEY-----", as produced by: ' +
        'openssl pkcs8 -topk8 -nocrypt -in <downloaded>.pem -out <downloaded>-pkcs8.pem',
    };
  }

  try {
    const raw = atob(base64);
    const der = new ArrayBuffer(raw.length);
    const bytes = new Uint8Array(der);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    // A PKCS#8 RSA key is an ASN.1 SEQUENCE (first byte 0x30) of well over a
    // kilobyte. Any short string of letters is valid base64 once whitespace is
    // stripped, so without this a typo in the secret would reach importKey and
    // come back as "WebCrypto refused it", which sends the reader looking at
    // the wrong thing.
    if (bytes.length < 100 || bytes[0] !== 0x30) {
      return {
        ok: false,
        kind: 'key-unrecognised',
        detail:
          'GH_APP_PRIVATE_KEY decodes to ' + bytes.length + ' bytes that are not a DER private key. ' +
          'Expected the whole PKCS#8 PEM file, armour and all, as produced by: ' +
          'openssl pkcs8 -topk8 -nocrypt -in <downloaded>.pem -out <downloaded>-pkcs8.pem',
      };
    }
    return { ok: true, der };
  } catch {
    return {
      ok: false,
      kind: 'key-unrecognised',
      detail:
        'GH_APP_PRIVATE_KEY is armoured like a PEM file but its body is not valid base64 — ' +
        'it was probably truncated or re-wrapped on the way into the secret. Put the file in ' +
        'again whole: npx wrangler secret put GH_APP_PRIVATE_KEY',
    };
  }
}

/**
 * The imported signing key, cached by the PEM it came from so that a rotated
 * secret is picked up without anything being restarted.
 */
export async function importAppKey(
  pem: string,
): Promise<{ ok: true; key: CryptoKey } | { ok: false; kind: GhFailureKind; detail: string }> {
  if (keyCache && keyCache.pem === pem) return { ok: true, key: keyCache.key };

  const parsed = pkcs8Der(pem);
  if (!parsed.ok) return parsed;

  try {
    const key = await crypto.subtle.importKey(
      'pkcs8',
      parsed.der,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    keyCache = { pem, key };
    return { ok: true, key };
  } catch (e) {
    return {
      ok: false,
      kind: 'key-rejected',
      detail:
        'GH_APP_PRIVATE_KEY decoded but WebCrypto refused to import it as a PKCS#8 RSA key ' +
        `(${String(e).slice(0, 120)}). If it came straight from GitHub it is PKCS#1 and needs ` +
        'converting: openssl pkcs8 -topk8 -nocrypt -in <downloaded>.pem -out <downloaded>-pkcs8.pem',
    };
  }
}

/**
 * A JWT signed as the app. `iss` is the app id and nothing else is claimed:
 * this token's only job is to ask GitHub which installation covers a repository
 * and to swap that for an installation token.
 *
 * Exported so its shape and claims can be checked without the real key.
 */
export async function appJwt(appId: string, key: CryptoKey, nowMs = Date.now()): Promise<string> {
  const now = Math.floor(nowMs / 1000);
  const header = b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64urlText(
    JSON.stringify({
      // Backdated by a minute, per GitHub's own advice: their clock and ours
      // disagree by a second or two and a JWT issued "in the future" is
      // refused outright.
      iat: now - CLOCK_SKEW_SECONDS,
      exp: now + JWT_LIFETIME_SECONDS,
      iss: appId,
    }),
  );
  const signed = `${header}.${payload}`;
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signed),
  );
  return `${signed}.${b64url(new Uint8Array(sig))}`;
}

const ghHeaders = (bearer: string) => ({
  authorization: `Bearer ${bearer}`,
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  // GitHub rejects an API request with no User-Agent.
  'user-agent': UA,
});

/**
 * Which installation covers this repository — asked of the repository itself,
 * which is what makes a new client need no configuration.
 */
async function lookupInstallation(
  repo: string,
  jwt: string,
  appId: string,
): Promise<{ ok: true; id: number } | { ok: false; kind: GhFailureKind; detail: string }> {
  let r: Response;
  try {
    r = await fetch(`${API}/repos/${repo}/installation`, {
      headers: ghHeaders(jwt),
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    return {
      ok: false,
      kind: 'lookup-failed',
      detail: `could not reach GitHub to ask which installation covers ${repo}: ${String(e).slice(0, 120)}`,
    };
  }

  if (r.status === 404) {
    return {
      ok: false,
      kind: 'not-installed',
      detail:
        `the ${APP_LABEL} app (id ${appId}) is not installed on ${repo} ` +
        `(GET /repos/${repo}/installation → 404). This is a click, not a code change: GitHub → ` +
        'Settings → Developer settings → GitHub Apps → the app → Install App → the account → ' +
        `Only select repositories → ${repo}. No secret changes and no deploy — the Worker picks it ` +
        'up on the next tick.',
    };
  }
  if (r.status === 401) {
    return {
      ok: false,
      kind: 'jwt-refused',
      detail:
        `GitHub refused the app JWT (401) asking which installation covers ${repo}. ` +
        `GH_APP_ID (${appId}) and GH_APP_PRIVATE_KEY are probably not from the same app, or that ` +
        'key has been deleted in the app settings. Generate a key on the app, convert it with ' +
        'openssl pkcs8 -topk8 -nocrypt, and put it in again.',
    };
  }
  if (!r.ok) {
    const body = (await r.text()).slice(0, 160);
    return {
      ok: false,
      kind: 'lookup-failed',
      detail: `GET /repos/${repo}/installation → HTTP ${r.status} ${body}`,
    };
  }

  const d = (await r.json()) as { id?: number };
  if (typeof d?.id !== 'number') {
    return {
      ok: false,
      kind: 'lookup-failed',
      detail: `GET /repos/${repo}/installation answered 200 with no installation id`,
    };
  }
  return { ok: true, id: d.id };
}

/**
 * Swap the app JWT for an installation token.
 *
 * ⚠️ The body NARROWS the token on purpose. An installation made against "All
 * repositories" would otherwise mint a token good for every repository on the
 * account, handed to one client's Worker — the same account-wide-credential
 * mistake that keeps a Cloudflare D1 token out of CI (PROVISIONING.md, row 12).
 * Asking for one repository and `contents: write` means the worst a leaked
 * token can do is start one client's build.
 */
async function exchange(
  repo: string,
  installationId: number,
  jwt: string,
): Promise<
  | { ok: true; token: string; expires_at: string }
  | { ok: false; kind: GhFailureKind; detail: string }
> {
  const name = repo.split('/')[1] || repo;
  let r: Response;
  try {
    r = await fetch(`${API}/app/installations/${installationId}/access_tokens`, {
      method: 'POST',
      headers: { ...ghHeaders(jwt), 'content-type': 'application/json' },
      body: JSON.stringify({ repositories: [name], permissions: { contents: 'write' } }),
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    return {
      ok: false,
      kind: 'exchange-refused',
      detail: `could not reach GitHub to mint an installation token: ${String(e).slice(0, 120)}`,
    };
  }

  if (r.status === 404) {
    // The installation id we had is gone: the app was uninstalled, or
    // reinstalled with a new id. Drop it so the next attempt looks it up again
    // rather than retrying a dead id for twelve hours.
    installationCache = null;
    return {
      ok: false,
      kind: 'not-installed',
      detail:
        `installation ${installationId} no longer exists (404 on the token exchange) — the app was ` +
        `uninstalled or reinstalled on ${repo}. The next tick looks the installation up again.`,
    };
  }
  if (!r.ok) {
    const body = (await r.text()).slice(0, 200);
    return {
      ok: false,
      kind: 'exchange-refused',
      detail:
        `POST /app/installations/${installationId}/access_tokens → HTTP ${r.status} ${body}. ` +
        (r.status === 422
          ? `The installation on ${repo} probably does not grant Contents: Read and write, which is the ` +
            'narrowest permission GitHub accepts for POST /repos/{owner}/{repo}/dispatches. Add it on the ' +
            'app and accept the new permission on the installation.'
          : 'Nothing was posted.'),
    };
  }

  const d = (await r.json()) as { token?: string; expires_at?: string };
  if (!d?.token) {
    return { ok: false, kind: 'exchange-refused', detail: 'the token exchange answered 201 with no token' };
  }
  return { ok: true, token: d.token, expires_at: d.expires_at || new Date(Date.now() + 3600_000).toISOString() };
}

/**
 * An installation token for GITHUB_REPO, from cache when there is usefully
 * long left on it.
 *
 * Every failure is named and carries what to do about it, because this is the
 * one part of the pipeline that could not be tested before the app existed:
 * the first person to see it fail will be reading the note, not the code.
 */
export async function installationToken(env: GhAppEnv, nowMs = Date.now()): Promise<GhAuth> {
  const appId = env.GH_APP_ID || '';
  const pem = env.GH_APP_PRIVATE_KEY || '';
  const repo = env.GITHUB_REPO || '';

  if (!appId) {
    return {
      ok: false,
      kind: 'no-app-id',
      detail:
        'GH_APP_ID is not set. It is the numeric id on the app\'s settings page in GitHub, it is not ' +
        'sensitive, and it belongs in publisher/wrangler.toml under [vars].',
    };
  }
  if (!pem) {
    return {
      ok: false,
      kind: 'no-key',
      detail:
        'GH_APP_PRIVATE_KEY is not set. Generate a private key on the app, convert it with ' +
        'openssl pkcs8 -topk8 -nocrypt, then: cd publisher && npx wrangler secret put GH_APP_PRIVATE_KEY',
    };
  }
  if (!repo) {
    return { ok: false, kind: 'no-repo', detail: 'GITHUB_REPO is not set — there is no repository to authenticate against' };
  }

  const cacheKey = `${appId}|${repo}`;
  const cached = tokenCache && tokenCache.key === cacheKey ? tokenCache.entry : null;
  if (cached && cached.expiresAtMs - nowMs > REFRESH_WHEN_UNDER_SECONDS * 1000) {
    return {
      ok: true,
      token: cached.token,
      expires_at: new Date(cached.expiresAtMs).toISOString(),
      installation_id: cached.installationId,
      cached: true,
    };
  }

  const imported = await importAppKey(pem);
  if (!imported.ok) return imported;
  const jwt = await appJwt(appId, imported.key, nowMs);

  let installationId: number;
  const known =
    installationCache &&
    installationCache.key === cacheKey &&
    nowMs - installationCache.atMs < INSTALLATION_TTL_SECONDS * 1000
      ? installationCache.id
      : null;
  if (known !== null) {
    installationId = known;
  } else {
    const found = await lookupInstallation(repo, jwt, appId);
    if (!found.ok) return found;
    installationId = found.id;
    installationCache = { key: cacheKey, id: installationId, atMs: nowMs };
  }

  const minted = await exchange(repo, installationId, jwt);
  if (!minted.ok) {
    // A stale id that the exchange has just rejected: look it up once more with
    // the JWT we already hold rather than making the client wait a tick.
    if (minted.kind === 'not-installed' && known !== null) {
      const again = await lookupInstallation(repo, jwt, appId);
      if (!again.ok) return again;
      installationCache = { key: cacheKey, id: again.id, atMs: nowMs };
      const retry = await exchange(repo, again.id, jwt);
      if (!retry.ok) return retry;
      const expiresAtMs = Date.parse(retry.expires_at);
      tokenCache = {
        key: cacheKey,
        entry: {
          token: retry.token,
          expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : nowMs + 3600_000,
          installationId: again.id,
        },
      };
      return { ok: true, token: retry.token, expires_at: retry.expires_at, installation_id: again.id, cached: false };
    }
    return minted;
  }

  const expiresAtMs = Date.parse(minted.expires_at);
  tokenCache = {
    key: cacheKey,
    entry: {
      token: minted.token,
      expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : nowMs + 3600_000,
      installationId,
    },
  };
  return { ok: true, token: minted.token, expires_at: minted.expires_at, installation_id: installationId, cached: false };
}

/**
 * The same thing /status reports: whether the app can authenticate, and which
 * half is wrong if it cannot. Never the token itself — an expiry and a reason
 * are what a person needs, and a key printed into a dashboard is a key that
 * has left the secret store.
 */
export async function appHealth(env: GhAppEnv): Promise<Record<string, unknown>> {
  const gap = appCredentialGap(env);
  const auth = await installationToken(env);
  return {
    app_id: env.GH_APP_ID || null,
    configured: !gap,
    gap,
    ok: auth.ok,
    failure: auth.ok ? null : auth.kind,
    detail: auth.ok ? null : auth.detail,
    installation_id: auth.ok ? auth.installation_id : null,
    token_expires_at: auth.ok ? auth.expires_at : null,
    token_from_cache: auth.ok ? auth.cached : null,
  };
}
