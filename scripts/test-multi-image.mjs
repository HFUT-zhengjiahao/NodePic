#!/usr/bin/env node
/**
 * Probes whether an OpenAI-compatible endpoint really forwards multi-image edit requests.
 *
 * The model accepts up to 16 source images, but relays often validate more strictly than the model
 * (PackyAPI, for example, rejects anything but one image). This sends the same multipart request the
 * app builds — two source images plus a prompt — and reports what came back, so a candidate provider
 * can be judged before switching the playground over to it.
 *
 *   node scripts/test-multi-image.mjs <base-url> <api-key> [model] [image-a] [image-b]
 *
 * Example:
 *   node scripts/test-multi-image.mjs https://api.example.com/v1 sk-xxx gpt-image-2.5-sunburst a.png b.png
 *
 * Exit code 0 = the endpoint accepted both images, 1 = it did not.
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const [, , baseUrlArg, apiKey, modelArg, imageAArg, imageBArg] = process.argv;

if (!baseUrlArg || !apiKey) {
    console.error('usage: node scripts/test-multi-image.mjs <base-url> <api-key> [model] [image-a] [image-b]');
    process.exit(2);
}

const baseUrl = baseUrlArg.replace(/\/+$/, '');
const model = modelArg || 'gpt-image-2.5-sunburst';
const imageA = imageAArg || 'generated-images/1789714509968-0.png';
const imageB = imageBArg || 'generated-images/1789711602104-0.png';

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const mimeFor = (path) => MIME[path.split('.').pop()?.toLowerCase()] ?? 'image/png';

async function main() {
    const [a, b] = await Promise.all([readFile(imageA), readFile(imageB)]);

    const form = new FormData();
    form.append('model', model);
    form.append('prompt', 'Merge the two reference pictures into one coherent illustration, keeping both subjects.');
    form.append('image', new File([a], basename(imageA), { type: mimeFor(imageA) }));
    form.append('image', new File([b], basename(imageB), { type: mimeFor(imageB) }));
    form.append('n', '1');
    form.append('quality', 'low');
    form.append('size', '1024x1024');

    console.log(`POST ${baseUrl}/images/edits`);
    console.log(`  model  : ${model}`);
    console.log(`  images : ${basename(imageA)} + ${basename(imageB)}`);

    const started = Date.now();
    let response;
    try {
        response = await fetch(`${baseUrl}/images/edits`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}` },
            body: form
        });
    } catch (error) {
        console.error(`\n✖ Network error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const text = await response.text();
    let payload;
    try {
        payload = JSON.parse(text);
    } catch {
        payload = null;
    }

    if (response.ok && payload?.data?.length) {
        const first = payload.data[0];
        console.log(`\n✓ Accepted ${response.status} in ${elapsed}s — the endpoint forwarded both images.`);
        console.log(`  result: ${first.url ? first.url.slice(0, 80) : `b64_json (${first.b64_json?.length ?? 0} chars)`}`);
        process.exit(0);
    }

    console.error(`\n✖ Rejected with HTTP ${response.status} in ${elapsed}s.`);
    console.error(`  ${payload?.error?.message ?? text.slice(0, 400)}`);
    console.error('\nThis endpoint will not work with more than one reference image.');
    process.exit(1);
}

await main();
