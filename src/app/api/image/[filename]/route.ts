import { INDEX_FILENAME } from '@/lib/image-index';
import fs from 'fs/promises';
import { lookup } from 'mime-types';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';



export async function GET(request: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
    const { filename } = await params;

    if (!filename) {
        return NextResponse.json({ error: 'Filename is required' }, { status: 400 });
    }

    // Only a bare file name is servable. Rejecting '/' is what stops `index.json` (the registry) and
    // `.trash/<date>/<file>` (deleted-but-recoverable pictures) from being fetched by URL.
    if (
        !filename ||
        filename === INDEX_FILENAME ||
        filename.startsWith('.') ||
        filename.includes('/') ||
        filename.includes('\\') ||
        filename.includes('..')
    ) {
        return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
    }

    // The folder is configurable, so it is resolved per request.
    const { getOutputDir } = await import('@/lib/server-settings');
    const dir = path.resolve(await getOutputDir());
    const filepath = path.resolve(dir, filename);
    // Belt and braces: even a name that slipped through the checks above must stay inside the folder.
    if (path.dirname(filepath) !== dir) {
        return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
    }

    try {
        const stat = await fs.stat(filepath);
        if (!stat.isFile()) {
            return NextResponse.json({ error: 'Image not found' }, { status: 404 });
        }

        const contentType = lookup(filename) || 'application/octet-stream';

        // File names embed the creation timestamp and are never rewritten in place, so a picture at a
        // given URL can never change: letting the browser keep it forever removes ~25 MB of re-download
        // per canvas reload and ~68 MB per visit to the history page.
        const headers: Record<string, string> = {
            'Content-Type': contentType,
            'Content-Length': stat.size.toString(),
            'Cache-Control': 'public, max-age=31536000, immutable',
            ETag: `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`,
            'Last-Modified': new Date(stat.mtimeMs).toUTCString()
        };

        const ifNoneMatch = request.headers.get('if-none-match');
        if (ifNoneMatch && ifNoneMatch === headers.ETag) {
            return new NextResponse(null, { status: 304, headers });
        }

        // Streamed instead of readFile: a 2–4 MB PNG should not be buffered in memory per request.
        const { createReadStream } = await import('fs');
        const stream = createReadStream(filepath);
        return new NextResponse(stream as unknown as ReadableStream, { status: 200, headers });
    } catch (error: unknown) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
            return NextResponse.json({ error: 'Image not found' }, { status: 404 });
        }
        console.error(`Error serving image ${filename}:`, error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
