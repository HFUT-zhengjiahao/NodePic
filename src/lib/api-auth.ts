import crypto from 'crypto';

export function sha256(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}

export type AuthFailure = { error: string; status: number };

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
    if (candidate !== expected) {
        return { error: 'Unauthorized: Invalid password.', status: 401 };
    }
    return null;
}
