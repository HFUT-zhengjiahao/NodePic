import { AUTH_COOKIE, authCookieOptions, checkPassword } from '@/lib/api-auth';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
    const appPasswordSet = !!process.env.APP_PASSWORD;
    return NextResponse.json({ passwordRequired: appPasswordSet });
}

/**
 * Establishes (or clears) the auth cookie.
 *
 * The browser keeps the password hash so the user only types it once. GET requests cannot carry a
 * body, so the image endpoints read the cookie instead — this is the call that hands it out. An
 * empty hash clears it, which is what "forget the password" needs.
 */
export async function POST(request: NextRequest) {
    let body: { passwordHash?: string | null } = {};
    try {
        body = (await request.json()) as { passwordHash?: string | null };
    } catch {
        // An empty body means "no password stored", which is valid when APP_PASSWORD is unset.
    }

    const hash = typeof body.passwordHash === 'string' && body.passwordHash.length > 0 ? body.passwordHash : null;
    const authFailure = checkPassword(hash);
    if (authFailure) {
        return NextResponse.json({ error: authFailure.error }, { status: authFailure.status });
    }

    const response = NextResponse.json({ ok: true, passwordRequired: !!process.env.APP_PASSWORD });
    if (hash) {
        response.cookies.set(AUTH_COOKIE, hash, authCookieOptions());
    } else {
        response.cookies.set(AUTH_COOKIE, '', authCookieOptions(0));
    }
    return response;
}
