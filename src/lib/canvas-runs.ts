import type { HistoryMetadata } from '@/app/page';
import { runCanvasTask, type RunCanvasTaskInput } from '@/lib/canvas-run';
import { canvasExists, loadCanvasNodes, saveCanvasNodes, type StoredCanvasNode } from '@/lib/canvas-store';
import type { CanvasTaskData, CanvasTaskParams } from '@/lib/canvas-types';
import { calculateApiCost } from '@/lib/cost-utils';

/**
 * Runs that outlive the component that started them.
 *
 * The board is remounted whenever the user switches canvas — it is keyed by `canvasId` — and a run
 * used to live entirely inside that component: its queue, the promise awaiting the provider, and
 * every `setNodes` that would have written the answer back. Switching away therefore threw the
 * result away. The node came back as "idle" with no picture and no error, and pressing Run again
 * paid the provider a second time for a picture it had already produced.
 *
 * The queue, the in-flight request and the outcome now live here, keyed by canvas id. An outcome is
 * written straight into the canvas' stored nodes — so it survives a remount, and even a move to the
 * recycle bin — and any mounted board is told about it as it lands.
 *
 * Because the queue lives here rather than in the board, it is also this module that has to know when
 * a run has become pointless: `cancelCanvasRuns()` drops queued work (the part that saves money) and
 * silences the write-back of a request that is already in flight.
 */

/** How many nodes of one canvas may talk to the provider at once; the rest wait in its queue. */
const MAX_CONCURRENT_RUNS = 2;

export type CanvasRunRequest = {
    canvasId: string;
    nodeId: string;
    /** The provider call itself: mode, prompt, parameters, sources and mask. */
    input: RunCanvasTaskInput;
    /** The node's own data at the moment Run was pressed, for the history entry and the defaults. */
    params: CanvasTaskParams;
    prompt: string;
    mode: 'generate' | 'edit';
    /** Filenames this node showed before the run, used to rewire the nodes downstream of it. */
    previousFilenames: string[];
    /** Keeps the runner's own messages in the user's language. */
    translate?: (key: string) => string;
};

export type CanvasRunOutcome = {
    nodeId: string;
    /** Data fields to merge into the node. */
    patch: Partial<CanvasTaskData>;
    /** Downstream rewiring: pictures this run replaced, old filename → new filename. */
    remap: Array<{ from: string; to: string }>;
};

type Listener = (outcome: CanvasRunOutcome) => void;

/** A request that has been accepted, carrying the token that identifies this particular attempt. */
type QueuedRun = CanvasRunRequest & { runToken: number };

/** canvasId → nodeId → the token of the run that node currently has in flight. */
const running = new Map<string, Map<string, number>>();
/** Runs accepted but not started yet, in the order they were requested. */
const queues = new Map<string, QueuedRun[]>();
/**
 * Tokens whose outcome must no longer touch a node.
 *
 * Tracked per run rather than per node: a node can be deleted (cancelling its run) and then restored
 * by undo, and a later run of that same node id still has to write its picture back normally.
 */
const cancelled = new Set<number>();
let nextRunToken = 1;
/** Outcomes no mounted board has copied into its own state yet. */
const unconsumed = new Map<string, Map<string, CanvasRunOutcome>>();
const listeners = new Map<string, Set<Listener>>();

/** Appends a finished run to the history. Registered by the page, which owns that list. */
let completionSink: ((entry: HistoryMetadata) => void) | null = null;

export function setCanvasRunCompletionSink(sink: ((entry: HistoryMetadata) => void) | null): void {
    completionSink = sink;
}

export function subscribeToCanvasRuns(canvasId: string, listener: Listener): () => void {
    const set = listeners.get(canvasId) ?? new Set<Listener>();
    set.add(listener);
    listeners.set(canvasId, set);
    return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(canvasId);
    };
}

/**
 * What a board that has just mounted must show for runs that are still in flight.
 *
 * Without this a canvas switched back to during a run would read "idle" (stored state is only
 * written when a run finishes) and offer to start the very same run again.
 */
