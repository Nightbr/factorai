import type { IBufferLine, ILink, ILinkProvider, Terminal as XTerm } from '@xterm/xterm';
import { type ResolveContext, type ResolvedLink, resolveLinks } from '@lib/fileLinks';

/**
 * xterm's third link path: a **path** in the agent's output (F19).
 *
 * The other two are `WebLinksAddon`'s regex over URLs and `options.linkHandler`
 * for OSC 8, both in `Terminal.tsx`. This one exists because the CLI marks up
 * URLs and never paths — see F19 for how that was established — so nothing
 * declares a path as a link and we have to find it ourselves.
 *
 * Everything about *what is a path* lives in `lib/fileLinks.ts`. What lives here
 * is the part that is genuinely about xterm: reading a logical line out of a
 * wrapped buffer, and mapping a string offset back to a cell.
 */

/** How far the wrap walk will go in either direction. The same bound
 *  `WebLinksAddon` uses: a logical line longer than this is a paste or a
 *  minified file, and neither holds a path worth hunting for. */
const MAX_WINDOW_CHARS = 2048;

/** One logical line, reassembled from the wrapped rows that make it up. */
interface WindowedLine {
	text: string;
	/** 0-based buffer index of the first row in `text`. */
	startRow: number;
}

/**
 * The logical line containing buffer row `row`, wrapped rows joined.
 *
 * A TUI at a narrow width splits long paths constantly, and the provider is
 * handed one row — so without this, the long paths most worth clicking are
 * exactly the ones that never link.
 *
 * The walk stops at a row containing a space, in both directions: a wrapped
 * continuation that already has a space in it cannot be the middle of one
 * unbroken token, so there is nothing to be gained by joining further. That is
 * `WebLinksAddon`'s heuristic and it is the reason this stays cheap on a screen
 * full of prose.
 */
export function windowedLine(term: XTerm, row: number): WindowedLine {
	const buffer = term.buffer.active;
	const here = buffer.getLine(row);
	if (!here) return { text: '', startRow: row };

	const texts: string[] = [];
	let startRow = row;
	const hereText = here.translateToString(true);

	if (here.isWrapped && hereText[0] !== ' ') {
		let above: IBufferLine | undefined;
		let taken = 0;
		let cursor = row;
		while (taken < MAX_WINDOW_CHARS) {
			above = buffer.getLine(--cursor);
			if (!above) break;
			const text = above.translateToString(true);
			taken += text.length;
			texts.push(text);
			startRow = cursor;
			if (!above.isWrapped || text.includes(' ')) break;
		}
		texts.reverse();
	}

	texts.push(hereText);

	let taken = 0;
	let cursor = row;
	while (taken < MAX_WINDOW_CHARS) {
		const below = buffer.getLine(++cursor);
		if (!below?.isWrapped) break;
		const text = below.translateToString(true);
		taken += text.length;
		texts.push(text);
		if (text.includes(' ')) break;
	}

	return { text: texts.join(''), startRow };
}

/**
 * The cell a string offset lands on, walking from `(row, col)`.
 *
 * Not arithmetic, because a string index is not a cell index: a CJK character
 * or an emoji is one character of `translateToString` and two cells of buffer,
 * and a combining sequence is several characters of one cell. Getting this
 * wrong shifts the underline off the path by however many wide characters
 * preceded it — which is invisible in a Latin-only test and obvious the first
 * time an agent prints a box-drawn table with a CJK label in it.
 *
 * Returns null when the offset runs off the end of the buffer.
 */
export function cellAt(
	term: XTerm,
	startRow: number,
	startCol: number,
	offset: number,
): { row: number; col: number } | null {
	const buffer = term.buffer.active;
	const cell = buffer.getNullCell();
	let row = startRow;
	let col = startCol;
	let remaining = offset;

	while (remaining > 0) {
		const line = buffer.getLine(row);
		if (!line) return null;
		for (; col < line.length; col++) {
			line.getCell(col, cell);
			// A zero-width cell is the second half of a wide character — it holds
			// no string of its own and must not consume any of the offset.
			if (!cell.getWidth()) continue;
			remaining -= cell.getChars().length || 1;
			if (remaining <= 0) return { row, col };
		}
		row++;
		col = 0;
	}
	return { row, col };
}

/** What a resolved link does when clicked. The gate lives in `Terminal.tsx`
 *  alongside the URL one, so all three kinds of link agree about what a click
 *  means. */
type ActivateFileLink = (event: MouseEvent, link: ResolvedLink) => void;

/**
 * Build the provider. `context` is read at call time rather than captured, so a
 * session whose cwd or project changes under a pooled terminal resolves against
 * the current one.
 */
export function createFileLinkProvider(
	term: XTerm,
	context: () => ResolveContext,
	activate: ActivateFileLink,
): ILinkProvider {
	return {
		provideLinks(bufferLineNumber, callback) {
			// 1-based, into `buffer.active.getLine`, which is absolute and includes
			// scrollback. Same convention `WebLinksAddon` decodes.
			const { text, startRow } = windowedLine(term, bufferLineNumber - 1);
			if (!text) {
				callback(undefined);
				return;
			}

			void resolveLinks(text, context())
				.then((resolved) => {
					const links: ILink[] = [];
					for (const link of resolved) {
						const start = cellAt(term, startRow, 0, link.start + 1);
						// `end` is one past the last character; the range wants the last
						// cell itself, so the offset is `end` rather than `end + 1`.
						const end = cellAt(term, startRow, 0, link.end);
						if (!start || !end) continue;
						links.push({
							// xterm's ranges are 1-based and inclusive at both ends.
							range: {
								start: { x: start.col + 1, y: start.row + 1 },
								end: { x: end.col + 1, y: end.row + 1 },
							},
							text: link.path,
							activate: (event) => activate(event, link),
						});
					}
					callback(links.length ? links : undefined);
				})
				// A failed `path_kinds` means no links on this line, which is exactly
				// what the reader sees when there are none. Nothing to surface.
				.catch(() => callback(undefined));
		},
	};
}
