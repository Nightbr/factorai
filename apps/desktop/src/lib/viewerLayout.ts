/**
 * Where the file viewer renders, decided by measurement (ADR-0037).
 *
 * Two hosts: a **column** between the session and the file panel, and a
 * **split** under the tree inside that panel. Which one is a function of the
 * shell's width and of the two side panels the user has dragged — not a
 * preference, because a preference cannot know that the sidebar was just pulled
 * out to 480px.
 *
 * Everything here is pure so the rule can be pinned without a layout: the
 * threshold, the dead band and the ceilings are the whole of the decision, and
 * they are the parts that break silently.
 */

/** Narrower than this and Monaco is a gutter and a margin — the wrapped line
 *  under it has nowhere to go. */
export const MIN_VIEWER_WIDTH = 400;

/** Wide enough for a typical source line before wrap, narrow enough to leave
 *  the session more than half the shell at the 1400px default window. */
export const DEFAULT_VIEWER_WIDTH = 460;

/**
 * The session's floor, and the number the whole rule hangs on.
 *
 * 400px is **~52 columns** — measured in the dev app, where a 660px session
 * pane reported `COLUMNS=86`, so a column is 7.7px and not the 7.2 first
 * assumed. That is under the 80 the CLI writes its output for, so long lines
 * wrap, and it is a deliberate trade: at 560 (an honest 80 columns) the
 * threshold lands above 1400 and the default window would never show the
 * viewer column at all. It binds only when both panels are dragged to their
 * extremes.
 */
export const MIN_SESSION_WIDTH = 400;

/** Three `PanelResizer` strips at `w-1` sit between the four columns. Counted
 *  rather than ignored: at the threshold, 12px is the difference between the
 *  layout flipping and the session sitting 12px under its floor. */
export const COLUMN_GUTTERS = 12;

/**
 * How far past the threshold the shell has to grow before the column comes
 * back.
 *
 * Without it, dragging a window edge across the flip point restyles the whole
 * shell on alternate frames — the split's wider panel changes the threshold,
 * which flips it back. 40px is about two frames of a deliberate drag.
 */
export const HOST_DEAD_BAND = 40;

export type ViewerHost = 'column' | 'split';

/** The shell width at which four columns stop fitting. A function of the
 *  panels' current widths, so it moves when they do. */
export function columnThreshold(sidebarWidth: number, panelWidth: number): number {
	return sidebarWidth + MIN_SESSION_WIDTH + MIN_VIEWER_WIDTH + panelWidth + COLUMN_GUTTERS;
}

interface HostInput {
	/** The shell row's measured width — everything under the top bar. */
	shellWidth: number;
	sidebarWidth: number;
	/** The panel's width **in column mode**, not whichever width is applied
	 *  right now: the question is whether the column would fit, and in split
	 *  mode the panel is deliberately wider. */
	columnPanelWidth: number;
	/** What is showing, so the answer can be sticky. */
	current: ViewerHost;
}

/**
 * Which host the viewer belongs in.
 *
 * Sticky by `HOST_DEAD_BAND`: a column stays a column until the shell is under
 * the threshold, and a split becomes a column only once the shell is a dead
 * band clear of it.
 */
export function resolveViewerHost({
	shellWidth,
	sidebarWidth,
	columnPanelWidth,
	current,
}: HostInput): ViewerHost {
	// A shell that has not been measured yet reports 0. Answering "split" for it
	// would flash the narrow layout on every launch before the observer fires,
	// so an unmeasured shell keeps whatever is showing.
	if (!Number.isFinite(shellWidth) || shellWidth <= 0) return current;
	const threshold = columnThreshold(sidebarWidth, columnPanelWidth);
	return shellWidth >= threshold + (current === 'column' ? 0 : HOST_DEAD_BAND) ? 'column' : 'split';
}

interface CeilingInput {
	shellWidth: number;
	sidebarWidth: number;
	/** The viewer's own width, when it has a column of its own. */
	viewerWidth: number;
	host: ViewerHost;
	/** Nothing open means no viewer column, so the panel may take its space. */
	viewerOpen: boolean;
}

/**
 * How wide the file panel may be dragged before it starts eating the session.
 *
 * Replaces the fixed `MAX_PANEL_WIDTH = 600`, which was chosen when the panel
 * only ever held a tree (ADR-0037). A constant cannot work here: the ceiling
 * has to be the shell minus everything that is not the panel, or a laptop
 * window ends up with a 600px panel and a 300px session.
 */
export function maxPanelWidth({
	shellWidth,
	sidebarWidth,
	viewerWidth,
	host,
	viewerOpen,
}: CeilingInput): number {
	const viewerColumn = viewerOpen && host === 'column' ? viewerWidth : 0;
	return shellWidth - sidebarWidth - MIN_SESSION_WIDTH - viewerColumn - COLUMN_GUTTERS;
}

/** The viewer's width, held between its floor and whatever the shell leaves.
 *  Pure, like `clampPanelWidth`, and for the same reason. */
export function clampViewerWidth(width: number, max: number): number {
	if (!Number.isFinite(width)) return DEFAULT_VIEWER_WIDTH;
	const ceiling = Number.isFinite(max) ? max : Number.POSITIVE_INFINITY;
	return Math.max(MIN_VIEWER_WIDTH, Math.min(ceiling, Math.round(width)));
}

/**
 * How wide the viewer's own column may be dragged. Same arithmetic from the
 * other side: the panel is fixed while this one moves.
 */
export function maxViewerWidth(
	shellWidth: number,
	sidebarWidth: number,
	panelWidth: number,
): number {
	return shellWidth - sidebarWidth - MIN_SESSION_WIDTH - panelWidth - COLUMN_GUTTERS;
}