export function canvasRunStatus(canvasId: string): Map<string, 'running' | 'queued'> {
    const status = new Map<string, 'running' | 'queued'>();
    for (const job of queues.get(canvasId) ?? []) status.set(job.nodeId, 'queued');
    for (const [nodeId, token] of running.get(canvasId) ?? []) {
        // A cancelled run still occupies its slot until the provider answers, but its result will be
        // thrown away — reporting it as "running" would leave a board that remounts showing a
        // "Generating…" card that nothing will ever finish.
        if (cancelled.has(token)) continue;
        status.set(nodeId, 'running');
    }
    return status;
}

export function isCanvasRunBusy(canvasId: string, nodeId: string): boolean {
    if (running.get(canvasId)?.has(nodeId)) return true;
    return (queues.get(canvasId) ?? []).some((job) => job.nodeId === nodeId);
}

/**
 * Gives up on runs whose node is gone — deleted, cleared away, or replaced by an import.
 *
 * The two cases cost different things, so they are handled differently:
 *
 *  * **Queued** runs are dropped before they ever reach the provider. That is the money this saves:
 *    the node is gone, so the picture would have been generated, billed and then discarded.
 *  * **Running** runs have already been paid for, so they are allowed to finish and their picture is
 *    still written to the history (the sink below runs either way). Only the write-back to the node
 *    is suppressed. Aborting the request instead would throw away a picture the user has already
 *    been charged for, and the provider is under no obligation to stop generating because the client
 *    hung up.
 *
 * Returns what was stopped, for the caller to report — silence here is what made the old behaviour
 * look like a lost task rather than a cancelled one.
 */
export function cancelCanvasRuns(canvasId: string, nodeIds?: readonly string[]): { queued: number; running: number } {
    const only = nodeIds ? new Set(nodeIds) : null;
    const matches = (nodeId: string) => !only || only.has(nodeId);

    let queued = 0;
    const queue = queues.get(canvasId);
    if (queue) {
        const keep = queue.filter((job) => !matches(job.nodeId));
        queued = queue.length - keep.length;
        if (keep.length > 0) queues.set(canvasId, keep);
        else queues.delete(canvasId);
    }

    let runningCount = 0;
    for (const [nodeId, token] of running.get(canvasId) ?? []) {
        if (!matches(nodeId)) continue;
        cancelled.add(token);
        runningCount += 1;
    }

    return { queued, running: runningCount };
}

/** Starts a run, or queues it when this canvas is already using both of its slots. */
export function startCanvasRun(request: CanvasRunRequest): 'started' | 'queued' | 'ignored' {
    if (isCanvasRunBusy(request.canvasId, request.nodeId)) return 'ignored';

    const job: QueuedRun = { ...request, runToken: nextRunToken++ };

    if ((running.get(request.canvasId)?.size ?? 0) >= MAX_CONCURRENT_RUNS) {
        const queue = queues.get(request.canvasId) ?? [];
        queue.push(job);
        queues.set(request.canvasId, queue);
        return 'queued';
    }

    void execute(job);
    return 'started';
}

/** The board copied the outcome into its state, so nothing has to be re-applied when it saves. */
export function acknowledgeCanvasRun(canvasId: string, nodeId: string): void {
    unconsumed.get(canvasId)?.delete(nodeId);
}

/**
 * Outcomes for this canvas that no board has taken yet.
 *
 * A board reads its nodes from storage before it subscribes, so a run that finished inside that gap
 * would never reach it — the node would sit on "running" until the next reload. The board drains
 * this list once it is subscribed.
 */
export function pendingCanvasRunOutcomes(canvasId: string): CanvasRunOutcome[] {
    return Array.from(unconsumed.get(canvasId)?.values() ?? []);
}

/**
 * Re-applies outcomes no board has seen yet.
 *
 * A board saves its own node array, and one that is unmounting right as a run lands would write the
 * pre-run version back over the stored result. Merging the pending outcome into every save closes
 * that window without touching anything the user has edited since.
 */
export function reconcileCanvasRunOutcomes(canvasId: string, nodes: StoredCanvasNode[]): StoredCanvasNode[] {
    const pending = unconsumed.get(canvasId);
    if (!pending || pending.size === 0) return nodes;
    let next = nodes;
    for (const outcome of pending.values()) next = applyOutcomeToNodes(next, outcome);
    return next;
}

/**
 * Merges one finished run into a node list: the node gets its picture, and the nodes that referenced
 * the pictures this run replaced are pointed at the new ones.
 *
 * Exported because the board applies a run's outcome the moment it lands, while this module applies
 * it to the stored copy — two callers that used to carry a copy of this logic each, and any change to
 * one of them silently left the other behind.
 */
