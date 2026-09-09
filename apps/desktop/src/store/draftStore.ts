import { create } from 'zustand';

/**
 * Unsaved edit buffers, keyed by absolute path (specs/05-features.md F26).
 *
 * **In memory, and deliberately so for now.** F26 § "Drafts" puts these in a
 * SQLite `file_drafts` table so they survive a quit, with the hash comparison
 * and the caps that go with it (ADR-0040). That is the next slice. What this
 * store buys today is the smaller half of the same promise: a buffer outlives
 * its tab. The viewer's strip switches files by swapping what `FileView` is
 * pointed at, so without somewhere to put the text, clicking another tab with
 * unsaved changes would discard them with no dialog and no dot — the exact
 * silent loss the feature exists to prevent.
 *
 * `zustand` rather than a module-level `Map` because the tab strip's dirty
 * marker subscribes to this in the next slice, and a Map cannot be subscribed
 * to. Nothing renders off it yet.
 *
 * No `persist`: a draft is content, not a preference, and localStorage is the
 * wrong store for it for the reasons ADR-0040 sets out. Reaching for
 * `persist` here would be choosing the store that decision rejected.
 */
interface DraftState {
	/** Path → the unsaved text. A path with no entry has no draft; a draft equal
	 *  to what is on disk is never written (see `FileView`). */
	drafts: Record<string, string>;
	setDraft: (path: string, contents: string) => void;
	clearDraft: (path: string) => void;
}

export const useDraftStore = create<DraftState>()((set) => ({
	drafts: {},
	setDraft: (path, contents) =>
		set((s) => (s.drafts[path] === contents ? s : { drafts: { ...s.drafts, [path]: contents } })),
	clearDraft: (path) =>
		set((s) => {
			if (!(path in s.drafts)) return s;
			const { [path]: _gone, ...rest } = s.drafts;
			return { drafts: rest };
		}),
}));

/** Read one draft without subscribing — what an effect wants on mount. */
export function draftFor(path: string): string | undefined {
	return useDraftStore.getState().drafts[path];
}
