import type { Mention } from '@factorai/types';

/** A Monaco selection, reduced to what a mention needs. Monaco's own line and
 *  column numbers are 1-based, which is already `at_mentioned`'s convention. */
export interface LineSelection {
	startLine: number;
	endLine: number;
	/** 1-based column the selection ends on. */
	endColumn: number;
}

/**
 * The line range a selection means, or null when it means nothing (F20).
 *
 * **A selection ending at column 1 does not include that line.** Dragging from
 * line 12 down to the start of line 19 highlights nothing on 19, so calling it
 * `#L12-19` claims a line the reader never touched. Every editor trims this and
 * so does the CLI's own footer arithmetic, which does the same subtraction on
 * `selection_changed`.
 *
 * Returns null for an empty selection — a bare cursor is not a range, and
 * `@file#L12-12` for "I clicked here" is not what anyone meant.
 */
export function mentionRange(
	selection: LineSelection | null,
): { start: number; end: number } | null {
	if (!selection) return null;
	const { startLine, endColumn } = selection;
	// The guard on `> startLine` is what stops a one-line selection trimming
	// itself out of existence.
	const endLine =
		endColumn === 1 && selection.endLine > startLine ? selection.endLine - 1 : selection.endLine;
	return { start: startLine, end: endLine };
}

/** How the footer names what it is about to send. */
export function mentionLabel(range: { start: number; end: number } | null): string {
	if (!range) return 'Add file to Claude';
	if (range.start === range.end) return `Add line ${range.start} to Claude`;
	return `Add lines ${range.start}–${range.end} to Claude`;
}

/** What goes on the wire for this file and selection. */
export function mentionFor(path: string, range: { start: number; end: number } | null): Mention {
	return range ? { path, lineStart: range.start, lineEnd: range.end } : { path };
}
