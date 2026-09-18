import { checkPassword } from '@/lib/api-auth';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Only requests that reach this server through a loopback host may stop it.
 *
 * The Host header is attacker-controlled, so this is a hint rather than a guarantee: `localhost.evil.com`
 * used to pass the (unanchored) second pattern. Set APP_PASSWORD to make the check meaningful, or bind
 * the dev server to 127.0.0.1 — see NOTES.local.md for the trade-off with LAN access.
 */
function isLocalRequest(request: NextRequest): boolean {
    const host = (request.headers.get('host') ?? '').toLowerCase();
    const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/**
 * Stops the local Next.js dev server that serves this playground.
 *
 * The response is sent first and the process is stopped right after, so the browser always receives
 * a clean answer even though the server disappears a moment later.
 */
export async function POST(request: NextRequest) {
    if (!isLocalRequest(request)) {
        return NextResponse.json({ error: 'Shutdown is only allowed from localhost.' }, { status: 403 });
    }

    let body: { passwordHash?: string } = {};
    try {
        body = (await request.json()) as { passwordHash?: string };
    } catch {
        // An empty body is fine while no password is configured.
    }
    const authFailure = checkPassword(body.passwordHash);
    if (authFailure) {
        return NextResponse.json({ error: authFailure.error }, { status: authFailure.status });
    }

    console.log('Shutdown requested from the UI — stopping the dev server.');

    setTimeout(() => {
        try {
            process.kill(process.pid, 'SIGTERM');
        } catch {
            // Fall through to the hard exit below if the signal cannot be delivered.
        }
        // Safety net: exit even if SIGTERM is swallowed by a signal handler.
        setTimeout(() => process.exit(0), 1500);
    }, 300);

    return NextResponse.json({ ok: true, message: 'Server is shutting down.' });
}

export async function GET() {
    return NextResponse.json({ error: 'Use POST to stop the server.' }, { status: 405 });
}
