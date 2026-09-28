import {
    DEFAULT_GPT_IMAGE_MODEL,
    IMAGE_OUTPUT_FORMATS,
    isGptImageModel,
    type ImageBackground,
    type ImageModeration,
    type ImageOutputFormat,
    type ImageQuality
} from '@/lib/models';
import { checkPassword, readAuthCookie } from '@/lib/api-auth';
import { registerImages } from '@/lib/image-index';
import { isForbiddenAddress } from '@/lib/net-safety';
import dns from 'dns/promises';
import fs from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import path from 'path';

// Streaming event types
type StreamingEvent = {
    type: 'partial_image' | 'completed' | 'error' | 'done';
    index?: number;
    partial_image_index?: number;
    b64_json?: string;
    filename?: string;
    path?: string;
    output_format?: string;
    usage?: OpenAI.Images.ImagesResponse['usage'];
    images?: Array<{
        filename: string;
        b64_json: string;
        path?: string;
        output_format: string;
    }>;
    error?: string;
};

/**
 * The provider client for one request.
 *
 * The key and endpoint come from the settings panel first — that is what lets anyone clone this
 * project and paste their own key in the UI — and fall back to the environment, so an existing
 * `.env.local` keeps working. Built per request rather than at module load, because the panel can
 * change the key while the server is running; the SDK constructor is cheap.
 */
async function openAiClient(): Promise<OpenAI | null> {
    const { readServerSettings, effectiveApiKey, effectiveBaseUrl } = await import('@/lib/server-settings');
    const settings = await readServerSettings();
    const apiKey = effectiveApiKey(settings);
    if (!apiKey) return null;
    const baseURL = effectiveBaseUrl(settings);
    return new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
}

// Validate and normalize output format
function validateOutputFormat(format: unknown): ImageOutputFormat {
    const normalized = String(format || 'png').toLowerCase();

    // Handle jpg -> jpeg normalization
    const mapped = normalized === 'jpg' ? 'jpeg' : normalized;

    if (IMAGE_OUTPUT_FORMATS.includes(mapped as ImageOutputFormat)) {
        return mapped as ImageOutputFormat;
    }

    return 'png'; // default fallback
}

// Request fields shared by the generations and edits endpoints, read once from the multipart body.
// Value validation beyond shape is left to OpenAI, whose 400 messages are surfaced to the client.
function readImageParams(formData: FormData) {
    const n = parseInt((formData.get('n') as string) || '1', 10);
    const output_format = validateOutputFormat(formData.get('output_format'));
    const compression = parseInt(formData.get('output_compression') as string, 10);
    return {
        n: Math.max(1, Math.min(n || 1, 10)),
        size: (formData.get('size') as string) || 'auto',
        quality: (formData.get('quality') as ImageQuality | null) || 'auto',
        output_format,
        background: (formData.get('background') as ImageBackground | null) || 'auto',
        moderation: (formData.get('moderation') as ImageModeration | null) || 'auto',
        ...((output_format === 'jpeg' || output_format === 'webp') && compression >= 0 && compression <= 100
            ? { output_compression: compression }
            : {})
    };
}

/** How long one upstream call may take before it is abandoned. */
const PROVIDER_TIMEOUT_MS = Number(process.env.IMAGE_PROVIDER_TIMEOUT_MS ?? 180_000);
/** How many requests may wait for a generation slot; past that the caller is told to retry. */
const MAX_QUEUED_REQUESTS = 8;
/** Ceiling for a picture a relay hands back as a URL instead of base64. */
const MAX_DOWNLOAD_BYTES = Number(process.env.IMAGE_DOWNLOAD_MAX_MB ?? 25) * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;
/** How many redirect hops a relay may send this server through before it gives up. */
const MAX_DOWNLOAD_REDIRECTS = 3;
/** Addresses a relay must never be able to make this server talk to, by name. */
const BLOCKED_DOWNLOAD_HOSTS = new Set([
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '::1',
    '169.254.169.254',
    'metadata.google.internal'
]);


