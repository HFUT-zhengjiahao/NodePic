import { loadAllCanvasNodes } from '@/lib/canvas-store';
import type { CanvasTaskData } from '@/lib/canvas-types';
import type { Edge, Node } from '@xyflow/react';

/** localStorage key shared by the canvas view and the pages that must reason about its files. */
export const CANVAS_HINT_KEY = 'gptImageCanvasHintDismissed';

export type StoredCanvas = {
    nodes?: Array<Node<CanvasTaskData>>;
    edges?: Edge[];
};

/**
 * Every image file the canvas still depends on: each node's own results plus the source pictures of
 * edit nodes. Deleting one of these behind the canvas' back leaves a node that can never run again.
 */
export function collectCanvasFilenames(canvas?: StoredCanvas | null): Set<string> {
    const filenames = new Set<string>();
    // No explicit canvas means "everything the user has": every canvas, not just the open one — a file
    // used by a canvas that happens not to be on screen must never be treated as an orphan.
    const sources = canvas ? [canvas] : [{ nodes: loadAllCanvasNodes() }];
    for (const source of sources) {
        for (const node of source?.nodes ?? []) {
            node.data?.images?.forEach((image) => image?.filename && filenames.add(image.filename));
            node.data?.sourceFilenames?.forEach((filename) => filename && filenames.add(filename));
        }
    }
    return filenames;
}

/** Which of the given files would break a canvas node if they disappeared. */
export function findCanvasReferences(filenames: string[]): string[] {
    const referenced = collectCanvasFilenames();
    return filenames.filter((filename) => referenced.has(filename));
}

/**
 * Reference counts for many files at once.
 *
 * Counting one file at a time re-read and re-parsed every canvas for every filename, so a
 * 40-picture history entry meant 40 full passes over localStorage before its warning could be
 * built. One pass now answers for all of them.
 */
export function countCanvasReferencesFor(filenames: readonly string[]): Map<string, number> {
    const counts = new Map<string, number>(filenames.map((filename) => [filename, 0]));
    for (const node of loadAllCanvasNodes()) {
        const touched = new Set<string>();
        node.data?.sourceFilenames?.forEach((filename) => {
            if (filename && counts.has(filename)) touched.add(filename);
        });
        node.data?.images?.forEach((image) => {
            if (image?.filename && counts.has(image.filename)) touched.add(image.filename);
        });
        // A node that both produced a file and uses it as a source still counts once.
        for (const filename of touched) counts.set(filename, (counts.get(filename) ?? 0) + 1);
    }
    return counts;
}
