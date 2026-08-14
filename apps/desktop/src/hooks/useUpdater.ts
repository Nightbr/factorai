import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri } from '@lib/tauri';

/** How often to look for a new release while the app is open.
 *
 *  factorai is meant to sit open for days beside running agents, so a
 *  launch-only check would rarely fire. One request for a static JSON. */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type UpdateState =
	| { phase: 'idle' }
	| { phase: 'downloading'; version: string }
	| { phase: 'ready'; version: string }
	| { phase: 'error'; message: string };

/**
 * Auto-update against the GitHub release manifest (specs/05-features.md F14).
 *
 * The flow is deliberately quiet: check, download and install happen with no UI
 * at all, and the header only says anything once there is a version sitting on
 * disk waiting for a restart. Nothing is ever restarted for you — an agent may
 * be mid-run in the terminal below, and losing that to a version bump would be
 * a far worse bug than being one release behind.
 *
 * Everything is imported lazily so the browser-only dev loop (and Playwright)
 * never loads the plugin: outside Tauri this hook is inert and reports `idle`.
 */
export function useUpdater(): {
	state: UpdateState;
	restart: () => void;
} {
	const [state, setState] = useState<UpdateState>({ phase: 'idle' });
	// One install per app run: once a version is staged, further checks would
	// only find the same release and re-download it.
	const installed = useRef(false);

	const check = useCallback(async () => {
		if (!isTauri() || installed.current) return;
		try {
			const { check: checkForUpdate } = await import('@tauri-apps/plugin-updater');
			const update = await checkForUpdate();
			if (!update) return;

			installed.current = true;
			setState({ phase: 'downloading', version: update.version });
			// Downloads and applies in one call; on macOS this swaps the .app and
			// on Linux the AppImage, neither of which touches the running process.
			await update.downloadAndInstall();
			setState({ phase: 'ready', version: update.version });
		} catch (e) {
			// An update that can't be fetched is not worth a modal: the app works,
			// it's just not the newest. Surfaced quietly, logged for diagnosis.
			installed.current = false;
			setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
			console.error('update check failed', e);
		}
	}, []);

	useEffect(() => {
		void check();
		const timer = setInterval(() => void check(), UPDATE_CHECK_INTERVAL_MS);
		return () => clearInterval(timer);
	}, [check]);

	const restart = useCallback(() => {
		void (async () => {
			const { relaunch } = await import('@tauri-apps/plugin-process');
			// No kill_all() here: relaunch tears the process down, and `Drop` on
			// TerminalManager takes the PTYs with it (ADR-0005).
			await relaunch();
		})();
	}, []);

	return { state, restart };
}
