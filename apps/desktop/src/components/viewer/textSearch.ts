/**
 * Text search for the surfaces that are not an editor
 * (specs/05-features.md F7 § "Find").
 *
 * Monaco owns finding in a file and in a diff, and it owns the *behaviour* this
 * mirrors: the same three toggles, the same wrap-around, the same
 * "1 of 9". What it cannot do is search a rendered markdown document, which is
 * a DOM tree and not a model.
 *
 * The matching is a pure function over a string on purpose. Walking the DOM and
 * painting the hits is `FindBar`'s job and needs a browser; deciding *what
 * matches* is arithmetic, and it is the half where an off-by-one is invisible
 * until a reader is looking at the wrong word.
 */

export interface SearchOptions {
	matchCase: boolean;
	wholeWord: boolean;
	isRegex: boolean;
}

/** A half-open range of character offsets into the searched string. */
interface Match {
	start: number;
	end: number;
}

/**
 * The regex a query and its toggles mean, or **null when the query is not a
 * usable pattern yet**.
 *
 * Null is a state, not a failure: `(` is what a reader typing `(\w+)` has after
 * one keystroke, and reporting it as an error would flash a complaint through
 * every partial pattern on the way to a whole one. The bar shows no matches and
 * says so, exactly as Monaco does.
 */
export function searchPattern(query: string, options: SearchOptions): RegExp | null {
	if (query === '') return null;

	let source: string;
	if (options.isRegex) {
		source = query;
	} else {
		source = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		// **Lookarounds, not `\b`, and the difference is Monaco's rule.** `\b` is
		// a transition between a word character and a non-word one, so `\b\(b\)\b`
		// never matches `(b)` — a query that starts with punctuation has no
		// boundary to find. Monaco asks something else: is the character on each
		// side of the match a word character? That matches `(b)` between spaces
		// and still refuses `find` inside `finder`, which is what whole-word
		// means to the reader. The escape comes first either way.
		if (options.wholeWord) source = `(?<!\\w)${source}(?!\\w)`;
	}

	try {
		return new RegExp(source, options.matchCase ? 'g' : 'gi');
	} catch {
		return null;
	}
}

/** Every match of `query` in `text`, in document order. */
export function findMatches(text: string, query: string, options: SearchOptions): Match[] {
	const pattern = searchPattern(query, options);
	if (!pattern) return [];

	const matches: Match[] = [];
	let hit = pattern.exec(text);
	while (hit !== null) {
		if (hit[0].length === 0) {
			// A pattern that can match nothing — `a*`, `^` — would otherwise sit
			// on one offset forever. Step past it rather than refusing the
			// pattern: `a*` on `banana` has real matches too.
			pattern.lastIndex += 1;
		} else {
			matches.push({ start: hit.index, end: hit.index + hit[0].length });
		}
		if (pattern.lastIndex > text.length) break;
		hit = pattern.exec(text);
	}
	return matches;
}

/**
 * Step to the next or previous match, wrapping at both ends.
 *
 * Wrapping and not clamping, because Monaco's `find.loop` default is on and two
 * find bars in one viewer that disagree about what `Enter` does at the last
 * match is the kind of difference a reader feels without being able to name.
 */
export function stepIndex(index: number, total: number, delta: number): number {
	if (total === 0) return 0;
	return (((index + delta) % total) + total) % total;
}

/** `1 of 9`, or Monaco's own words when there is nothing to count. */
export function matchLabel(index: number, total: number): string {
	if (total === 0) return 'No results';
	return `${index + 1} of ${total}`;
}
