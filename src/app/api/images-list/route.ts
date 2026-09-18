import { getOutputDir } from '@/lib/server-settings';
import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';

/** Lists every picture in the output folder, so the history can be rebuilt from the disk alone. */
export async function GET() {
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
    return NextResponse.json({ ok: true, dir, files });
}
