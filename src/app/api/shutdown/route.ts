import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Only requests that reach this server through a loopback host may stop it. */
function isLocalRequest(request: NextRequest): boolean {
    const host = request.headers.get('host') ?? '';
    return /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/i.test(host) || /^(localhost|127\.0\.0\.1)/i.test(host);
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
