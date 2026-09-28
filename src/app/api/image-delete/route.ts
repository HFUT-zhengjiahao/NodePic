import { checkPassword } from '@/lib/api-auth';
import { INDEX_FILENAME, unregisterImages } from '@/lib/image-index';
import { getOutputDir } from '@/lib/server-settings';
import { trashImage } from '@/lib/image-trash';
import fs from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';




type DeleteRequestBody = {
    filenames: string[];
    /**
     * `true` unlinks the files instead of moving them to `.trash/<date>/`.
     *
     * Only the recycle bin's "remove for good" uses it: every other path in the app deliberately
     * keeps a deleted picture recoverable for the retention window. Permanent deletion is what stops
     * a user who has decided a picture is worthless from leaving it on disk forever.
     */
    permanent?: boolean;
    passwordHash?: string;
};

type FileDeletionResult = {
    filename: string;
    success: boolean;
    bytes?: number;
    error?: string;
};

export async function POST(request: NextRequest) {
    console.log('Received POST request to /api/image-delete');

    let requestBody: DeleteRequestBody;
    try {
        // Clone the request to read the body for auth, then allow the original request to be read again
        const clonedRequest = request.clone();
        const tempBodyForAuth = await clonedRequest.json();

        const authFailure = checkPassword(tempBodyForAuth.passwordHash);
        if (authFailure) {
            console.error(`Delete request rejected: ${authFailure.error}`);
            return NextResponse.json({ error: authFailure.error }, { status: authFailure.status });
        }
        // Now read the original request body for processing
        requestBody = await request.json();
    } catch (e) {
        console.error('Error parsing request body for /api/image-delete:', e);
        return NextResponse.json({ error: 'Invalid request body: Must be JSON.' }, { status: 400 });
    }

    const { filenames, permanent } = requestBody;

    if (!Array.isArray(filenames) || filenames.some((fn) => typeof fn !== 'string')) {
        return NextResponse.json({ error: 'Invalid filenames: Must be an array of strings.' }, { status: 400 });
    }

    if (filenames.length === 0) {
        return NextResponse.json({ message: 'No filenames provided to delete.', results: [] }, { status: 200 });
    }

    const outputDir = await getOutputDir();
    const deletionResults: FileDeletionResult[] = [];

    let freedBytes = 0;

    for (const filename of filenames) {
        // `index.json` is the registry and `.trash` holds recoverable deletions: neither is a picture.
        if (
            !filename ||
            filename === INDEX_FILENAME ||
            filename.startsWith('.') ||
            filename.includes('..') ||
            filename.includes('/') ||
            filename.includes('\\')
        ) {
            console.warn(`Invalid filename for deletion: ${filename}`);
            deletionResults.push({ filename, success: false, error: 'Invalid filename format.' });
            continue;
        }

        const filepath = path.join(outputDir, filename);

        try {
            const size = await fs
                .stat(filepath)
                .then((stat) => stat.size)
                .catch(() => 0);

            if (permanent) {
                // Unlink, not trash: the caller has already told the user this cannot be undone.
                await fs.rm(filepath, { force: true });
                console.log(`Permanently deleted image: ${filename}`);
            } else {
                const { trashedTo } = await trashImage(filename);
                console.log(`Moved image to the trash: ${trashedTo}`);
            }
            freedBytes += size;
            deletionResults.push({ filename, success: true, bytes: size });
        } catch (error: unknown) {
            console.error(`Error deleting image ${filepath}:`, error);
            if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
                deletionResults.push({ filename, success: false, error: 'File not found.' });
            } else {
                deletionResults.push({ filename, success: false, error: 'Failed to delete file.' });
            }
        }
    }

    // Keep the server-side registry in step with the disk.
    const deleted = deletionResults.filter((result) => result.success).map((result) => result.filename);
    if (deleted.length > 0) {
        await unregisterImages(deleted).catch((error) => console.error('Failed to update the image index:', error));
    }

    const allSucceeded = deletionResults.every((r) => r.success);

    return NextResponse.json(
        {
            message: allSucceeded ? 'All files deleted successfully.' : 'Some files could not be deleted.',
            permanent: permanent === true,
            freedBytes,
            results: deletionResults
        },
        { status: allSucceeded ? 200 : 207 } // 207 Multi-Status if some failed
    );
}
