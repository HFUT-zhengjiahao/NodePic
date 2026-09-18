import type { CanvasTaskData } from '@/lib/canvas-types';
import type { Edge, Node } from '@xyflow/react';

/** localStorage keys shared by the canvas view and the pages that must reason about its files. */
export const CANVAS_STORAGE_KEY = 'gptImageCanvas';
export const CANVAS_HINT_KEY = 'gptImageCanvasHintDismissed';
export const HISTORY_STORAGE_KEY = 'openaiImageHistory';

export type StoredCanvas = {
    nodes?: Array<Node<CanvasTaskData>>;
    edges?: Edge[];
};

export function readStoredCanvas(): StoredCanvas | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(CANVAS_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as StoredCanvas;
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
        console.warn('Could not read the stored canvas snapshot:', error);
        return null;
    }
}

/**
 * Every image file the canvas still depends on: each node's own results plus the source pictures of
 * edit nodes. Deleting one of these behind the canvas' back leaves a node that can never run again.
 */
export function collectCanvasFilenames(canvas: StoredCanvas | null = readStoredCanvas()): Set<string> {
    const filenames = new Set<string>();
    for (const node of canvas?.nodes ?? []) {
        node.data?.images?.forEach((image) => image?.filename && filenames.add(image.filename));
        node.data?.sourceFilenames?.forEach((filename) => filename && filenames.add(filename));
    }
    return filenames;
}

/** Which of the given files would break a canvas node if they disappeared. */
export function findCanvasReferences(filenames: string[]): string[] {
    const referenced = collectCanvasFilenames();
    return filenames.filter((filename) => referenced.has(filename));
}

/** How many canvas nodes depend on the given file. */
export function countCanvasReferences(filename: string): number {
    const canvas = readStoredCanvas();
    let count = 0;
    for (const node of canvas?.nodes ?? []) {
        const usedAsSource = node.data?.sourceFilenames?.includes(filename);
        const usedAsResult = node.data?.images?.some((image) => image.filename === filename);
        if (usedAsSource || usedAsResult) count += 1;
    }
    return count;
}
