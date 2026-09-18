import crypto from 'crypto';
import fs from 'fs/promises';
import { registerImages } from '@/lib/image-index';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

const outputDir = path.resolve(process.cwd(), 'generated-images');

const MAX_UPLOAD_BYTES = Number(process.env.IMAGE_UPLOAD_MAX_MB ?? 25) * 1024 * 1024;
const ALLOWED_TYPES: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp'
};

function sha256(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Stores a locally picked picture next to the generated ones.
 *
 * Uploads go through the same registry as generated images, so they take part in the file lifecycle
 * (never treated as garbage while a canvas node references them, and removable by the cleanup
 * action once nothing does). Keeping them server-side also means an edit request can fetch them
 * from /api/image/<filename> exactly like a generated picture.
 */
export async function POST(request: NextRequest) {
    let formData: FormData;
    try {
        formData = await request.formData();
    } catch {
        return NextResponse.json({ error: 'Expected a multipart form body.' }, { status: 400 });
    }

    if (process.env.APP_PASSWORD) {
        const serverPasswordHash = sha256(process.env.APP_PASSWORD);
        const clientPasswordHash = formData.get('passwordHash');
        if (typeof clientPasswordHash !== 'string' || clientPasswordHash !== serverPasswordHash) {
            return NextResponse.json({ error: 'Unauthorized: Invalid or missing password.' }, { status: 401 });
        }
    }

    const uploads = formData.getAll('file').filter((entry): entry is File => entry instanceof File);
    if (uploads.length === 0) {
        return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }

    const stored: Array<{ filename: string; path: string; bytes: number; originalName: string }> = [];

    try {
        await fs.mkdir(outputDir, { recursive: true });
    } catch (error) {
        console.error('Could not create the image directory:', error);
        return NextResponse.json({ error: 'Storage is unavailable.' }, { status: 500 });
    }

    for (const file of uploads) {
        const extension = ALLOWED_TYPES[file.type];
        if (!extension) {
            return NextResponse.json(
                { error: `Unsupported image type: ${file.type || 'unknown'}. Use PNG, JPEG or WebP.` },
                { status: 415 }
            );
        }
        if (file.size > MAX_UPLOAD_BYTES) {
            return NextResponse.json(
                { error: `Image is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` },
                { status: 413 }
            );
        }

        const filename = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
        const buffer = Buffer.from(await file.arrayBuffer());
        try {
            await fs.writeFile(path.join(outputDir, filename), buffer);
        } catch (error) {
            console.error(`Failed to store upload ${filename}:`, error);
            return NextResponse.json({ error: 'Failed to store the uploaded image.' }, { status: 500 });
        }

        stored.push({ filename, path: `/api/image/${filename}`, bytes: buffer.length, originalName: file.name });
    }

    await registerImages(stored.map((entry) => ({ filename: entry.filename, bytes: entry.bytes }))).catch((error) =>
        console.error('Failed to register uploads in the image index:', error)
    );

    console.log(`Stored ${stored.length} uploaded image(s): ${stored.map((entry) => entry.filename).join(', ')}`);

    return NextResponse.json({ ok: true, files: stored });
}
