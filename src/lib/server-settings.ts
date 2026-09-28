import { constants as fsConstants } from 'fs';
import fs from 'fs/promises';
import path from 'path';

export type ServerSettings = {
    /** Where generated and uploaded pictures are written. Relative paths resolve from the project root. */
    outputDir: string;
    /** How many days a deleted picture stays in the trash before it is purged. */
    trashRetentionDays: number;
    /**
     * The user's own provider key, typed into the settings panel.
     *
     * This is what makes the project usable by anyone who clones it: the key lives in
     * `.playground-settings.json`, which is gitignored, instead of being baked into the source. An
     * empty value falls back to `OPENAI_API_KEY`, so an existing `.env.local` setup keeps working.
     */
    openaiApiKey: string;
    /**
     * Endpoint that key belongs to — a relay such as PackyAPI (`https://cf.api.fan/v1`), or the
     * official API when left empty.
     */
    openaiBaseUrl: string;
};

export const DEFAULT_OUTPUT_DIR_NAME = 'generated-images';

const projectRoot = process.cwd();
const settingsFile = path.join(projectRoot, '.playground-settings.json');

const DEFAULTS: ServerSettings = {
    outputDir: DEFAULT_OUTPUT_DIR_NAME,
    trashRetentionDays: 30,
    openaiApiKey: '',
    openaiBaseUrl: ''
};

let cached: ServerSettings | null = null;
/** mtime of the file `cached` was read from, so a hand edit outside the app is picked up. */
let cachedMtimeMs = 0;

/** Absolute path of the folder pictures live in. */
export function resolveOutputDir(dir: string): string {
    return path.isAbsolute(dir) ? dir : path.join(projectRoot, dir);
}

/** Trailing slashes would turn `/v1` into `/v1//images/generations` in the SDK's URL joining. */
function normalizeBaseUrl(value: unknown): string {
    return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

/**
 * The key that will actually be used: the one saved in the panel, otherwise the environment.
 *
 * Exported because both the settings panel (to report whether a key is configured) and the image
 * route (to call the provider) have to answer that question the same way.
 */
export function effectiveApiKey(settings: ServerSettings): string {
    return settings.openaiApiKey.trim() || process.env.OPENAI_API_KEY?.trim() || '';
}

/** The endpoint that key belongs to, or undefined to let the SDK use its own default. */
export function effectiveBaseUrl(settings: ServerSettings): string | undefined {
    return normalizeBaseUrl(settings.openaiBaseUrl) || process.env.OPENAI_API_BASE_URL?.trim() || undefined;
}

function parseSettings(raw: string): ServerSettings {
    const parsed = JSON.parse(raw) as Partial<ServerSettings>;
    return {
        outputDir:
            typeof parsed.outputDir === 'string' && parsed.outputDir.trim() ? parsed.outputDir : DEFAULTS.outputDir,
        trashRetentionDays:
            typeof parsed.trashRetentionDays === 'number' && parsed.trashRetentionDays > 0
                ? Math.floor(parsed.trashRetentionDays)
                : DEFAULTS.trashRetentionDays,
        openaiApiKey: typeof parsed.openaiApiKey === 'string' ? parsed.openaiApiKey.trim() : DEFAULTS.openaiApiKey,
        openaiBaseUrl: normalizeBaseUrl(parsed.openaiBaseUrl)
    };
}

export async function readServerSettings(): Promise<ServerSettings> {
    // One stat per call keeps the cache honest: editing .playground-settings.json by hand (or a
    // restore from backup) used to be ignored until the server was restarted.
    try {
        const stat = await fs.stat(settingsFile);
        if (cached && stat.mtimeMs === cachedMtimeMs) return cached;
        cached = parseSettings(await fs.readFile(settingsFile, 'utf8'));
        cachedMtimeMs = stat.mtimeMs;
        return cached;
    } catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
        if (code !== 'ENOENT') {
            console.warn('Could not read .playground-settings.json — using defaults:', error);
        }
        cached = { ...DEFAULTS };
        cachedMtimeMs = 0;
        return cached;
    }
}

export async function writeServerSettings(patch: Partial<ServerSettings>): Promise<ServerSettings> {
    const current = await readServerSettings();
    const next: ServerSettings = {
        outputDir:
            typeof patch.outputDir === 'string' && patch.outputDir.trim() ? patch.outputDir.trim() : current.outputDir,
        trashRetentionDays:
            typeof patch.trashRetentionDays === 'number' && patch.trashRetentionDays > 0
                ? Math.floor(patch.trashRetentionDays)
                : current.trashRetentionDays,
        // An empty string is meaningful here ("forget the key"), so it is not treated as "unchanged"
        // the way an empty folder path is.
        openaiApiKey: typeof patch.openaiApiKey === 'string' ? patch.openaiApiKey.trim() : current.openaiApiKey,
        openaiBaseUrl:
            typeof patch.openaiBaseUrl === 'string' ? normalizeBaseUrl(patch.openaiBaseUrl) : current.openaiBaseUrl
    };
    await fs.writeFile(settingsFile, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    const stat = await fs.stat(settingsFile).catch(() => null);
    cached = next;
    cachedMtimeMs = stat?.mtimeMs ?? 0;
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
