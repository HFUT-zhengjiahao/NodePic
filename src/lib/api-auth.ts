import crypto from 'crypto';

export function sha256(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}

export type AuthFailure = { error: string; status: number };

/**
 * Cookie that carries the password hash on requests that cannot have a body.
 *
 * `<img src>` and `<a href>` cannot send a body or a custom header, so the two GET endpoints that
 * serve and list pictures would have been either unguarded or forced to put the hash in the query
 * string (browser history, Referer, access logs). The browser already holds the hash; unlocking
 * once makes every later image request authenticate itself.
 */
export const AUTH_COOKIE = 'gpt_image_playground_auth';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function authCookieOptions(maxAge: number = COOKIE_MAX_AGE_SECONDS) {
    return {
        httpOnly: true,
        sameSite: 'lax' as const,
        path: '/',
        maxAge,
        // The playground is served over plain http on localhost / the LAN.
        secure: false
    };
}

/** Reads the auth cookie out of a request. Returns null when it is absent. */
export function readAuthCookie(request: Request): string | null {
    const header = request.headers.get('cookie');
    if (!header) return null;
    for (const part of header.split(';')) {
        const separator = part.indexOf('=');
        if (separator < 0) continue;
        if (part.slice(0, separator).trim() === AUTH_COOKIE) {
            try {
                return decodeURIComponent(part.slice(separator + 1).trim());
            } catch {
                return null;
            }
        }
    }
    return null;
}

/**
 * Compares two hex digests without letting the answer depend on how much of them matched.
 *
 * The shared secret here is a 64-character hash, and `!==` would give an attacker who can time the
 * response a byte-at-a-time oracle against it. `timingSafeEqual` refuses buffers of different
 * lengths, so the length is checked first — that only ever leaks a length both sides already have.
 */
function hashesEqual(candidate: string, expected: string): boolean {
    const left = Buffer.from(candidate, 'utf8');
    const right = Buffer.from(expected, 'utf8');
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

/**
 * Single place that decides whether a request may touch the server's files or settings.
 *
 * Every write endpoint used to carry its own copy of this check, and `/api/settings` simply did not
 * have one — so with APP_PASSWORD set, anyone reaching the port could move the whole gallery to an
 * arbitrary path. Keeping the rule here makes "did we forget to guard this route?" answerable by
 * grepping for `checkPassword`.
 *
 * When APP_PASSWORD is unset the server stays open, which is the intended behaviour for a local
 * single-user instance.
 */
export function checkPassword(candidate: unknown): AuthFailure | null {
    const configured = process.env.APP_PASSWORD;
    if (!configured) return null;

    const expected = sha256(configured);
    if (typeof candidate !== 'string' || candidate.length === 0) {
        return { error: 'Unauthorized: Missing password hash.', status: 401 };
    }
    if (!hashesEqual(candidate, expected)) {
        return { error: 'Unauthorized: Invalid password.', status: 401 };
    }
    return null;
}

/*
 * Worth stating plainly: the hash is the bearer token. The browser keeps it in localStorage and sends
 * it with every write, so anything that can read that storage — an XSS, a malicious extension — can
 * act as the user for as long as the server is up. That is an accepted trade-off for a single-user
 * server bound to localhost or the LAN: it is what lets `<img src>` authenticate itself without
 * putting the hash in a URL. Anything exposed to the wider internet wants a real session instead.
 */
