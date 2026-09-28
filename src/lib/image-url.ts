/**
 * The one place that turns a stored filename into the URL the browser fetches.
 *
 * The same template literal used to be written out in six places, and three of them forgot
 * `encodeURIComponent` — so a filename with a reserved character behaved differently depending on
 * which screen rendered it.
 */
export function imageUrl(filename: string): string {
    return `/api/image/${encodeURIComponent(filename)}`;
}
