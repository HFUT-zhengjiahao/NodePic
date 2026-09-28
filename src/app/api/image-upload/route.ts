import fs from 'fs/promises';
import { checkPassword } from '@/lib/api-auth';
import { registerImages } from '@/lib/image-index';
import { ensureOutputDir } from '@/lib/server-settings';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';



// A non-numeric value here used to make every comparison below false, i.e. no limit at all.
const CONFIGURED_MAX_MB = Number(process.env.IMAGE_UPLOAD_MAX_MB ?? 25);
const MAX_UPLOAD_MB = Number.isFinite(CONFIGURED_MAX_MB) && CONFIGURED_MAX_MB > 0 ? CONFIGURED_MAX_MB : 25;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const ALLOWED_TYPES: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp'
};

/**
 * Identifies the picture from its bytes.
 *
 * `file.type` is whatever the browser (or whatever client) claimed, so trusting it let any payload
 * be stored under an image extension and served back as one.
 */
function sniffImageType(buffer: Buffer): string | null {
    if (
        buffer.length >= 8 &&
        buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) {
        return 'image/png';
    }
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return 'image/jpeg';
    }
    if (
        buffer.length >= 12 &&
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
        return 'image/webp';
    }
    return null;
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

    const authFailure = checkPassword(formData.get('passwordHash'));
    if (authFailure) {
        return NextResponse.json({ error: authFailure.error }, { status: authFailure.status });
    }

    const uploads = formData.getAll('file').filter((entry): entry is File => entry instanceof File);
    if (uploads.length === 0) {
        return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }

    const stored: Array<{ filename: string; path: string; bytes: number; originalName: string }> = [];

    let outputDir: string;
    try {
        outputDir = await ensureOutputDir();
    } catch (error) {
        console.error('Could not create the image directory:', error);
        return NextResponse.json({ error: 'Storage is unavailable.' }, { status: 500 });
    }

    // Validation happens for the whole batch before anything is written: rejecting the third file
    // after storing the first two used to leave those files on disk with no registry entry and no way
    // to reference them, i.e. invisible litter that cleanup refused to touch.
    const prepared: Array<{ file: File; buffer: Buffer; extension: string }> = [];
    for (const file of uploads) {
        // Read the bytes up front — the sniff needs them, and a File is not guaranteed to be
        // readable twice.
        const buffer = Buffer.from(await file.arrayBuffer());
        const sniffed = sniffImageType(buffer);
        const extension = sniffed ? ALLOWED_TYPES[sniffed] : undefined;
        if (!extension) {
            return NextResponse.json(
                { error: `Unsupported image type: ${sniffed ?? (file.type || 'unknown')}. Use PNG, JPEG or WebP.` },
                { status: 415 }
            );
        }
        if (buffer.byteLength > MAX_UPLOAD_BYTES) {
            return NextResponse.json({ error: `Image is larger than ${MAX_UPLOAD_MB} MB.` }, { status: 413 });
        }
        prepared.push({ file, buffer, extension });
    }

    for (const { file, buffer, extension } of prepared) {
        const filename = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
        try {
            await fs.writeFile(path.join(outputDir, filename), buffer);
        } catch (error) {
            console.error(`Failed to store upload ${filename}:`, error);
            // Roll the batch back so a partial failure leaves nothing behind.
            await Promise.allSettled(stored.map((entry) => fs.rm(path.join(outputDir, entry.filename), { force: true })));
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
