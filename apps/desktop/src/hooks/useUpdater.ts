import { useEffect } from 'react';
import { isTauri, mockStagedUpdate, recordMockCall } from '@lib/tauri';
import { type UpdatePhase, useUpdaterStore } from '@store/updaterStore';

/** How often to look for a new release while the app is open.
 *
 *  factorai is meant to sit open for days beside running agents, so a
 *  launch-only check would rarely fire. One request for a static JSON. */
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** How long "Up to date" lingers before the control goes quiet again. */
const UP_TO_DATE_MS = 4000;

/**
 * Auto-update against the GitHub release manifest (specs/05-features.md F14).
 *
 * The flow is deliberately quiet: check, download and install happen with no UI
 * at all, and a surface only says anything once there is a version sitting on
 * disk waiting for a restart. Nothing is ever restarted for you — an agent may
 * be mid-run in the terminal below, and losing that to a version bump would be
 * a far worse bug than being one release behind.
 *
 * **The state lives in `updaterStore` and the behaviour lives here**
 * (ADR-0050). This module owns the timer, the plugin imports and the
 * one-install-per-run guard; `useUpdaterRuntime` is mounted exactly once, by
 * `AppShell`. Everything else — the sidebar badge, its copy in the rail's
 * overflow menu, the About section — subscribes through `useUpdater` and starts
 * nothing by rendering.
 *
 * Everything is imported lazily so the browser-only dev loop (and Playwright)
 * never loads the plugin: outside Tauri this reports `idle` and consults the
 * fixture instead.
 */
async function check(manual = false): Promise<void> {
	const { installed, setInstalled, setState } = useUpdaterStore.getState();
	if (installed) return;
	if (manual) setState({ phase: 'checking' });
	if (!isTauri()) {
		// Browser-only dev and the Playwright lane: the plugin isn't there to
		// talk to, so the badge is driven from the fixture instead.
		const staged = mockStagedUpdate();
		if (staged) {
			setInstalled(true);
			setState({ phase: 'ready', version: staged });
		} else if (manual) {
			setState({ phase: 'upToDate' });
		}
		return;
	}
	// Inside a real webview — but never in a dev build. `pnpm dev` runs an
	// unpackaged binary whose version (0.1.0 in tauri.conf) trails every
	// release, so the updater finds an "update" on each launch, downloads
	// ~80MB, and offers to restart the developer into a release build of the
	// code they are editing. Checked *after* the browser-only branch above:
	// the Playwright lane is also a dev build, and its fixture-driven badge
	// must keep working.
	if (import.meta.env.DEV) return;
	try {
		const { check: checkForUpdate } = await import('@tauri-apps/plugin-updater');
		const update = await checkForUpdate();
		if (!update) {
			if (manual) setState({ phase: 'upToDate' });
			return;
		}

		setInstalled(true);
		setState({ phase: 'downloading', version: update.version });
		// Downloads and applies in one call; on macOS this swaps the .app and
		// on Linux the AppImage, neither of which touches the running process.
		await update.downloadAndInstall();
		setState({ phase: 'ready', version: update.version });
	} catch (e) {
		// An update that can't be fetched is not worth a modal: the app works,
		// it's just not the newest. Surfaced quietly, logged for diagnosis.
		setInstalled(false);
		setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
		console.error('update check failed', e);
	}
}

/** Check now rather than waiting for the poll. Surfaced in the footer and in
 *  About so the updater is observable at all — otherwise its only visible state
 *  is the badge that appears hours later. */
function checkNow(): void {
	void check(true);
}

/**
 * Relaunch into the staged version.
 *
 * **Never call this without `needsQuitConfirm` first** — `relaunch()` tears the
 * process down and takes every live PTY with it, and it never fires
 * `CloseRequested`, so the quit guard does not see it (ADR-0005, ADR-0020).
 * `RestartConfirm` is the component that owns that question for both doors.
 */
export function restart(): void {
	if (!isTauri()) {
		recordMockCall('relaunch');
		return;
	}
	void (async () => {
		const { relaunch } = await import('@tauri-apps/plugin-process');
		// No kill_all() here: relaunch tears the process down, and `Drop` on
		// TerminalManager takes the PTYs with it (ADR-0005).
		await relaunch();
	})();
}

/**
 * The updater itself: the launch check, the six-hour poll and the "Up to date"
 * fade. **Mounted once, by `AppShell`** — mounting a second one would double the
 * poll, which is the bug ADR-0050 exists to end.
 */
export function useUpdaterRuntime(): void {
	const phase = useUpdaterStore((s) => s.state.phase);

	useEffect(() => {
		void check();
		const timer = setInterval(() => void check(), UPDATE_CHECK_INTERVAL_MS);
		return () => clearInterval(timer);
	}, []);

	// "Up to date" is an acknowledgement, not a state worth keeping: let it fade
	// so the control settles back to its quiet label.
	useEffect(() => {
		if (phase !== 'upToDate') return;
		const timer = setTimeout(
			() => useUpdaterStore.getState().setState({ phase: 'idle' }),
			UP_TO_DATE_MS,
		);
		return () => clearTimeout(timer);
	}, [phase]);
}

/**
 * The quiet label for every phase but `ready`, which is a badge rather than a
 * label. Shared by the footer badge and the About row so the two cannot word
 * the same state differently (F29).
 */
export function updateLabel(phase: UpdatePhase['phase']): string {
	switch (phase) {
		case 'checking':
			return 'Checking…';
		case 'upToDate':
			return 'Up to date';
		case 'downloading':
			return 'Downloading update…';
		// `error` deliberately falls through to the idle label: a failed check
		// means the app is simply not the newest, which is not worth a red line
		// in the footer forever.
		default:
			return 'Check for updates';
	}
}

/** What a surface showing the updater needs: the phase, and the two things a
 *  human can do about it. Subscribing costs nothing and starts nothing. */
export function useUpdater(): {
	state: UpdatePhase;
	checkNow: () => void;
	restart: () => void;
} {
	const state = useUpdaterStore((s) => s.state);
	return { state, checkNow, restart };
}