export function applyOutcomeToNodes(nodes: StoredCanvasNode[], outcome: CanvasRunOutcome): StoredCanvasNode[] {
    return nodes.map((node) => {
        if (node.id === outcome.nodeId) {
            return { ...node, data: { ...node.data, ...outcome.patch } };
        }
        if (outcome.remap.length === 0) return node;
        const sources = node.data.sourceFilenames ?? [];
        if (!sources.some((filename) => outcome.remap.some((item) => item.from === filename))) return node;
        return {
            ...node,
            data: {
                ...node.data,
                sourceFilenames: sources.map(
                    (filename) => outcome.remap.find((item) => item.from === filename)?.to ?? filename
                ),
                sourceMissing: false
            }
        };
    });
}

async function execute(request: QueuedRun): Promise<void> {
    const active = running.get(request.canvasId) ?? new Map<string, number>();
    running.set(request.canvasId, active);
    active.set(request.nodeId, request.runToken);

    const startedAt = Date.now();
    let outcome: CanvasRunOutcome;

    try {
        const { images, usage } = await runCanvasTask(request.input);
        const durationMs = Date.now() - startedAt;
        const costDetails = calculateApiCost(usage, request.params.model);

        // Downstream nodes referenced the old files by name; point them at the new ones so the drawn
        // lineage and the pictures a run uploads stay the same thing.
        const remap: Array<{ from: string; to: string }> = [];
        request.previousFilenames.forEach((filename, index) => {
            const replacement = images[index]?.filename ?? images[0]?.filename;
            if (replacement && replacement !== filename) remap.push({ from: filename, to: replacement });
        });

        outcome = {
            nodeId: request.nodeId,
            patch: { status: 'idle', images, viewIndex: 0, usage, costDetails, durationMs, error: null },
            remap
        };

        completionSink?.({
            timestamp: Date.now(),
            images: images.map((image) => ({ filename: image.filename })),
            storageModeUsed: 'fs',
            durationMs,
            quality: request.params.quality,
            background: request.params.background,
            moderation: request.params.moderation,
            prompt: request.prompt,
            mode: request.mode,
            costDetails,
            output_format: request.params.outputFormat,
            model: request.params.model
        });
    } catch (error) {
        outcome = {
            nodeId: request.nodeId,
            patch: {
                status: 'error',
                error:
                    error instanceof Error
                        ? error.message
                        : (request.translate?.('An unexpected error occurred.') ?? 'An unexpected error occurred.')
            },
            remap: []
        };
    }

    active.delete(request.nodeId);

    // The history entry above was written on purpose even for a cancelled run: the provider has
    // already been paid, and the picture is the only thing of value it produced. Everything below is
    // about the *node*, which no longer exists — writing an outcome would recreate storage keys for a
    // board that cannot show them, and notifying listeners would patch a node that is not there.
    const wasCancelled = cancelled.delete(request.runToken);

    if (!wasCancelled) {
        const pending = unconsumed.get(request.canvasId) ?? new Map<string, CanvasRunOutcome>();
        pending.set(request.nodeId, outcome);
        unconsumed.set(request.canvasId, pending);

        // Write first, tell the boards second: a board that is mounting right now reads storage, and
        // one that is mounted gets the same thing through the subscription a moment later. The write
        // is skipped when the canvas was removed for good while the request was in flight, so the
        // deletion does not grow its storage back.
        if (canvasExists(request.canvasId)) {
            try {
                const nodes = loadCanvasNodes(request.canvasId);
                saveCanvasNodes(request.canvasId, applyOutcomeToNodes(nodes, outcome));
            } catch (error) {
                console.warn('Could not store the finished run:', error);
            }
        }

        listeners.get(request.canvasId)?.forEach((listener) => {
            try {
                listener(outcome);
            } catch (error) {
                console.error('A canvas board failed to apply a finished run:', error);
            }
        });
    }

    // The freed slot goes to the next queued run — which may itself have been cancelled in the
    // meantime, in which case `execute` sees it in `cancelled` and stops after the request.
    const next = queues.get(request.canvasId)?.shift();
    if (next) void execute(next);
}
