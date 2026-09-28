import Dexie, { type EntityTable } from 'dexie';

export interface ImageRecord {
    filename: string;
    blob: Blob;
}

/**
 * A painted mask, owned by the *picture* it was painted for — not by the node that happens to use it.
 *
 * The key is `${canvasId}:${sourceFilename}`. Both halves matter:
 *
 *  * the filename half is what makes a mask follow its picture. Deleting a node and undoing it,
 *    clearing a board and rebuilding it, or re-running an upstream node no longer moves a mask onto a
 *    picture it was not painted for: the lookup key simply changes and the mask stops applying. A
 *    file name is safe as an identity here because this app never rewrites a picture in place — a
 *    changed image always gets a new name (the same invariant the immutable cache header relies on).
 *  * the canvas half keeps two boards that legitimately share a source picture (a duplicated canvas,
 *    an imported file) from overwriting each other's masks.
 *
 * See `src/lib/mask-store.ts` for the helpers and the one-time migration.
 */
export interface MaskRecord {
    /** `${canvasId}:${sourceFilename}` — build it with `maskKey()`, never by hand. */
    key: string;
    blob: Blob;
    /** The mask's own file name, shown in the node badge. Display only. */
    filename: string;
    updatedAt: number;
}

/**
 * Rows of the original `masks` table, which was keyed by node id.
 *
 * Kept purely as a migration source: a store's primary key cannot be changed in place, and doing it
 * the "proper" way would have dropped every mask the user had already painted. `migrateLegacyMasks()`
 * moves these into `masksV2` and empties the table; nothing writes to it any more.
 */
export interface LegacyMaskRecord {
    nodeId: string;
    blob: Blob;
    filename: string;
    updatedAt: number;
}

export class ImageDB extends Dexie {
    images!: EntityTable<ImageRecord, 'filename'>;
    masks!: EntityTable<LegacyMaskRecord, 'nodeId'>;
    masksV2!: EntityTable<MaskRecord, 'key'>;

    constructor() {
        super('ImageDB');

        this.version(1).stores({
            images: '&filename'
        });

        this.version(2).stores({
            images: '&filename',
            masks: '&nodeId'
        });

        // Masks are keyed by the picture they were painted for. The old store stays declared so the
        // migration can still read its rows.
        this.version(3).stores({
            images: '&filename',
            masks: '&nodeId',
            masksV2: '&key'
        });

        this.images = this.table('images');
        this.masks = this.table('masks');
        this.masksV2 = this.table('masksV2');
    }
}

export const db = new ImageDB();
