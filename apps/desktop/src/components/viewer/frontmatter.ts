import { parse } from 'yaml';

/**
 * YAML frontmatter in a rendered markdown document (F7).
 *
 * Two jobs, both pure and both worth pinning in vitest rather than reading off
 * a screen: taking the fenced block off the front of a document, and turning
 * the YAML inside it into something a component can lay out without knowing
 * what YAML is.
 *
 * **Why this exists at all.** `react-markdown` has no frontmatter plugin, so
 * `---\ntitle: x\n---` was parsed as markdown: the fences became thematic
 * breaks or a setext heading and every field ran together into one paragraph
 * of prose. The metadata was on screen and unreadable, which is worse than
 * either showing it properly or not showing it.
 */

/** A value as the panel renders it, with YAML's types collapsed to the four
 *  shapes a layout actually distinguishes. */
export type FrontmatterValue =
	| { kind: 'text'; text: string }
	| { kind: 'empty' }
	| { kind: 'list'; items: FrontmatterValue[] }
	| { kind: 'map'; fields: FrontmatterField[] };

export interface FrontmatterField {
	key: string;
	value: FrontmatterValue;
}

export interface Frontmatter {
	/** The YAML between the fences, verbatim — what the failure card shows. */
	raw: string;
	/** Top-level fields in document order, or null if the block would not
	 *  parse or is not a mapping. */
	fields: FrontmatterField[] | null;
	/** One line saying why `fields` is null. */
	error: string | null;
}

/** Not exported: `splitFrontmatter`'s callers destructure it, and a second name
 *  for its return would be a shape to keep in step with nothing gained. */
interface SplitDocument {
	/** The frontmatter block, or null when the document has none. */
	frontmatter: Frontmatter | null;
	/** What is left for the markdown renderer. */
	body: string;
}

/** A closing fence is `---` or `...`, alone on its line (YAML allows both, and
 *  a document written by a tool may use either). */
const CLOSING_FENCE = /^(-{3}|\.{3})\s*$/;

/**
 * Take the frontmatter off the front of a document.
 *
 * **Only at the very start, and only when it closes.** A document whose first
 * line is `---` and which never fences again is a document that opens with a
 * thematic break, and turning that into a parse failure would put a card on
 * every one of them. A leading BOM is skipped, since the split has to happen
 * before anything has stripped one.
 */
export function splitFrontmatter(source: string): SplitDocument {
	const text = source.startsWith('\uFEFF') ? source.slice(1) : source;
	const lines = text.split(/\r?\n/);
	if (!/^-{3}\s*$/.test(lines[0] ?? '')) return { frontmatter: null, body: source };

	const close = lines.findIndex((line, i) => i > 0 && CLOSING_FENCE.test(line));
	if (close < 0) return { frontmatter: null, body: source };

	const raw = lines.slice(1, close).join('\n');
	const body = lines.slice(close + 1).join('\n');
	// An empty block is a formality somebody's generator left behind; there is
	// nothing to show and a panel saying so is noise.
	if (!raw.trim()) return { frontmatter: null, body };
	return { frontmatter: parseFrontmatter(raw), body };
}

/**
 * Parse one frontmatter block.
 *
 * `mapAsMap` is on so the top level arrives as a `Map`: a plain object reorders
 * integer-like keys, and frontmatter is read in the order it was written.
 */
export function parseFrontmatter(raw: string): Frontmatter {
	let parsed: unknown;
	try {
		parsed = parse(raw, { mapAsMap: true });
	} catch (err) {
		return { raw, fields: null, error: firstLine(err) };
	}
	if (!(parsed instanceof Map)) {
		// A block holding a list, or a bare string, is valid YAML and not
		// frontmatter — there are no fields to lay out, so it keeps its source.
		return { raw, fields: null, error: 'Frontmatter is not a set of fields.' };
	}
	return { raw, fields: fieldsOf(parsed), error: null };
}

function fieldsOf(map: Map<unknown, unknown>): FrontmatterField[] {
	return [...map].map(([key, value]) => ({ key: keyText(key), value: displayValue(value) }));
}

/** Keys are usually strings; YAML permits numbers, dates and worse, and the
 *  panel is a label column either way. */
function keyText(key: unknown): string {
	if (typeof key === 'string') return key;
	if (key === null || key === undefined) return '~';
	return String(key);
}

function displayValue(value: unknown): FrontmatterValue {
	if (value === null || value === undefined) return { kind: 'empty' };
	if (value instanceof Map) {
		const fields = fieldsOf(value);
		return fields.length ? { kind: 'map', fields } : { kind: 'empty' };
	}
	if (Array.isArray(value)) {
		const items = value.map(displayValue);
		return items.length ? { kind: 'list', items } : { kind: 'empty' };
	}
	// A timestamp only arrives with an explicit `!!timestamp` tag — the core
	// schema this parses under leaves `2026-08-24` a string, which is what the
	// author typed and what the reader expects to see.
	if (value instanceof Date) return { kind: 'text', text: value.toISOString().slice(0, 10) };
	const text = String(value);
	return text.trim() ? { kind: 'text', text } : { kind: 'empty' };
}

function firstLine(err: unknown): string {
	const message = err instanceof Error ? err.message : String(err);
	return message.split('\n')[0]?.trim() || 'Could not read this frontmatter.';
}

/** Whether a text value is a link the OS should open — the same two schemes a
 *  markdown link hands over, and no others. */
export function isExternalUrl(text: string): boolean {
	return /^(https?:\/\/|mailto:)\S+$/i.test(text.trim());
}
