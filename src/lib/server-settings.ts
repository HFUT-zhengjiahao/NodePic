import { constants as fsConstants } from 'fs';
import fs from 'fs/promises';
import path from 'path';

export type ServerSettings = {
    /** Where generated and uploaded pictures are written. Relative paths resolve from the project root. */
    outputDir: string;
    /** How many days a deleted picture stays in the trash before it is purged. */
    trashRetentionDays: number;
};

export const DEFAULT_OUTPUT_DIR_NAME = 'generated-images';

const projectRoot = process.cwd();
const settingsFile = path.join(projectRoot, '.playground-settings.json');

const DEFAULTS: ServerSettings = {
    outputDir: DEFAULT_OUTPUT_DIR_NAME,
    trashRetentionDays: 30
};

let cached: ServerSettings | null = null;

/** Absolute path of the folder pictures live in. */
export function resolveOutputDir(dir: string): string {
    return path.isAbsolute(dir) ? dir : path.join(projectRoot, dir);
}

export async function readServerSettings(): Promise<ServerSettings> {
    if (cached) return cached;
    try {
        const raw = await fs.readFile(settingsFile, 'utf8');
        const parsed = JSON.parse(raw) as Partial<ServerSettings>;
        cached = {
            outputDir: typeof parsed.outputDir === 'string' && parsed.outputDir.trim() ? parsed.outputDir : DEFAULTS.outputDir,
            trashRetentionDays:
                typeof parsed.trashRetentionDays === 'number' && parsed.trashRetentionDays > 0
                    ? Math.floor(parsed.trashRetentionDays)
                    : DEFAULTS.trashRetentionDays
        };
    } catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
        if (code !== 'ENOENT') {
            console.warn('Could not read .playground-settings.json — using defaults:', error);
        }
        cached = { ...DEFAULTS };
    }
    return cached;
}

export async function writeServerSettings(patch: Partial<ServerSettings>): Promise<ServerSettings> {
    const current = await readServerSettings();
    const next: ServerSettings = {
        outputDir:
            typeof patch.outputDir === 'string' && patch.outputDir.trim() ? patch.outputDir.trim() : current.outputDir,
        trashRetentionDays:
            typeof patch.trashRetentionDays === 'number' && patch.trashRetentionDays > 0
                ? Math.floor(patch.trashRetentionDays)
                : current.trashRetentionDays
    };
    await fs.writeFile(settingsFile, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    cached = next;
    return next;
}

/** Absolute output directory, creating it when missing. */
export async function ensureOutputDir(): Promise<string> {
    const { outputDir } = await readServerSettings();
    const absolute = resolveOutputDir(outputDir);
    await fs.mkdir(absolute, { recursive: true });
    return absolute;
}

/** Absolute output directory without touching the filesystem. */
export async function getOutputDir(): Promise<string> {
    const { outputDir } = await readServerSettings();
    return resolveOutputDir(outputDir);
}

/**
 * Points the playground at another folder, optionally carrying the existing pictures over.
 *
 * The canvas only ever stores filenames, so moving the files keeps every node working — no client
 * state has to change.
 */
export async function changeOutputDir(
    nextDir: string,
    moveExisting: boolean
): Promise<{ moved: number; failed: number; outputDir: string }> {
    const { outputDir: previous } = await readServerSettings();
    const from = resolveOutputDir(previous);
    const to = resolveOutputDir(nextDir);

    if (from === to) {
        await ensureOutputDir();
        return { moved: 0, failed: 0, outputDir: nextDir };
    }

    await fs.mkdir(to, { recursive: true });

    let moved = 0;
    let failed = 0;
    if (moveExisting) {
        let entries: string[] = [];
        try {
            entries = await fs.readdir(from);
        } catch {
            entries = [];
        }
        for (const entry of entries) {
            if (entry === '.trash') continue; // the trash stays with its own folder
            const source = path.join(from, entry);
            const target = path.join(to, entry);

            // POSIX rename() silently replaces the destination and never reports EEXIST (that is the
            // Windows behaviour), so the collision has to be detected up front. Losing the target's
            // index.json would orphan every picture next to it.
            try {
                await fs.stat(target);
                failed += 1;
                console.warn(`Skipped ${entry}: ${to} already has a file with that name.`);
                continue;
            } catch {
                // Target does not exist — safe to move.
            }

            try {
                const stat = await fs.stat(source);
                if (!stat.isFile()) continue;
                await fs.rename(source, target);
                moved += 1;
            } catch (error) {
                const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
                if (code === 'EXDEV') {
                    try {
                        // COPYFILE_EXCL keeps the same "never overwrite" promise across filesystems.
                        await fs.copyFile(source, target, fsConstants.COPYFILE_EXCL);
                        await fs.unlink(source);
                        moved += 1;
                        continue;
                    } catch (copyError) {
                        console.error(`Could not move ${entry}:`, copyError);
                    }
                } else {
                    console.error(`Could not move ${entry}:`, error);
                }
                failed += 1;
            }
        }
    }

    await writeServerSettings({ outputDir: nextDir });
    return { moved, failed, outputDir: nextDir };
}
