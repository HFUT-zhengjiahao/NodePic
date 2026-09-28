import { parseCanvasImport, sanitizeCanvasNode } from '@/lib/canvas-serialize';
import { DEFAULT_TASK_PARAMS } from '@/lib/canvas-types';
import { describe, expect, it } from 'vitest';

/** A node record as the board writes it, with the fields the renderer actually reads. */
const goodNode = {
    id: 'n1',
    type: 'task',
    position: { x: 10, y: 20 },
    data: {
        kind: 'edit',
        prompt: 'a cat',
        params: { ...DEFAULT_TASK_PARAMS },
        sourceFilenames: ['a.png'],
        maskFileName: null,
        images: [{ filename: 'b.png', path: '/api/image/b.png' }],
        status: 'idle',
        error: null,
        durationMs: null,
        usage: null,
        costDetails: null,
        createdAt: 1
    }
};

describe('sanitizeCanvasNode', () => {
    it('keeps a well-formed record as it is', () => {
        const node = sanitizeCanvasNode(goodNode);
        expect(node?.id).toBe('n1');
        expect(node?.position).toEqual({ x: 10, y: 20 });
        expect(node?.data.images).toHaveLength(1);
    });

    it('drops records the renderer could not draw at all', () => {
        expect(sanitizeCanvasNode(null)).toBeNull();
        expect(sanitizeCanvasNode('nope')).toBeNull();
        expect(sanitizeCanvasNode({})).toBeNull();
        expect(sanitizeCanvasNode({ id: 'n1' })).toBeNull();
        expect(sanitizeCanvasNode({ id: 'n1', data: { images: 'nope', sourceFilenames: [] } })).toBeNull();
    });

    it('drops picture entries without a filename instead of rendering them', () => {
        const node = sanitizeCanvasNode({
            ...goodNode,
            data: { ...goodNode.data, images: [null, {}, { filename: 'c.png' }, { filename: '' }] }
        });
        expect(node?.data.images).toEqual([{ filename: 'c.png', path: '/api/image/c.png' }]);
    });

    it('fills in the path of a picture that predates it', () => {
        const node = sanitizeCanvasNode({
            ...goodNode,
            data: { ...goodNode.data, images: [{ filename: 'd.png' }] }
        });
        expect(node?.data.images[0].path).toBe('/api/image/d.png');
    });

    it('keeps only real filenames among the sources', () => {
        const node = sanitizeCanvasNode({
            ...goodNode,
            data: { ...goodNode.data, sourceFilenames: ['a.png', null, 3, ''] }
        });
        expect(node?.data.sourceFilenames).toEqual(['a.png']);
    });

    it('parks a node with an unusable position at the origin rather than off-canvas', () => {
        expect(sanitizeCanvasNode({ ...goodNode, position: { x: NaN, y: 20 } })?.position).toEqual({ x: 0, y: 0 });
        expect(sanitizeCanvasNode({ ...goodNode, position: undefined })?.position).toEqual({ x: 0, y: 0 });
    });

    it('falls back to a generate node when the kind is unknown', () => {
        expect(sanitizeCanvasNode({ ...goodNode, data: { ...goodNode.data, kind: 'wat' } })?.data.kind).toBe('generate');
    });

    it('never brings a node back mid-run', () => {
        expect(sanitizeCanvasNode({ ...goodNode, data: { ...goodNode.data, status: 'running' } })?.data.status).toBe(
            'idle'
        );
        expect(sanitizeCanvasNode({ ...goodNode, data: { ...goodNode.data, status: 'queued' } })?.data.status).toBe(
            'idle'
        );
    });

    it('fills in parameters that did not exist when the file was written', () => {
        const node = sanitizeCanvasNode({ ...goodNode, data: { ...goodNode.data, params: { model: 'gpt-image-2' } } });
        expect(node?.data.params.model).toBe('gpt-image-2');
        expect(node?.data.params.outputFormat).toBe(DEFAULT_TASK_PARAMS.outputFormat);
    });
});

describe('parseCanvasImport', () => {
    const file = (nodes: unknown[]) => JSON.stringify({ kind: 'gpt-image-playground-canvas', nodes });

    it('rejects anything that is not a canvas export', () => {
        expect(parseCanvasImport('not json')).toBeNull();
        expect(parseCanvasImport('{"nodes":{}}')).toBeNull();
        expect(parseCanvasImport(file([]).replace('gpt-image-playground-canvas', 'something-else'))).toBeNull();
    });

    it('keeps the first node of each id', () => {
        const nodes = parseCanvasImport(file([goodNode, { ...goodNode, images: [] }]));
        expect(nodes).toHaveLength(1);
        expect(nodes?.[0].data.images).toHaveLength(1);
    });

    it('stops at a size no one drew by hand', () => {
        const many = Array.from({ length: 2100 }, (_, index) => ({ ...goodNode, id: `n${index}` }));
        expect(parseCanvasImport(file(many))).toHaveLength(2000);
    });

    it('accepts a bare node list with no `kind` marker', () => {
        expect(parseCanvasImport(JSON.stringify({ nodes: [goodNode] }))).toHaveLength(1);
    });
});
