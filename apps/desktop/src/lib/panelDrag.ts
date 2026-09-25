/**
 * Whether a `PanelResizer` drag is in progress (PERF-30).
 *
 * Module state rather than a store, because nothing renders from it: the one
 * reader is a terminal's `ResizeObserver`, which asks at the moment it fires.
 * A drag changes the session column's width on every frame, and a terminal
 * that refits on each of those sends the PTY a new geometry per frame — the
 * agent behind it redraws its whole screen each time, and that output comes
 * back through the stream while the drag is still going. So a terminal holds
 * its geometry for the length of a drag and fits once when it ends.
 */

let dragging = false;
const onEnd = new Set<() => void>();

export function isPanelDragging(): boolean {
	return dragging;
}

export function beginPanelDrag(): void {
	dragging = true;
}

/** Idempotent: `pointerup` and `lostpointercapture` both arrive for one drag. */
export function endPanelDrag(): void {
	if (!dragging) return;
	dragging = false;
	for (const fn of onEnd) fn();
}

/** Run `fn` each time a drag ends. Returns the unsubscribe. */
export function onPanelDragEnd(fn: () => void): () => void {
	onEnd.add(fn);
	return () => {
		onEnd.delete(fn);
	};
}
