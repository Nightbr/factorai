import type { FileContents } from '@factorai/types';
import type { DiffMode } from '@hooks/useFileViewer';

/**
 * Whether a file the viewer opened can be edited, and what to say when it
 * cannot (specs/05-features.md F26).
 *
 * Its own module, free of Monaco, so it can be tested without pulling the
 * heaviest dependency in the app into a unit test.
 */

/**
 * A plan is a working document Claude writes while it thinks, and editing one
 * is editing the agent's scratch paper (F9). The only exception to "every text
 * file is editable" that is a policy rather than a limitation.
 */
export function isPlanPath(path: string): boolean {
	return /\/\.claude\/plans\/[^/]+\.md$/.test(path);
}

/**
 * Why this file cannot be edited, or `null` when it can.
 *
 * The two technical cases are both "saving this buffer would destroy
 * something": a truncated read is a prefix, and writing it back deletes
 * everything past the cap; a lossy read carries U+FFFD where bytes failed to
 * decode, and writing it back replaces those bytes for good. Binary never
 * reaches here — it gets the card instead.
 *
 * The string is the footer's label, so it names the reason rather than saying
 * `read-only` and leaving the reader to guess which of four things happened.
 */
export function readOnlyReason(file: FileContents, path: string): string | null {
	if (file.truncated) return 'truncated — read-only';
	if (file.lossy) return 'not valid UTF-8 — read-only';
	if (isPlanPath(path)) return 'plan — read-only';
	return null;
}

/**
 * Whether the right-hand side of a diff is the file on disk — the only side an
 * edit could ever reach (F26 § "Editing a diff", ADR-0041).
 *
 * `unstaged` (index ↔ worktree) and `head` (HEAD ↔ worktree) both put the
 * working tree on the right. `staged` puts the index there, and a commit range
 * puts a blob at each end; a git object is not a file, and factorai has no
 * command that writes one.
 */
export function diffEditsWorktree(mode: DiffMode): boolean {
	return mode === 'unstaged' || mode === 'head';
}

/**
 * Why a diff cannot be edited, or `null` when its right-hand side is the file
 * on disk. Same contract as `readOnlyReason`: the string is the footer's
 * label, and it names *which* of the reasons applies rather than saying
 * `read-only` and leaving the reader to guess.
 *
 * A file-level reason still applies on top of this one — a truncated worktree
 * side is no more writable in a diff than it is in the file view.
 */
export function diffReadOnlyReason(mode: DiffMode): string | null {
	if (diffEditsWorktree(mode)) return null;
	return mode === 'staged' ? 'index — read-only' : 'commit — read-only';
}

/**
 * Which line ending this file uses, so Monaco can be told and a CRLF file
 * saves back as one (F26 § "What Save writes"). A one-character fix must not
 * produce a whole-file diff.
 *
 * The first ending decides, the way every editor does it: a file with both is
 * already inconsistent, and rewriting the other half is a change nobody asked
 * for.
 */
export function eolOf(contents: string): 'crlf' | 'lf' {
	const lf = contents.indexOf('\n');
	if (lf < 0) return 'lf';
	return lf > 0 && contents[lf - 1] === '\r' ? 'crlf' : 'lf';
}
