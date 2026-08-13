import { createRootRoute, Outlet } from '@tanstack/react-router';
import { useEffect } from 'react';
import { QuitConfirm } from '@components/dialog/QuitConfirm';
import { AppShell } from '@components/layout/AppShell';
import { FileViewerModal } from '@components/viewer/FileViewerModal';
import { useFileViewer } from '@hooks/useFileViewer';
import { events } from '@lib/tauri';
import { useIndexerStore } from '@store/indexerStore';
import { useTerminalStore } from '@store/terminalStore';

function RootLayout() {
	const setProgress = useIndexerStore((s) => s.setProgress);
	const viewer = useFileViewer();

	useEffect(() => {
		let unlisten: (() => void) | undefined;
		events
			.onIndexerProgress((p) => setProgress(p))
			.then((fn) => {
				unlisten = fn;
			});
		return () => unlisten?.();
	}, [setProgress]);

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
			<FileViewerModal path={viewer.path} onClose={viewer.close} />
			<QuitConfirm />
		</>
	);
}

export const rootRoute = createRootRoute({
	// `?file=` drives the file viewer (F7). Declared on the *root* because the
	// viewer is app-level, mounted here beside QuitConfirm: every route then
	// inherits the param, which is what lets `useFileViewer` update it without
	// knowing which route is mounted. See hooks/useFileViewer.ts.
	validateSearch: (search: Record<string, unknown>): { file?: string } => ({
		file: typeof search.file === 'string' && search.file ? search.file : undefined,
	}),
	component: RootLayout,
});
