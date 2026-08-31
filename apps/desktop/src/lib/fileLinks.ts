/**
 * Turning text the agent printed into a path you can open (specs/05-features.md
 * F19).
 *
 * Pure apart from `classify`, and deliberately free of xterm: the buffer
 * walking that finds the text lives next to the terminal, in
 * `components/terminal/fileLinkProvider.ts`. This half is the part a second
 * consumer — a rendered transcript — would reuse unchanged, and the split
 * exists so that it can be, not because it is being.
 *
 * POSIX separators throughout, like `lib/paths.ts`: macOS and Linux only.
 */

import type { PathKind } from '@factorai/types';
import { cmd } from '@lib/tauri';

/** Characters a path can be made of. Deliberately excludes `:` — a colon is
 *  handled as the `:line:col` suffix, which is also what keeps `see:src/foo.ts`
 *  and a `12:34:56` timestamp from being read as paths. Also excludes the space,
 *  which is F19's one stated limit: nothing in the output quotes a path, so
 *  there is no way to know where one with a space in it ends. */
const TOKEN = /[A-Za-z0-9_@+~./-]+/g;

/** A `:42` or `:42:7` immediately after a token. */
const POSITION = /^:(\d+)(?::(\d+))?/;

/** Anything with a scheme is F5's job, and `WebLinksAddon` has already claimed
 *  the range. Two providers offering a link on the same cells is a fight the
 *  user watches, so these spans are cut out before tokenising. */
const URL_SPAN = /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'`<>{}|\\^]*/g;

/** A dotfile with no extension: `.gitignore`, `.env.local`. */
const DOTFILE = /^\.[A-Za-z][\w.-]*$/;

/** A filename with an extension. The extension must **start with a letter**,
 *  which is the whole reason `v2.1.235` and `1.2.3` don't become candidates —
 *  version strings are the most common path-shaped thing in an agent's output
 *  that is not a path. */
const DOTTED = /^[\w@+~-][\w@+~.-]*\.[A-Za-z][\w-]{0,8}$/;

/** Where a candidate sits in the text it was found in, and what it says. */
interface PathCandidate {
	/** Offset of the first character, into the text passed to `findCandidates`. */
	start: number;
	/** Offset one past the last character, suffix included. */
	end: number;
	/** The path as written — before `~` expansion or base resolution. */
	raw: string;
	line: number | null;
	col: number | null;
}

/**
 * Is this token shaped like a path at all?
 *
 * A cheap pre-filter, not a decision: `path_kinds` makes the decision, and this
 * only keeps us from asking the disk about every word on the line. It is
 * therefore allowed to be generous — `e.g` gets through and comes back missing,
 * which costs one entry in a batch nobody sees.
 *
 * A bare word with neither a separator nor an extension is rejected, which is
 * what keeps the sentence "run the test" from linking a `test/` directory. The
 * cost is that `Makefile` and `Dockerfile` are not links; that is the trade F19
 * takes, and it is stated there.
 */
