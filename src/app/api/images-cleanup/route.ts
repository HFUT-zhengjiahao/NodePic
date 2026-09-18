import crypto from 'crypto';
import fs from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

const outputDir = path.resolve(process.cwd(), 'generated-images');

function sha256(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}

type CleanupRequestBody = {
    /** Filenames that must survive — anything else in generated-images is considered garbage. */
    keep: string[];
    /** When true nothing is deleted; the response only reports what would go. */
    dryRun?: boolean;
    passwordHash?: string;
};

/**
 * Deletes generated images that nothing references any more.
 *
 * The browser owns the references (generation history + canvas nodes live in localStorage), so the
 * caller sends the surviving filenames and the server trims the rest of `generated-images/`.
 */
export async function POST(request: NextRequest) {
    let body: CleanupRequestBody;
    try {
        body = (await request.json()) as CleanupRequestBody;
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    if (process.env.APP_PASSWORD) {
        const serverPasswordHash = sha256(process.env.APP_PASSWORD);
        if (!body.passwordHash || body.passwordHash !== serverPasswordHash) {
            return NextResponse.json({ error: 'Unauthorized: Invalid or missing password.' }, { status: 401 });
        }
    }

    if (!Array.isArray(body.keep)) {
        return NextResponse.json({ error: 'Missing required field: keep (string[]).' }, { status: 400 });
    }

    const keep = new Set(body.keep.filter((name): name is string => typeof name === 'string' && name.length > 0));
    const dryRun = body.dryRun === true;

    let entries: string[];
    try {
        entries = await fs.readdir(outputDir);
    } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
            return NextResponse.json({ ok: true, deleted: 0, freedBytes: 0, deletedFiles: [], dryRun });
        }
        console.error('Failed to read the image directory:', error);
        return NextResponse.json({ error: 'Failed to read the image directory.' }, { status: 500 });
    }

    const deletedFiles: string[] = [];
    let freedBytes = 0;

    for (const name of entries) {
        if (keep.has(name)) continue;
        const filepath = path.join(outputDir, name);
        try {
            const stat = await fs.stat(filepath);
            if (!stat.isFile()) continue;
            if (!dryRun) {
                await fs.unlink(filepath);
            }
            deletedFiles.push(name);
            freedBytes += stat.size;
        } catch (error) {
            console.error(`Could not remove orphaned image ${name}:`, error);
        }
    }

    console.log(`Image cleanup (${dryRun ? 'dry run' : 'applied'}): ${deletedFiles.length} file(s), ${freedBytes} bytes.`);

    return NextResponse.json({
        ok: true,
        dryRun,
        deleted: deletedFiles.length,
        deletedFiles,
        freedBytes,
        kept: keep.size
    });
}
