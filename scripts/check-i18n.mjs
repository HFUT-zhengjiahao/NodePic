#!/usr/bin/env node
/**
 * Fails when a `t('…')` call site has no matching dictionary key.
 *
 * The dictionary is keyed by the English source string, so a typo (or editing one side only) makes
 * the UI silently fall back to English. This turns that into a build-time error.
 *
 *   node scripts/check-i18n.mjs        # or: npm run i18n:check
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const srcDir = join(root, 'src');
const dictDir = join(srcDir, 'lib', 'i18n', 'zh');

function walk(dir) {
    return readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        return statSync(full).isDirectory() ? walk(full) : [full];
    });
}

const unescapeLiteral = (value) => value.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');

/** Every `t('…')` / `t("…")` literal in the app (the literal itself is always on one line). */
function collectUsedKeys() {
    const used = new Map();
    for (const file of walk(srcDir)) {
        if (!/\.(ts|tsx)$/.test(file) || file.includes(join('lib', 'i18n'))) continue;
        const content = readFileSync(file, 'utf8');
        // Whitespace (including newlines) may sit between `t(` and its literal, so scan the whole
        // file rather than line by line.
        for (const match of content.matchAll(/\bt\(\s*(['"])((?:\\.|(?!\1)[^\\])*?)\1/g)) {
            const key = unescapeLiteral(match[2]);
            if (!used.has(key)) {
                const line = content.slice(0, match.index).split('\n').length;
                used.set(key, `${relative(root, file)}:${line}`);
            }
        }
    }
    return used;
}

/** Dictionary entries, unquoted keys included. */
function collectDefinedKeys() {
    const defined = new Map();
    for (const file of readdirSync(dictDir)) {
        if (!file.endsWith('.ts')) continue;
        const flat = readFileSync(join(dictDir, file), 'utf8').replace(/\s+/g, ' ');
        const entry = /(?:^|[{,\s])(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|([A-Za-z_$][\w$]*))\s*:\s*'/g;
        for (const match of flat.matchAll(entry)) {
            const key = unescapeLiteral(match[1] ?? match[2] ?? match[3] ?? '');
            if (key && !defined.has(key)) defined.set(key, file);
        }
    }
    return defined;
}

/**
 * Keys resolved through a variable — `t(label)` where label comes from a constant list — cannot be
 * found by scanning for literals, so they are declared here explicitly.
 */
const DYNAMIC_KEYS = new Set([
    // Labels rendered through a variable: t(option.charAt(0).toUpperCase() + option.slice(1)) and
    // t(preset.label) in the canvas node and the settings panel.
    'Auto',
    'Low',
    'Medium',
    'High',
    'XHigh',
    'Max',
    'Opaque',
    'Transparent',
    'Square',
    'Landscape',
    'Portrait',
    'Custom',
    'JPEG'
]);

const used = collectUsedKeys();
const defined = collectDefinedKeys();

const missing = [...used.entries()].filter(([key]) => !defined.has(key));
const unused = [...defined.keys()].filter((key) => !used.has(key) && !DYNAMIC_KEYS.has(key));

console.log(`i18n: ${used.size} key(s) used, ${defined.size} defined.`);

if (unused.length > 0) {
    console.log(`\nnote: ${unused.length} dictionary entr(ies) no call site uses (harmless, but dead weight):`);
    for (const key of unused.slice(0, 20)) console.log(`  - ${JSON.stringify(key)}  (${defined.get(key)})`);
}

if (missing.length > 0) {
    console.error(`\n✖ ${missing.length} key(s) used in code but missing from the zh dictionary:`);
    for (const [key, where] of missing) console.error(`  - ${JSON.stringify(key)}  <- ${where}`);
    console.error('\nThe UI would fall back to English for these. Add them to src/lib/i18n/zh/*.ts.');
    process.exit(1);
}

console.log('✓ every used key has a translation.');