export function looksLikePath(token: string): boolean {
	if (!token) return false;
	if (token.includes('/')) return token.replace(/\//g, '') !== '';
	return DOTFILE.test(token) || DOTTED.test(token);
}

/** Spans of `text` that are URLs, so tokenising can skip them. */
function urlSpans(text: string): Array<[number, number]> {
	const spans: Array<[number, number]> = [];
	URL_SPAN.lastIndex = 0;
	let m: RegExpExecArray | null = URL_SPAN.exec(text);
	while (m) {
		spans.push([m.index, m.index + m[0].length]);
		m = URL_SPAN.exec(text);
	}
	return spans;
}

/**
 * Every path-shaped run in one line of text, with its `:line:col` if it had
 * one.
 *
 * Trailing `.`, `,` and `;` are dropped: a path at the end of a sentence keeps
 * the full stop and a path in a list keeps the comma, and neither is part of
 * the name. `..` therefore trims to nothing and is not a candidate, which is
 * correct — `cd ..` is not an invitation to open anything.
 */
export function findCandidates(text: string): PathCandidate[] {
	const skip = urlSpans(text);
	const out: PathCandidate[] = [];

	TOKEN.lastIndex = 0;
	let m: RegExpExecArray | null = TOKEN.exec(text);
	while (m) {
		const start = m.index;
		const tokenEnd = start + m[0].length;
		const inUrl = skip.some(([a, b]) => start < b && tokenEnd > a);

		if (!inUrl) {
			const raw = m[0].replace(/[.,;]+$/, '');
			if (raw && looksLikePath(raw)) {
				const suffix = POSITION.exec(text.slice(tokenEnd));
				out.push({
					start,
					end: start + raw.length + (suffix?.[0].length ?? 0),
					raw,
					line: suffix ? Number(suffix[1]) : null,
					col: suffix?.[2] ? Number(suffix[2]) : null,
				});
			}
		}
		m = TOKEN.exec(text);
	}

	return out;
}

/** Collapse `.` and `..` segments and duplicate separators. Purely textual —
 *  symlinks are the filesystem's business, and `path_kinds` asks it. */
export function normalizePosix(path: string): string {
	const absolute = path.startsWith('/');
	const out: string[] = [];
	for (const segment of path.split('/')) {
		if (!segment || segment === '.') continue;
		if (segment === '..') {
			// A `..` that would climb past the root is dropped, not kept: `/..`
			// is `/` on every filesystem we target.
			if (out.length && out[out.length - 1] !== '..') out.pop();
			else if (!absolute) out.push('..');
			continue;
		}
		out.push(segment);
	}
	const joined = out.join('/');
	return absolute ? `/${joined}` : joined;
}

/** Where a relative path might be rooted. */
export interface ResolveContext {
	/** Absolute directories to try, in order. F19's chain is the session's cwd
	 *  and then the project root. */
	bases: string[];
	/** Absolute home directory for `~`, or null when there isn't one to expand
	 *  against (browser-only). */
	home: string | null;
}

/**
 * Absolute paths a candidate could mean, best guess first.
 *
 * More than one only for a relative path, and the ambiguity is resolved by the
 * disk rather than here: the caller asks about all of them and takes the first
 * that exists. That is what makes the cwd → project-root fallback safe.
 */
export function candidatePaths(raw: string, ctx: ResolveContext): string[] {
	if (raw.startsWith('/')) return [normalizePosix(raw)];

	if (raw === '~' || raw.startsWith('~/')) {
		if (!ctx.home) return [];
		return [normalizePosix(`${ctx.home}/${raw.slice(1)}`)];
	}

	const seen = new Set<string>();
	for (const base of ctx.bases) {
		if (!base) continue;
		seen.add(normalizePosix(`${base}/${raw}`));
	}
	return [...seen];
}

// ── Kind cache ─────────────────────────────────────────────────────────────
//
// `provideLinks` runs on mouse move, so the same line is asked about many times
// over. A plain Map rather than a query key: nothing renders from this, and it
// is read from inside an xterm callback, outside React entirely.
//
// **Positives are cached forever and negatives expire.** The asymmetry is the
// point. A file that exists will still exist, so remembering it costs nothing
// and is the common case. A path that is missing may be one the agent is about
// to write — caching that answer permanently would make a file created two
// seconds ago permanently unclickable, and the failure would look like the link
// detection is broken rather than stale.

const NEGATIVE_TTL_MS = 10_000;

/** Past this the map is thrown away wholesale rather than evicted cleverly. A
 *  session that has hovered 5000 distinct paths has long since stopped caring
 *  about the first one. */
const MAX_ENTRIES = 5000;

interface CacheEntry {
	kind: PathKind;
	/** Only set for `missing`; a positive never expires. */
	expiresAt: number | null;
}

const cache = new Map<string, CacheEntry>();

/** Test seam: `Date.now` is not something a unit test should have to wait on. */
export function clearKindCache(): void {
	cache.clear();
}

function cached(path: string, now: number): PathKind | undefined {
	const hit = cache.get(path);
	if (!hit) return undefined;
	if (hit.expiresAt !== null && hit.expiresAt <= now) {
		cache.delete(path);
		return undefined;
	}
	return hit.kind;
}

/**
 * What each of these paths is, asking the backend only about the ones not
 * already known.
 *
 * One `path_kinds` call for the whole batch — the caller is a hovered line and
 * a line can hold several candidates.
 */
export async function classify(paths: string[], now = Date.now()): Promise<Map<string, PathKind>> {
	const known = new Map<string, PathKind>();
	const ask: string[] = [];

	for (const path of paths) {
		const hit = cached(path, now);
		if (hit) known.set(path, hit);
		else if (!ask.includes(path)) ask.push(path);
	}

	if (ask.length) {
		const kinds = await cmd.pathKinds(ask);
		if (cache.size + ask.length > MAX_ENTRIES) cache.clear();
		ask.forEach((path, i) => {
			const kind = kinds[i] ?? 'missing';
			cache.set(path, { kind, expiresAt: kind === 'missing' ? now + NEGATIVE_TTL_MS : null });
			known.set(path, kind);
		});
	}

	return known;
}

/** Is `path` inside `base`, or `base` itself? Prefix matching on a separator
 *  boundary, so `/project2` is not inside `/project`. */
function isUnder(path: string, base: string): boolean {
	const root = base.endsWith('/') ? base.slice(0, -1) : base;
	return path === root || path.startsWith(`${root}/`);
}

/** A candidate that turned out to be real, and therefore is a link. */
export interface ResolvedLink extends PathCandidate {
	/** Absolute, normalised. */
	path: string;
	kind: 'file' | 'directory';
}

/**
 * Every link in one line of text: find the candidates, resolve each against the
 * bases, ask the disk once, and keep the ones that are really there.
 *
 * A candidate with several possible bases takes the first that exists, which is
 * how "session cwd, then project root" resolves without either side knowing
 * about the other.
 */
export async function resolveLinks(text: string, ctx: ResolveContext): Promise<ResolvedLink[]> {
	const candidates = findCandidates(text);
	if (!candidates.length) return [];

	const options = candidates.map((c) => candidatePaths(c.raw, ctx));
	const kinds = await classify([...new Set(options.flat())]);

	const links: ResolvedLink[] = [];
	candidates.forEach((candidate, i) => {
		for (const path of options[i]) {
			const kind = kinds.get(path);
			if (kind === 'file') {
				links.push({ ...candidate, path, kind });
				return;
			}
			// A directory is only a link if the tree can show it, and the tree only
			// shows this project. `~/.claude/projects/` exists and is interesting,
			// and clicking it would do nothing at all — a link that underlines and
			// then ignores you is worse than plain text.
			if (kind === 'directory' && ctx.bases.some((base) => isUnder(path, base))) {
				links.push({ ...candidate, path, kind });
				return;
			}
		}
	});
	return links;
}
