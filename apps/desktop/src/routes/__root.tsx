import { createRootRoute, Outlet } from '@tanstack/react-router';
import { useEffect } from 'react';
import { QuitConfirm } from '@components/dialog/QuitConfirm';
import { AppShell } from '@components/layout/AppShell';
import { FileViewerModal } from '@components/viewer/FileViewerModal';
import { type DiffMode, isDiffMode, useFileViewer } from '@hooks/useFileViewer';
import { useNativeContextMenu } from '@hooks/useNativeContextMenu';
import { useSessionsSync } from '@hooks/useSessionsSync';
import { cmd, events } from '@lib/tauri';
import { useIndexerStore } from '@store/indexerStore';
import { useTerminalStore } from '@store/terminalStore';

function RootLayout() {
	const setProgress = useIndexerStore((s) => s.setProgress);
	const viewer = useFileViewer();

	// The WebView's own menu is a browser's, and this is not a browser.
	useNativeContextMenu();

	// `sessions:changed` → refetch the session lists, app-wide. See the hook for
	// why this can't live on a route.
	useSessionsSync();

	useEffect(() => {
		let unlisten: (() => void) | undefined;
		events
			.onIndexerProgress((p) => setProgress(p))
			.then((fn) => {
				unlisten = fn;
			});
		return () => unlisten?.();
	}, [setProgress]);

	// Adopt whatever Rust is already running. A renderer reload keeps every PTY
	// alive and throws this store away, so without this the tabs vanish off
	// processes that are still very much running — which is what the crash
	// screen's "reloading keeps your sessions alive" has been promising while
	// `terminal_list` had no caller on this side at all.
	//
	// Runs before the listeners below in source order but not in effect order,
	// and it does not matter: `adoptLive` merges, and a `terminal:exit` that
	// lands first simply finds nothing to remove.
	useEffect(() => {
		void cmd
			.terminalList()
			.then((live) => useTerminalStore.getState().adoptLive(live))
			// Nothing to surface: with no adopted terminals the app behaves exactly
			// as it did before this call existed.
			.catch((e) => console.error('terminal_list failed', e));
	}, []);

	// App-wide terminal lifecycle: keep the running indicator accurate no
	// matter which route is mounted. `terminal:status` updates a live
	// terminal's status; `terminal:exit` drops it from the store.
	useEffect(() => {
		let unStatus: (() => void) | undefined;
		let unExit: (() => void) | undefined;
		events
			.onTerminalStatus((e) => useTerminalStore.getState().setStatus(e.id, e.status))
			.then((fn) => {
				unStatus = fn;
			});
		events
			.onTerminalExit((e) => useTerminalStore.getState().removeByTerminal(e.id))
			.then((fn) => {
				unExit = fn;
			});
		return () => {
			unStatus?.();
			unExit?.();
		};
	}, []);

	return (
		<>
			<AppShell>
				<Outlet />
			</AppShell>
			<FileViewerModal
				path={viewer.path}
				diff={viewer.diff}
				onClose={viewer.close}
				onOpenPath={viewer.open}
			/>
			<QuitConfirm />
		</>
	);
}

export const rootRoute = createRootRoute({
	// `?file=` drives the file viewer (F7). Declared on the *root* because the
	// viewer is app-level, mounted here beside QuitConfirm: every route then
	// inherits the param, which is what lets `useFileViewer` update it without
	// knowing which route is mounted. See hooks/useFileViewer.ts.
	// `&diff=` turns the same viewer into a diff of that file (F13); the modes
	// are validated here so a hand-edited URL can't reach the editor.
	validateSearch: (search: Record<string, unknown>): { file?: string; diff?: DiffMode } => ({
		file: typeof search.file === 'string' && search.file ? search.file : undefined,
		diff: isDiffMode(search.diff) ? search.diff : undefined,
	}),
	component: RootLayout,
});
