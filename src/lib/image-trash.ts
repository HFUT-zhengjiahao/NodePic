import { getOutputDir } from '@/lib/server-settings';
import fs from 'fs/promises';
import path from 'path';

/** How long a deleted picture stays recoverable (overridable from the settings page). */
export const TRASH_RETENTION_DAYS = 30;

async function trashPaths(): Promise<{ dir: string; trash: string }> {
    const dir = await getOutputDir();
    return { dir, trash: path.join(dir, '.trash') };
}

/**
 * Moves a generated picture into `generated-images/.trash/<date>/` instead of unlinking it.
 *
 * Deleting a file is the one operation that cannot be undone, and it is easy to trigger by mistake
 * (a wrong keep-list, a mis-click on a cleanup dialog). Renaming into a dated folder costs nothing —
 * same volume, instant — and turns "gone forever" into "move it back".
 *
 * The folder is inside `generated-images/`, so it is never served: /api/image/<filename> rejects any
 * name containing a slash, and the registry scan skips directories.
 */
export async function trashImage(filename: string): Promise<{ bytes: number; trashedTo: string }> {
    const { dir, trash } = await trashPaths();
    const source = path.join(dir, filename);
    const stat = await fs.stat(source);

    const day = new Date().toISOString().slice(0, 10);
    const targetDir = path.join(trash, day);
    await fs.mkdir(targetDir, { recursive: true });

    const target = path.join(targetDir, filename);
    try {
        await fs.rename(source, target);
    } catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
        if (code !== 'EXDEV') throw error;
        // Different filesystem: copy then remove, so a failure never loses the original.
        await fs.copyFile(source, target);
        await fs.unlink(source);
    }

    return { bytes: stat.size, trashedTo: path.relative(dir, target) };
}

/** Drops trash folders older than the retention window. Returns how many files went away for good. */
export async function purgeOldTrash(): Promise<number> {
    const { trash } = await trashPaths();
    let days: string[];
    try {
        days = await fs.readdir(trash);
    } catch {
        return 0; // no trash yet
    }

    const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    let removed = 0;

    for (const day of days) {
        const folder = path.join(trash, day);
        const timestamp = Date.parse(day);
        if (Number.isNaN(timestamp) || timestamp >= cutoff) continue;

        try {
            const entries = await fs.readdir(folder);
            for (const entry of entries) {
                await fs.rm(path.join(folder, entry), { force: true });
                removed += 1;
            }
            await fs.rm(folder, { recursive: true, force: true });
        } catch (error) {
            console.warn(`Could not purge trash folder ${day}:`, error);
        }
    }

    if (removed > 0) {
        console.log(`Purged ${removed} file(s) older than ${TRASH_RETENTION_DAYS} days from the trash.`);
    }
    return removed;
}

/** Absolute trash folder for the current output directory. */
export async function getTrashDir(): Promise<string> {
    const { trash } = await trashPaths();
    return trash;
}
