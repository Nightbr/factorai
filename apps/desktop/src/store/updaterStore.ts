import type { UpdateChannel } from '@factorai/types';
import { create } from 'zustand';

/**
 * The updater's state, in one place for every surface that shows it
 * (specs/05-features.md F14, ADR-0050).
 *
 * **Why a store and not the hook it used to be.** `useUpdater` held the phase,
 * the six-hour interval and the one-install-per-run guard in component state, so
 * whoever mounted it owned an updater. `UpdateBadge` is mounted twice — inline
 * in the expanded sidebar footer, and inside the rail's overflow menu — and the
 * menu's copy mounts fresh every time it opens, which started a check with a new
 * guard and re-downloaded a release already staged. The About section (F29) is a
 * third surface and would have been a third updater.
 *
 * So the state lives here, the behaviour lives in `useUpdaterRuntime` (mounted
 * once by `AppShell`), and every consumer is a subscriber that starts nothing.
 *
 * **Not persisted.** An update staged in the last run was either applied at
 * relaunch or is gone; a phase restored from localStorage would announce a
 * restart that buys nothing.
 */

export type UpdatePhase =
	| { phase: 'idle' }
	| { phase: 'checking' }
	| { phase: 'upToDate' }
	| { phase: 'downloading'; version: string }
	| { phase: 'ready'; version: string }
	| { phase: 'error'; message: string };

interface UpdaterState {
	state: UpdatePhase;
	/** One install per app run: once a version is staged, further checks would
	 *  only find the same release and re-download it. In the store rather than a
	 *  ref, so it survives the badge unmounting with the menu that held it. */
	installed: boolean;
	/** Whether the restart confirmation is open. Here rather than in the
	 *  component so both doors — the footer badge and the About row — open the
	 *  one `RestartConfirm` with ADR-0020's sentence in it. */
	confirming: boolean;
	/** The channel the last check asked (ADR-0064), or null before one ran —
	 *  which is every dev build, where the updater never runs. Read by About
	 *  and by the crash screen, which must not call the bridge to learn it. */
	channel: UpdateChannel | null;
	setState: (state: UpdatePhase) => void;
	setInstalled: (installed: boolean) => void;
	setConfirming: (confirming: boolean) => void;
	setChannel: (channel: UpdateChannel) => void;
}

export const useUpdaterStore = create<UpdaterState>((set) => ({
	state: { phase: 'idle' },
	installed: false,
	confirming: false,
	channel: null,
	setState: (state) => set({ state }),
	setInstalled: (installed) => set({ installed }),
	setConfirming: (confirming) => set({ confirming }),
	setChannel: (channel) => set({ channel }),
}));
