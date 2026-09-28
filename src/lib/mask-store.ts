import { loadCanvasNodes, loadRegistry } from '@/lib/canvas-store';
import { db, type LegacyMaskRecord, type MaskRecord } from '@/lib/db';

/**
 * Masks, addressed by the picture they were painted on.
 *
 * A mask is a PNG the size of one specific source picture, transparent wherever the model may
 * repaint. That makes it a property of *that picture*, and this module is the only place that decides
 * how one is found again:
 *
 *   key = `${canvasId}:${sourceFilename}`
 *
 * The previous scheme keyed masks by node id, which produced three failures that all looked like
 * separate bugs: undo could not bring a mask back (deleting a node deleted its mask, while the undo
 * stack only held nodes), a duplicated canvas shared its masks with the original (node ids are copied
 * verbatim), and a mask could end up applied to a different picture than the one it was painted on
 * (the target is `sourceFilenames[0]`, which a re-run or a "remove source" can change underneath it).
 * Keying by the picture fixes all three at once: the mask outlives the node, cannot leak across
 * boards, and simply stops matching when the picture it belongs to is no longer the one being edited.
 *
 * The cost of that choice is that masks are no longer dropped when a node disappears — they are held
 * until the picture is really gone (permanent canvas delete, permanent file delete), which is exactly
 * when nothing can use them again.
 */

/** The storage key of the mask painted on `sourceFilename` in `canvasId`. */
export function maskKey(canvasId: string, sourceFilename: string): string {
    return `${canvasId}:${sourceFilename}`;
}

/** Every stored mask, for the board's reactive lookup. Unreadable storage yields "no masks". */
export async function loadMasks(): Promise<MaskRecord[]> {
    try {
        return await db.masksV2.toArray();
    } catch (error) {
        console.warn('Could not read the stored masks:', error);
        return [];
    }
}

/** One mask by key. Returns null when there is none (or when IndexedDB is unavailable). */
export async function loadMaskRecord(key: string): Promise<MaskRecord | null> {
    try {
        return (await db.masksV2.get(key)) ?? null;
    } catch (error) {
        console.warn('Could not read the stored mask:', error);
        return null;
    }
}

/**
 * Stores (or clears, with `null`) one mask.
 *
 * Returns false instead of throwing so the caller can say "this will run without your mask" rather
 * than badging a node as masked and then sending a request without it.
 */
export async function saveMask(key: string, file: File | null): Promise<boolean> {
    try {
        if (file) {
            await db.masksV2.put({ key, blob: file, filename: file.name, updatedAt: Date.now() });
        } else {
            await db.masksV2.delete(key);
        }
        return true;
    } catch (error) {
        console.error('Could not persist the mask:', error);
        return false;
    }
}

/** Drops every mask of one canvas — used when the canvas is deleted for good. */
export async function deleteMasksForCanvas(canvasId: string): Promise<number> {
    const prefix = `${canvasId}:`;
    return deleteMasksWhere((key) => key.startsWith(prefix));
}

/** Drops the masks of pictures that no longer exist on disk, in every canvas. */
export async function deleteMasksForFilenames(filenames: readonly string[]): Promise<number> {
    if (filenames.length === 0) return 0;
    const suffixes = filenames.map((filename) => `:${filename}`);
    return deleteMasksWhere((key) => suffixes.some((suffix) => key.endsWith(suffix)));
}

/**
 * Deletes by predicate.
 *
 * The table holds one row per painted picture (tens, not thousands), so listing the keys is cheaper
 * than reasoning about prefix queries — and it keeps the match rule in one obvious place.
 */
async function deleteMasksWhere(matches: (key: string) => boolean): Promise<number> {
    try {
        const keys = (await db.masksV2.toCollection().primaryKeys()) as string[];
        const doomed = keys.filter((key) => typeof key === 'string' && matches(key));
        if (doomed.length > 0) await db.masksV2.bulkDelete(doomed);
        return doomed.length;
    } catch (error) {
        console.warn('Could not drop the stored masks:', error);
        return 0;
    }
}

/**
 * Moves masks written by the node-keyed scheme onto their pictures. Runs once per browser.
 *
 * A legacy row only knows its node id, so the owning canvas and the picture are recovered from the
 * stored canvases: the node's first source is what the mask was painted on (the same target the mask
 * dialog always used). A row whose node is gone cannot be attributed to any picture, so it is
 * dropped — it was already unreachable, since nothing looks masks up by node id any more.
 */
export async function migrateLegacyMasks(): Promise<{ migrated: number; dropped: number }> {
    if (typeof window === 'undefined') return { migrated: 0, dropped: 0 };

    let legacy: LegacyMaskRecord[];
    try {
        legacy = await db.masks.toArray();
    } catch (error) {
        console.warn('Could not read the legacy masks:', error);
        return { migrated: 0, dropped: 0 };
    }
    if (legacy.length === 0) return { migrated: 0, dropped: 0 };

    // nodeId -> the picture the mask was painted on, and the canvas that node lives in.
    const owners = new Map<string, { canvasId: string; filename: string }>();
    try {
        for (const canvas of loadRegistry().canvases) {
            for (const node of loadCanvasNodes(canvas.id)) {
                const filename = node.data?.sourceFilenames?.[0];
                if (filename) owners.set(node.id, { canvasId: canvas.id, filename });
            }
        }
    } catch (error) {
        console.warn('Could not map the legacy masks onto their pictures:', error);
        return { migrated: 0, dropped: 0 };
    }

    const rows: MaskRecord[] = [];
    let dropped = 0;
    for (const record of legacy) {
        const owner = owners.get(record.nodeId);
        if (!owner || !record.blob) {
            dropped += 1;
            continue;
        }
        rows.push({
            key: maskKey(owner.canvasId, owner.filename),
            blob: record.blob,
            filename: record.filename,
            updatedAt: record.updatedAt
        });
    }

    try {
        if (rows.length > 0) await db.masksV2.bulkPut(rows);
        // The legacy table is a migration source only; leaving resolved rows in it would let a second
        // run resurrect them under whatever the node points at by then.
        await db.masks.clear();
    } catch (error) {
        console.warn('Could not finish re-keying the stored masks:', error);
        return { migrated: 0, dropped: 0 };
    }

    console.log(
        `Re-keyed ${rows.length} mask(s) from their node onto their source picture` +
            (dropped > 0 ? `; dropped ${dropped} whose node no longer exists.` : '.')
    );
    return { migrated: rows.length, dropped };
}
