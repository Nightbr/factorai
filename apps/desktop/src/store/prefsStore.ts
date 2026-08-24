import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { legacyDiffInline } from '@store/diffInlineHandover';

/**
 * User preferences the **renderer alone** reads (F11, ADR-0013).
 *
 * Three stores, split by who reads a value and how fast it is needed:
 * layout state (`panelStore`, `sidebarStore`, `zoomStore`) is dragged rather
 * than set, anything **Rust** must read goes in the SQLite `settings` table,
 * and everything left is here.
 *
 * **localStorage, synchronously.** An async store would hydrate a tick after
 * first paint, so every preference would show its default for a frame — which
 * for a switch is a lie on screen and for a width is a visible jump. That is
 * the whole reason `tauri-plugin-store` was removed rather than finally used.
 *
 * **This is not a merger of the other three.** Nobody sets a panel width in a
 * settings page, and keeping them apart means a future "reset settings" does
 * not also reset your window layout.
 */
interface PrefsState {
	/** Diff viewer: inline (unified) rather than side-by-side (F13).
	 *
	 *  Lived in `panelStore` until F11, for want of anywhere better. It arrives
	 *  here through a one-time read-across (`diffInlineHandover`), because a
	 *  preference that silently resets is worse than one that never moved. */
	diffInline: boolean;
	/** Ask before closing a live session with the `X` — the tab's and the
	 *  session header's, which are one gesture (F10, F16).
	 *
	 *  **On by default**, and only ever consulted while Claude is working:
	 *  `needsCloseConfirm` owns that half. Turning it off is the human setting
	 *  the rules agents run under (`00-overview.md` § "The operating model"),
	 *  not the app deciding an irreversible act isn't worth an ask. */
	confirmCloseSession: boolean;
	/** Ask before closing a live session by **middle-clicking** its tab.
	 *
	 *  A second switch rather than a row of the one above, because middle-click
	 *  has no aim to it: somebody who finds the question tedious on a deliberate
	 *  `×` may still want it on a stray wheel-click. No master switch — that
	 *  would produce a matrix with a dead cell and a UI that greys rows out to
	 *  explain itself. */
	confirmCloseMiddleClick: boolean;
	/** Start a markdown document's frontmatter panel open rather than collapsed
	 *  (F7).
	 *
	 *  **On by default**, for the same reason `restoreTabs` is: the fields were
	 *  already on screen before there was a panel to put them in — badly, as one
	 *  run-together paragraph — so a switch arriving after the behaviour must not
	 *  quietly take information away. It sets the state each document *opens* in;
	 *  the panel's own chevron is a peek and is deliberately not written back. */
	frontmatterOpen: boolean;
	/** Reopen the session tabs you had on launch (F16).
	 *
	 *  **On by default, and that default is settled by history rather than
	 *  taste**: restore shipped unconditionally because this surface did not
	 *  exist yet, so the switch arrives after the behaviour and must not
	 *  silently change what people already have. */
	restoreTabs: boolean;

	/** The diff footer's own toggle (F13), which sets the same value the Editor
	 *  section defaults: flipping it there is a choice about how you read diffs,
	 *  and it would be strange for the two to disagree about what "default"
	 *  means. The modal reads saved preferences when it opens, so a toggle made
	 *  behind it is picked up next time rather than fighting an open draft. */
	setDiffInline: (inline: boolean) => void;
	/** Replace every preference at once — what the settings modal's Save does.
	 *  One call rather than a setter per field, so a Save is one store write and
	 *  therefore one localStorage write, and a half-applied save cannot exist. */
	applyPrefs: (next: Prefs) => void;
}

/** The values, without the action. What Save hands in and what the draft
 *  diffing in `lib/settingsDraft.ts` compares. */
export type Prefs = Omit<PrefsState, 'applyPrefs' | 'setDiffInline'>;

/** The shipped defaults. Not exported: every reader wants the *current*
 *  preferences, and a second door onto the defaults is how a surface ends up
 *  showing one while the store holds the other. */
const DEFAULT_PREFS: Prefs = {
	diffInline: false,
	confirmCloseSession: true,
	confirmCloseMiddleClick: true,
	frontmatterOpen: true,
	restoreTabs: true,
};

export const usePrefsStore = create<PrefsState>()(
	persist(
		(set) => ({
			...DEFAULT_PREFS,
			// The handover, read before anything writes: see `diffInlineHandover`.
			// `persist` overwrites this with the stored value once there is one, so
			// it only decides the very first launch after the move.
			diffInline: legacyDiffInline() ?? DEFAULT_PREFS.diffInline,
			setDiffInline: (diffInline) => set({ diffInline }),
			applyPrefs: (next) => set({ ...next }),
		}),
		{
			name: 'factorai.prefs',
			version: 1,
			// Named `Prefs` rather than spelled out, so a preference added to the
			// interface and not to storage is a type error rather than a value that
			// quietly stops persisting.
			partialize: (s): Prefs => ({
				diffInline: s.diffInline,
				confirmCloseSession: s.confirmCloseSession,
				confirmCloseMiddleClick: s.confirmCloseMiddleClick,
				frontmatterOpen: s.frontmatterOpen,
				restoreTabs: s.restoreTabs,
			}),
		},
	),
);

/** The saved preferences as a plain object — what the settings modal opens its
 *  draft from, and what `settingsDraft` diffs against. */
export function currentPrefs(): Prefs {
	const s = usePrefsStore.getState();
	return {
		diffInline: s.diffInline,
		confirmCloseSession: s.confirmCloseSession,
		confirmCloseMiddleClick: s.confirmCloseMiddleClick,
		frontmatterOpen: s.frontmatterOpen,
		restoreTabs: s.restoreTabs,
	};
}
