/**
 * The one preference that changes stores when F11 lands: `diffInline`, out of
 * `factorai.panel` and into `factorai.prefs` (ADR-0013).
 *
 * **Why this is its own module rather than four lines in `prefsStore`.** Both
 * stores are `zustand/persist` on localStorage and both hydrate at import time,
 * so which of them touches `factorai.panel` first is decided by module import
 * order — and `panelStore`'s v3 migration rewrites that key without
 * `diffInline` in it. A snapshot taken lazily inside `prefsStore` would
 * therefore read the value *or* read nothing depending on which file Vite
 * happened to load first, which is the worst kind of bug to own: it works on
 * your machine.
 *
 * Both stores import this, so the read is guaranteed to happen before either of
 * them writes. A boolean is a small thing to protect this carefully; silently
 * resetting a choice somebody made is not a small thing.
 */

const PANEL_KEY = 'factorai.panel';

let snapshot: boolean | undefined;
let taken = false;

/**
 * `diffInline` as `factorai.panel` held it, or `undefined` when it was never
 * persisted there — a fresh install, or one whose panel state predates the
 * key. Memoised on first call, which is the point: later callers get what was
 * on disk before anything in this session wrote to it.
 */
export function legacyDiffInline(): boolean | undefined {
	if (taken) return snapshot;
	taken = true;
	snapshot = read();
	return snapshot;
}

function read(): boolean | undefined {
	// Guarded for the same reason zustand guards it: this module is imported by
	// stores that unit tests load without a DOM.
	if (typeof localStorage === 'undefined') return undefined;
	try {
		const raw = localStorage.getItem(PANEL_KEY);
		if (!raw) return undefined;
		const parsed = JSON.parse(raw) as { state?: { diffInline?: unknown } };
		const value = parsed.state?.diffInline;
		return typeof value === 'boolean' ? value : undefined;
	} catch {
		// Unparseable storage is storage we have no preference in. Throwing here
		// would take the whole store's hydration with it.
		return undefined;
	}
}

/** Test seam: forget the snapshot so a case can install its own storage.
 *  Never called in app code — the memo is what makes the ordering safe. */
export function resetDiffInlineHandover(): void {
	taken = false;
	snapshot = undefined;
}
