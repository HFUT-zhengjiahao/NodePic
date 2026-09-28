import { checkPassword } from '@/lib/api-auth';
import { INDEX_FILENAME } from '@/lib/image-index';
import { getOutputDir } from '@/lib/server-settings';
import fs from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

/** Most files one request may ask about — a guard against a runaway body, not a real limit. */
const MAX_FILENAMES = 2000;
/** How many `stat`s run at once; opening thousands at once is slower than doing them in batches. */
const STAT_CONCURRENCY = 32;

type ExistsRequestBody = {
    filenames?: string[];
    passwordHash?: string;
};

/** A name that could point outside the output directory is answered with "missing", never stat'ed. */
function isSafeFilename(name: string): boolean {
    return name.length > 0 && !name.includes('/') && !name.includes('\\') && !name.startsWith('.') && name !== INDEX_FILENAME;
}

/**
 * Answers "which of these pictures are gone?" in one round trip.
 *
 * The board used to ask the same question one `HEAD /api/image/<filename>` at a time, serially: a
 * canvas holding fifty pictures meant fifty requests before it could warn about a single missing
 * source, and every keystroke that changed the wiring started the whole walk again.
 *
 * Only the missing names come back — the caller already knows the ones it asked about.
 */
export async function POST(request: NextRequest) {
    let body: ExistsRequestBody;
    try {
        body = (await request.json()) as ExistsRequestBody;
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    const authFailure = checkPassword(body.passwordHash);
    if (authFailure) {
        return NextResponse.json({ error: authFailure.error }, { status: authFailure.status });
    }

    if (!Array.isArray(body.filenames)) {
        return NextResponse.json({ error: 'Missing required field: filenames (string[]).' }, { status: 400 });
    }

    const requested = [...new Set(body.filenames.filter((name): name is string => typeof name === 'string'))];
    if (requested.length === 0) {
        return NextResponse.json({ missing: [] as string[] });
    }
    if (requested.length > MAX_FILENAMES) {
        return NextResponse.json(
            { error: `Too many filenames — at most ${MAX_FILENAMES} per request.` },
            { status: 400 }
        );
    }

    const dir = await getOutputDir();
    const missing: string[] = [];

    for (let offset = 0; offset < requested.length; offset += STAT_CONCURRENCY) {
        const batch = requested.slice(offset, offset + STAT_CONCURRENCY);
        await Promise.all(
            batch.map(async (name) => {
                if (!isSafeFilename(name)) {
                    missing.push(name);
                    return;
                }
                try {
                    const stat = await fs.stat(path.join(dir, name));
                    if (!stat.isFile()) missing.push(name);
                } catch {
                    missing.push(name);
                }
            })
        );
    }

    return NextResponse.json({ missing });
}
