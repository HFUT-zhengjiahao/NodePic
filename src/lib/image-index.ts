import { getOutputDir } from '@/lib/server-settings';
import fs from 'fs/promises';
import path from 'path';

export type ImageIndexEntry = {
    /** When the server wrote this file. */
    registeredAt: number;
    bytes: number;
};

export type ImageIndex = {
    version: 1;
    files: Record<string, ImageIndexEntry>;
};

/**
 * File names this application is capable of producing.
 *
 * The bootstrap below runs whenever index.json is missing or unreadable. Adopting *every* file in
 * the folder would mean that pointing the output directory at a folder full of personal pictures
 * (or losing the registry) turns those pictures into deletion candidates on the next cleanup —
 * "registered but unreferenced → trash". Restricting adoption to our own naming schemes keeps
 * foreign files permanently untouchable.
 */
const GENERATED_NAME = /^\d{13}-\d+\.(png|jpe?g|webp)$/i;
const UPLOADED_NAME = /^upload-[\w-]+\.(png|jpe?g|webp)$/i;
/** The registry itself and its temp file are never pictures. */
export const INDEX_FILENAME = 'index.json';

export function isOwnedFilename(name: string): boolean {
    return GENERATED_NAME.test(name) || UPLOADED_NAME.test(name);
}

/** Absolute folder + index path for the currently configured output directory. */
async function outputPaths(): Promise<{ dir: string; index: string }> {
    const dir = await getOutputDir();
    return { dir, index: path.join(dir, 'index.json') };
}

/**
 * The server keeps the authoritative list of images it produced.
 *
 * Cleanup used to be "delete everything the browser did not ask to keep", which happily wiped the
 * whole folder when localStorage was empty (fresh profile, private window, cleared storage) or when
 * a file had been written but not yet recorded in the client's history. Now a file is only ever a
 * deletion candidate if the server itself registered it — anything unknown is left alone.
 */

let writeQueue: Promise<unknown> = Promise.resolve();

/** Serialises index mutations so two concurrent generations cannot clobber each other's entry. */
function serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = writeQueue.then(task, task);
    writeQueue = run.catch(() => undefined);
    return run;
}

async function writeIndex(index: ImageIndex): Promise<void> {
    const { dir, index: indexFile } = await outputPaths();
    await fs.mkdir(dir, { recursive: true });
    // Atomic replace: a half-written index.json would send the next read down the bootstrap path.
    const tempFile = `${indexFile}.tmp`;
    await fs.writeFile(tempFile, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
    await fs.rename(tempFile, indexFile);
}

/**
 * Reads the registry, adopting whatever already sits on disk the first time it runs, so images
 * generated before the registry existed are never mistaken for garbage.
 */
async function readIndexUnlocked(): Promise<ImageIndex> {
    const { dir, index: indexFile } = await outputPaths();
    try {
        const raw = await fs.readFile(indexFile, 'utf8');
        const parsed = JSON.parse(raw) as ImageIndex;
        if (parsed && typeof parsed === 'object' && parsed.files && typeof parsed.files === 'object') {
            return { version: 1, files: parsed.files };
        }
        console.warn('Image index is malformed — rebuilding it from the files on disk.');
    } catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
        if (code !== 'ENOENT') {
            console.warn('Could not read the image index — rebuilding it from the files on disk:', error);
        }
    }

    const files: Record<string, ImageIndexEntry> = {};
    try {
        for (const name of await fs.readdir(dir)) {
            if (name === INDEX_FILENAME || !isOwnedFilename(name)) continue;
            try {
                const stat = await fs.stat(path.join(dir, name));
                if (stat.isFile()) {
                    files[name] = { registeredAt: stat.mtimeMs, bytes: stat.size };
                }
            } catch {
                // A file that vanished mid-scan is simply not registered.
            }
        }
    } catch {
        // No output directory yet: an empty index is the correct answer.
    }

    const bootstrapped: ImageIndex = { version: 1, files };
    await writeIndex(bootstrapped);
    console.log(
        `Image index bootstrapped: adopted ${Object.keys(files).length} file(s) matching this app's ` +
            'naming scheme; anything else in the folder stays unregistered and therefore undeletable.'
    );
    return bootstrapped;
}

export function registerImages(entries: Array<{ filename: string; bytes: number }>): Promise<void> {
    if (entries.length === 0) return Promise.resolve();
    return serialize(async () => {
        const index = await readIndexUnlocked();
        const now = Date.now();
        for (const entry of entries) {
            index.files[entry.filename] = { registeredAt: now, bytes: entry.bytes };
        }
        await writeIndex(index);
    });
}

export function unregisterImages(filenames: string[]): Promise<void> {
    if (filenames.length === 0) return Promise.resolve();
    return serialize(async () => {
        const index = await readIndexUnlocked();
        let changed = false;
        for (const filename of filenames) {
            if (index.files[filename]) {
                delete index.files[filename];
                changed = true;
            }
        }
        if (changed) await writeIndex(index);
    });
}

/** Runs `task` while holding the index lock, then persists whatever the task left behind. */
export function withIndexLock<T>(task: (index: ImageIndex) => Promise<{ result: T; dirty: boolean }>): Promise<T> {
    return serialize(async () => {
        const index = await readIndexUnlocked();
        const { result, dirty } = await task(index);
        if (dirty) await writeIndex(index);
        return result;
    });
}