/**
 * Filenames look like `<epoch-ms>-<index>.<ext>`, and two calls finishing in the same millisecond
 * produce exactly the same name — with two slots running that is a real possibility, and the later
 * write silently replaced the earlier picture *and* its registry entry. Bumping the counter keeps
 * the name inside the `\d{13}-\d+` shape the registry recognises.
 */
async function uniqueFilename(
    dir: string,
    timestamp: number,
    index: number,
    extension: string
): Promise<string> {
    let suffix = index;
    for (let attempt = 0; attempt < 1000; attempt += 1) {
        const candidate = `${timestamp}-${suffix}.${extension}`;
        try {
            await fs.access(path.join(dir, candidate));
        } catch {
            return candidate;
        }
        suffix += 1;
    }
    throw new Error('Could not find an unused filename for the generated image.');
}

function parseUrl(value: string, base?: URL): URL {
    try {
        return base ? new URL(value, base) : new URL(value);
    } catch {
        throw new Error('Upstream returned an image URL that is not valid.');
    }
}

/**
 * Rejects a host whose name — or, more importantly, whose *address* — points somewhere this server
 * has no business talking to.
 *
 * A block-list of host names is not enough on its own: `127.0.0.1.nip.io`, the decimal form
 * `http://2130706433/`, and any record that resolves to a private range all sail straight past it.
 * So the name is resolved first and every address it maps to is checked against the private,
 * loopback, link-local and reserved ranges. A name that does not resolve at all is refused too —
 * "unknown" is answered the same way as "forbidden".
 *
 * What this cannot stop is a server that answers differently between the lookup and the request
 * (DNS rebinding); closing that needs an egress proxy. It does stop everything a relay can do by
 * accident, and everything it can do with a static record.
 */
async function assertFetchableHost(hostname: string): Promise<void> {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (BLOCKED_DOWNLOAD_HOSTS.has(host)) {
        throw new Error('Refusing to download an image from a local or metadata address.');
    }

    let addresses: Array<{ address: string; family: number }>;
    try {
        addresses = await dns.lookup(host, { all: true });
    } catch {
        throw new Error('Could not resolve the address the upstream returned.');
    }
    if (addresses.length === 0) {
        throw new Error('Could not resolve the address the upstream returned.');
    }

    for (const { address, family } of addresses) {
        if (isForbiddenAddress(address, family)) {
            throw new Error('Refusing to download an image from a local, private or metadata address.');
        }
    }
}

/**
 * Downloads a picture the upstream returned as `url` rather than `b64_json`.
 *
 * The URL comes from a third party, so it is treated as untrusted: only http(s), never a private or
 * metadata address (checked again after every redirect), bounded in size and time. The failure
 * message deliberately omits the URL because it ends up in the client's error toast.
 */
async function downloadImageAsBase64(rawUrl: string): Promise<string> {
    let target = parseUrl(rawUrl);

    for (let hop = 0; hop <= MAX_DOWNLOAD_REDIRECTS; hop += 1) {
        if (target.protocol !== 'http:' && target.protocol !== 'https:') {
            throw new Error(`Refusing to download an image over ${target.protocol}.`);
        }
        await assertFetchableHost(target.hostname);

        // `redirect: 'manual'` because a redirect is where the SSRF check used to be lost: fetch
        // follows it to wherever the relay says, and the new address was never looked at again.
        const response = await fetch(target, {
            signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
            redirect: 'manual'
        });

        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location');
            if (!location) {
                throw new Error('Upstream redirected the image download without a destination.');
            }
            target = parseUrl(location, target);
            continue;
        }

        if (!response.ok) {
            throw new Error(`Failed to download the generated image (HTTP ${response.status}).`);
        }
        const declared = Number(response.headers.get('content-length') ?? '0');
        if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) {
            throw new Error('The generated image is larger than the download limit.');
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
            throw new Error('The generated image is larger than the download limit.');
        }
        return buffer.toString('base64');
    }

    throw new Error('The upstream redirected the image download too many times.');
}

