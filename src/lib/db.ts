import Dexie, { type EntityTable } from 'dexie';

export interface ImageRecord {
    filename: string;
    blob: Blob;
}

/** A painted mask, kept per canvas node so it survives a page reload. */
export interface MaskRecord {
    nodeId: string;
    blob: Blob;
    filename: string;
    updatedAt: number;
}

export class ImageDB extends Dexie {
    images!: EntityTable<ImageRecord, 'filename'>;
    masks!: EntityTable<MaskRecord, 'nodeId'>;

    constructor() {
        super('ImageDB');

        this.version(1).stores({
            images: '&filename'
        });

        this.version(2).stores({
            images: '&filename',
            masks: '&nodeId'
        });

        this.images = this.table('images');
        this.masks = this.table('masks');
    }
}

export const db = new ImageDB();
