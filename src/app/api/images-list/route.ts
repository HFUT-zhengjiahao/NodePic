import { checkPassword, readAuthCookie } from '@/lib/api-auth';
import { getOutputDir } from '@/lib/server-settings';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';

/**
 * Lists every picture in the output folder, so the history can be rebuilt from the disk alone.
 *
 * Gated like the write endpoints: the list is the whole gallery's inventory, and it used to hand
 * out the server's absolute output path along with it.
 */
export async function GET(request: NextRequest) {
    const authFailure = checkPassword(readAuthCookie(request));
    if (authFailure) {
        return NextResponse.json({ error: authFailure.error }, { status: authFailure.status });
    }

    const dir = await getOutputDir();

    let entries: string[] = [];
    try {
        entries = await fs.readdir(dir);
    } catch {
        return NextResponse.json({ ok: true, files: [] });
    }

    const files: Array<{ filename: string; bytes: number; modifiedAt: number }> = [];
    for (const entry of entries) {
        if (entry === 'index.json' || entry === '.trash') continue;
        try {
            const stat = await fs.stat(path.join(dir, entry));
            if (!stat.isFile()) continue;
            files.push({ filename: entry, bytes: stat.size, modifiedAt: stat.mtimeMs });
        } catch {
            // skip unreadable entries
        }
    }

    files.sort((a, b) => b.modifiedAt - a.modifiedAt);
    // The absolute output directory stays server-side: the client only needs the file list.
    return NextResponse.json({ ok: true, files });
}