/** One chunk of an upstream image stream, widened to the shape both providers emit. */
type StreamChunk = {
    type?: string;
    partial_image_index?: number;
    b64_json?: string;
    usage?: OpenAI.Images.ImagesResponse['usage'];
};

/**
 * Turns an upstream stream into the SSE response the classic form consumes.
 *
 * Generation and editing used to carry their own near-identical copy of this (~140 duplicated
 * lines); the only real difference is the event names the provider sends.
 */
function sseImageStream(params: {
    stream: AsyncIterable<StreamChunk>;
    partialEventType: string;
    completedEventType: string;
    outputDir: string;
    fileExtension: string;
    storeOnDisk: boolean;
}): Response {
    const encoder = new TextEncoder();
    const timestamp = Date.now();

    const readableStream = new ReadableStream({
        async start(controller) {
            const completedImages: Array<{
                filename: string;
                b64_json: string;
                path?: string;
                output_format: string;
            }> = [];
            let finalUsage: OpenAI.Images.ImagesResponse['usage'] | undefined;
            let imageIndex = 0;

            try {
                for await (const event of params.stream) {
                    if (event.type === params.partialEventType) {
                        const partialEvent: StreamingEvent = {
                            type: 'partial_image',
                            index: imageIndex,
                            partial_image_index: event.partial_image_index,
                            b64_json: event.b64_json
                        };
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(partialEvent)}\n\n`));
                        continue;
                    }
                    if (event.type !== params.completedEventType) continue;

                    const buffer = Buffer.from(event.b64_json ?? '', 'base64');
                    const filename = await uniqueFilename(
                        params.outputDir,
                        timestamp,
                        imageIndex,
                        params.fileExtension
                    );

                    if (params.storeOnDisk && buffer.byteLength > 0) {
                        await fs.writeFile(path.join(params.outputDir, filename), buffer);
                    }
                    // Registered one at a time: a stream that dies halfway used to leave its already
                    // written files unregistered, which made them invisible to cleanup forever.
                    if (params.storeOnDisk && buffer.byteLength > 0) {
                        await registerImages([{ filename, bytes: buffer.byteLength }]).catch((error) =>
                            console.error(`Failed to register streamed image ${filename}:`, error)
                        );
                    }

                    const imageData = {
                        filename,
                        b64_json: event.b64_json ?? '',
                        output_format: params.fileExtension,
                        ...(params.storeOnDisk ? { path: `/api/image/${filename}` } : {})
                    };
                    completedImages.push(imageData);
                    controller.enqueue(
                        encoder.encode(`data: ${JSON.stringify({ type: 'completed', index: imageIndex, ...imageData } satisfies StreamingEvent)}\n\n`)
                    );

                    imageIndex += 1;
                    finalUsage = event.usage;
                }

                const doneEvent: StreamingEvent = { type: 'done', images: completedImages, usage: finalUsage };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(doneEvent)}\n\n`));
                controller.close();
            } catch (error) {
                console.error('Streaming error:', error);
                const errorEvent: StreamingEvent = {
                    type: 'error',
                    error: error instanceof Error ? error.message : 'Streaming error occurred'
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`));
                controller.close();
            }
        }
    });

    return new Response(readableStream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive'
        }
    });
}

// The SDK's ImageEditParams type omits `moderation`, but the edits endpoint accepts it (documented in the API
// reference; the API rejects unknown parameter names, so the field is parsed rather than ignored).
type EditParams = OpenAI.Images.ImageEditParams & { moderation?: ImageModeration };
type EditParamsStreaming = OpenAI.Images.ImageEditParamsStreaming & { moderation?: ImageModeration };

async function ensureOutputDirExists(): Promise<string> {
    const { ensureOutputDir } = await import('@/lib/server-settings');
    try {
        return await ensureOutputDir();
    } catch (error) {
        console.error('Could not prepare the image output directory:', error);
        throw new Error('Failed to create image output directory.');
    }
}


/**
 * Image generation is slow and metered upstream, and the canvas lets several nodes run at once.
 * Queue the surplus instead of letting N requests hit the provider simultaneously.
 */
const MAX_CONCURRENT_REQUESTS = 2;
let activeRequests = 0;
const pendingSlots: Array<() => void> = [];

async function acquireSlot(): Promise<() => void> {
    if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
        console.log(`All ${MAX_CONCURRENT_REQUESTS} generation slots are busy — queueing this request.`);
        await new Promise<void>((resolve) => pendingSlots.push(resolve));
    }
    activeRequests += 1;

    let released = false;
    return () => {
        if (released) return;
        released = true;
        activeRequests -= 1;
        pendingSlots.shift()?.();
    };
}

export async function POST(request: NextRequest) {
    /*
     * Authenticate before this request costs anything. Parsing the multipart body and taking one of
     * the two provider slots used to happen first, so an unauthenticated caller could make the server
     * swallow an arbitrary upload *and* hold a slot that meters real money.
     *
     * The hash normally rides along in the auth cookie; the body field is still honoured so a client
     * that never went through the unlock screen keeps working. `formData()` consumes the request
     * body, which can only be read once — hence the single read here, handed to the handler below.
     */
    const cookieFailure = checkPassword(readAuthCookie(request));

    let formData: FormData;
    try {
        formData = await request.formData();
    } catch {
        return NextResponse.json({ error: 'Could not read the multipart request body.' }, { status: 400 });
    }

    if (cookieFailure) {
        const bodyFailure = checkPassword(formData.get('passwordHash'));
        if (bodyFailure) {
            console.error(bodyFailure.error);
            return NextResponse.json({ error: bodyFailure.error }, { status: bodyFailure.status });
        }
    }

    // A stuck upstream call used to let the queue grow without limit, so every later request sat
    // there forever with no feedback. Bounding it turns that into a retryable 503.
    if (pendingSlots.length >= MAX_QUEUED_REQUESTS) {
        return NextResponse.json(
            { error: 'The server is busy with other images — try again in a moment.' },
            { status: 503 }
        );
    }

    const releaseSlot = await acquireSlot();
    let slotHandedToStream = false;

    try {
        const response = await handleImageRequest(formData);
        const isEventStream = response.headers.get('content-type')?.includes('text/event-stream') === true;

        if (!isEventStream || !response.body) {
            return response;
        }

        // An SSE response is returned while the upstream request is still being consumed, so releasing
        // the slot here would let MAX_CONCURRENT_REQUESTS be exceeded. The wrapper below owns the slot
        // and gives it back when the stream actually finishes, errors or is cancelled.
        slotHandedToStream = true;
        const reader = response.body.getReader();
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            releaseSlot();
        };

        return new Response(
            new ReadableStream({
                async pull(controller) {
                    try {
                        const { done, value } = await reader.read();
                        if (done) {
                            controller.close();
                            release();
                            return;
                        }
                        controller.enqueue(value);
                    } catch (error) {
                        controller.error(error);
                        release();
                    }
                },
                cancel(reason) {
                    void reader.cancel(reason);
                    release();
                }
            }),
            { status: response.status, headers: response.headers }
        );
    } finally {
        if (!slotHandedToStream) releaseSlot();
    }
}

async function handleImageRequest(formData: FormData) {
    console.log('Received POST request to /api/images');

    try {
        let effectiveStorageMode: 'fs' | 'indexeddb';
        const explicitMode = process.env.NEXT_PUBLIC_IMAGE_STORAGE_MODE;
        const isOnVercel = process.env.VERCEL === '1';

        if (explicitMode === 'fs') {
            effectiveStorageMode = 'fs';
        } else if (explicitMode === 'indexeddb') {
            effectiveStorageMode = 'indexeddb';
        } else if (isOnVercel) {
            effectiveStorageMode = 'indexeddb';
        } else {
            effectiveStorageMode = 'fs';
        }
        console.log(
            `Effective Image Storage Mode: ${effectiveStorageMode} (Explicit: ${explicitMode || 'unset'}, Vercel: ${isOnVercel})`
        );

        // Resolved once per request: the folder is configurable from the settings page.
        let outputDir = '';
        if (effectiveStorageMode === 'fs') {
            outputDir = await ensureOutputDirExists();
        }

        const mode = formData.get('mode') as 'generate' | 'edit' | null;
        const prompt = formData.get('prompt') as string | null;
        const model = formData.get('model') || DEFAULT_GPT_IMAGE_MODEL;

        // The prompt length, not the prompt: what the user typed is their business, and the log is
        // the one place in the app that would otherwise keep a copy of every idea they ever tried.
        console.log(`Mode: ${mode}, Model: ${model}, Prompt length: ${prompt ? prompt.length : 0}`);

        if (!mode || !prompt) {
            return NextResponse.json({ error: 'Missing required parameters: mode and prompt' }, { status: 400 });
        }
        if (!isGptImageModel(model)) {
            return NextResponse.json({ error: `Unsupported model: ${String(model)}` }, { status: 400 });
        }

        const imageParams = readImageParams(formData);
        const fileExtension = imageParams.output_format;

        // `response=meta` (canvas nodes) skips echoing base64 back: with filesystem storage the client
        // only needs the filename and fetches the picture from /api/image/<filename>.
        const metaOnlyResponse = formData.get('response') === 'meta' && effectiveStorageMode === 'fs';

        // Check for streaming mode
        const streamEnabled = formData.get('stream') === 'true';
        const partialImages = Math.max(1, Math.min(parseInt((formData.get('partial_images') as string) || '2', 10), 3));

        // Source images for edit mode, read once and shared by both providers.
        const sourceImageFiles: File[] = [];
        if (mode === 'edit') {
            for (const [key, value] of formData.entries()) {
                if (key.startsWith('image_') && value instanceof File) {
                    sourceImageFiles.push(value);
                }
            }
        }

        let result: OpenAI.Images.ImagesResponse;

        // One check, one message: whichever way the key was configured (panel or environment).
        const openai = await openAiClient();
        if (!openai) {
            console.error('No provider API key configured — set one in the settings panel.');
            return NextResponse.json(
                {
                    error:
                        'No API key configured. Open Settings → API and paste your key, or set OPENAI_API_KEY in .env.local.'
                },
                { status: 500 }
            );
        }

        if (mode === 'generate') {
            const baseParams: OpenAI.Images.ImageGenerateParams = { model, prompt, ...imageParams };

            // Handle streaming mode for generation
            if (streamEnabled) {
                const streamParams: OpenAI.Images.ImageGenerateParamsStreaming = {
                    ...baseParams,
                    stream: true,
                    partial_images: partialImages
                };

                const stream = await openai.images.generate(streamParams, { timeout: PROVIDER_TIMEOUT_MS });

                return sseImageStream({
                    stream: stream as unknown as AsyncIterable<StreamChunk>,
                    partialEventType: 'image_generation.partial_image',
                    completedEventType: 'image_generation.completed',
                    outputDir,
                    fileExtension,
                    storeOnDisk: effectiveStorageMode === 'fs'
                });
            }

            result = await openai.images.generate(baseParams, { timeout: PROVIDER_TIMEOUT_MS });
        } else if (mode === 'edit') {
            const imageFiles = sourceImageFiles;

            if (imageFiles.length === 0) {
                return NextResponse.json({ error: 'No image file provided for editing.' }, { status: 400 });
            }

            const maskFile = formData.get('mask') as File | null;

            const baseEditParams: EditParams = {
                model,
                prompt,
                image: imageFiles,
                ...imageParams,
                ...(maskFile ? { mask: maskFile } : {})
            };

            // Handle streaming mode for editing
            if (streamEnabled) {
                const streamEditParams: EditParamsStreaming = {
                    ...baseEditParams,
                    stream: true,
                    partial_images: partialImages
                };

                console.log('Calling OpenAI edit with streaming, params:', {
                    ...streamEditParams,
                    image: `[${imageFiles.map((f) => f.name).join(', ')}]`,
                    mask: maskFile ? maskFile.name : 'N/A'
                });

                const stream = await openai.images.edit(streamEditParams, { timeout: PROVIDER_TIMEOUT_MS });

                return sseImageStream({
                    stream: stream as unknown as AsyncIterable<StreamChunk>,
                    partialEventType: 'image_edit.partial_image',
                    completedEventType: 'image_edit.completed',
                    outputDir,
                    fileExtension,
                    storeOnDisk: effectiveStorageMode === 'fs'
                });
            }

            result = await openai.images.edit(baseEditParams, { timeout: PROVIDER_TIMEOUT_MS });
        } else {
            return NextResponse.json({ error: 'Invalid mode specified' }, { status: 400 });
        }

        console.log('Provider call successful.');

        // OpenAI-compatible gateways (relays, self-hosted proxies) often answer with `url` instead of
        // `b64_json` unless base64 is explicitly requested. Download those payloads so the storage
        // pipeline below (filesystem / IndexedDB) keeps receiving base64 data either way.
        await Promise.all(
            (result?.data ?? []).map(async (imageData) => {
                const payload = imageData as { b64_json?: string; url?: string };
                if (payload.b64_json || !payload.url) {
                    return;
                }
                payload.b64_json = await downloadImageAsBase64(payload.url);
            })
        );

        if (!result || !Array.isArray(result.data) || result.data.length === 0) {
            console.error('Invalid or empty data received from OpenAI API:', result);
            return NextResponse.json({ error: 'Failed to retrieve image data from API.' }, { status: 500 });
        }

        /** Byte counts are captured here: `response=meta` drops the base64 before registering, and
         *  measuring it afterwards recorded 0 bytes for every canvas-generated picture. */
        const registered: Array<{ filename: string; bytes: number }> = [];

        const savedImagesData = await Promise.all(
            result.data.map(async (imageData, index) => {
                if (!imageData.b64_json) {
                    console.error(`Image data ${index} is missing b64_json.`);
                    throw new Error(`Image data at index ${index} is missing base64 data.`);
                }
                const buffer = Buffer.from(imageData.b64_json, 'base64');
                const timestamp = Date.now();
                const filename =
                    effectiveStorageMode === 'fs'
                        ? await uniqueFilename(outputDir, timestamp, index, fileExtension)
                        : `${timestamp}-${index}.${fileExtension}`;

                if (effectiveStorageMode === 'fs') {
                    await fs.writeFile(path.join(outputDir, filename), buffer);
                    registered.push({ filename, bytes: buffer.byteLength });
                }

                const imageResult: { filename: string; b64_json?: string; path?: string; output_format: string } = {
                    filename: filename,
                    output_format: fileExtension,
                    ...(metaOnlyResponse ? {} : { b64_json: imageData.b64_json })
                };

                if (effectiveStorageMode === 'fs') {
                    imageResult.path = `/api/image/${filename}`;
                }

                return imageResult;
            })
        );

        // Remember what we produced so a later cleanup never has to guess.
        if (registered.length > 0) {
            await registerImages(registered);
        }

        console.log(`All images processed. Mode: ${effectiveStorageMode}`);

        return NextResponse.json({
            images: savedImagesData,
            usage: result.usage,
            ...(metaOnlyResponse ? { metaOnly: true } : {})
        });
    } catch (error: unknown) {
        console.error('Error in /api/images:', error);

        let errorMessage = 'An unexpected error occurred.';
        let status = 500;

        if (error instanceof Error) {
            errorMessage = error.message;
            if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number') {
                status = error.status;
            }
        } else if (typeof error === 'object' && error !== null) {
            if ('message' in error && typeof error.message === 'string') {
                errorMessage = error.message;
            }
            if ('status' in error && typeof error.status === 'number') {
                status = error.status;
            }
        }

        return NextResponse.json({ error: errorMessage }, { status });
    }
}
