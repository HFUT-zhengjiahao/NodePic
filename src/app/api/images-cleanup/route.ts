import crypto from 'crypto';
import fs from 'fs/promises';
import { withIndexLock } from '@/lib/image-index';
import { purgeOldTrash, trashImage, TRASH_RETENTION_DAYS } from '@/lib/image-trash';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

const outputDir = path.resolve(process.cwd(), 'generated-images');

/** Files younger than this are never deleted: they may belong to a request that is still running. */
const MIN_AGE_MS = Number(process.env.IMAGE_CLEANUP_MIN_AGE_MINUTES ?? 10) * 60 * 1000;

function sha256(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}

type CleanupRequestBody = {
    /** Filenames that must survive. Must not be empty — an empty list is almost always a bug. */
    keep: string[];
    /** When true nothing is deleted; the response only reports what would go. */
    dryRun?: boolean;
    passwordHash?: string;
};

/**
 * Deletes generated images that the server registered but nothing references any more.
 *
 * Safety rules, in order:
 *  1. `keep` must be a non-empty array — "delete everything" is never a valid request.
 *  2. Only files present in generated-images/index.json are candidates; unknown files are reported
 *     as `untracked` and left untouched.
 *  3. Files modified within MIN_AGE_MS are skipped (`skippedRecent`), which covers both a freshly
 *     generated picture whose history entry has not been written yet, and a slow in-flight request.
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
    if (keep.size === 0) {
        // Guards against a wiped browser profile turning cleanup into "delete my whole gallery".
        return NextResponse.json(
            {
                error:
                    'Refusing to clean up with an empty keep list. The browser reported no referenced images, which usually means its storage was cleared.'
            },
            { status: 400 }
        );
    }

    const dryRun = body.dryRun === true;
    const now = Date.now();

    let entries: string[];
    try {
        entries = await fs.readdir(outputDir);
    } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
            return NextResponse.json({ ok: true, deleted: 0, freedBytes: 0, deletedFiles: [], skippedRecent: [], untracked: [], dryRun });
        }
        console.error('Failed to read the image directory:', error);
        return NextResponse.json({ error: 'Failed to read the image directory.' }, { status: 500 });
    }

    try {
        const outcome = await withIndexLock(async (index) => {
            const deletedFiles: string[] = [];
            const skippedRecent: string[] = [];
            const untracked: string[] = [];
            let freedBytes = 0;
            let dirty = false;

            for (const name of entries) {
                if (name === 'index.json' || keep.has(name)) continue;

                const filepath = path.join(outputDir, name);
                let stat;
                try {
                    stat = await fs.stat(filepath);
                } catch {
                    // Deleted between readdir and stat.
                    continue;
                }
                if (!stat.isFile()) continue;

                if (!index.files[name]) {
                    untracked.push(name);
                    continue;
                }

                if (now - stat.mtimeMs < MIN_AGE_MS) {
                    skippedRecent.push(name);
                    continue;
                }

                if (!dryRun) {
                    try {
                        await trashImage(name);
                    } catch (error) {
                        console.error(`Could not move orphaned image ${name} to the trash:`, error);
                        continue;
                    }
                    delete index.files[name];
                    dirty = true;
                }

                deletedFiles.push(name);
                freedBytes += stat.size;
            }

            return {
                result: { deletedFiles, skippedRecent, untracked, freedBytes },
                dirty: dirty && !dryRun
            };
        });

        const purged = dryRun ? 0 : await purgeOldTrash();

        console.log(
            `Image cleanup (${dryRun ? 'dry run' : 'applied'}): ${outcome.deletedFiles.length} deletable, ` +
                `${outcome.skippedRecent.length} too recent, ${outcome.untracked.length} untracked, ${purged} purged.`
        );

        return NextResponse.json({
            ok: true,
            dryRun,
            deleted: outcome.deletedFiles.length,
            deletedFiles: outcome.deletedFiles,
            skippedRecent: outcome.skippedRecent,
            untracked: outcome.untracked,
            freedBytes: outcome.freedBytes,
            kept: keep.size,
            minAgeMinutes: MIN_AGE_MS / 60000,
            trashRetentionDays: TRASH_RETENTION_DAYS
        });
    } catch (error) {
        console.error('Image cleanup failed:', error);
        return NextResponse.json({ error: 'Image cleanup failed.' }, { status: 500 });
    }
}
