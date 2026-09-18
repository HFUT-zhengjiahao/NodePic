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
        await fs.access(filepath);

        const fileBuffer = await fs.readFile(filepath);

        const contentType = lookup(filename) || 'application/octet-stream';

        return new NextResponse(fileBuffer, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Content-Length': fileBuffer.length.toString()
            }
        });
    } catch (error: unknown) {
        console.error(`Error serving image ${filename}:`, error);
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
            return NextResponse.json({ error: 'Image not found' }, { status: 404 });
        }
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
