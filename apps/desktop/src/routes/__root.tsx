import { createRootRoute, Outlet, useParams } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { QuitConfirm } from '@components/dialog/QuitConfirm';
import { AppShell } from '@components/layout/AppShell';
import { SettingsModal } from '@components/settings/SettingsModal';
import { FileViewerModal } from '@components/viewer/FileViewerModal';
import { type DiffMode, isDiffMode, parsePosition, useFileViewer } from '@hooks/useFileViewer';
import { useNativeContextMenu } from '@hooks/useNativeContextMenu';
import { useRoutineFires } from '@hooks/useRoutineFires';
import { useRoutinesChanged } from '@hooks/useRoutinesChanged';
import { useSessionsSync } from '@hooks/useSessionsSync';
import { useWatchedOpenFile } from '@hooks/useWatchedOpenFile';
import { useSettingsModal } from '@hooks/useSettingsModal';
import { isSettingsSection, type SettingsSection } from '@lib/settingsDraft';
import { cmd, events } from '@lib/tauri';
import { useIndexerStore } from '@store/indexerStore';
import { useTerminalStore } from '@store/terminalStore';

function RootLayout() {
	const setProgress = useIndexerStore((s) => s.setProgress);
	const viewer = useFileViewer();
	const settings = useSettingsModal();
	const { sessionId } = useParams({ strict: false }) as { sessionId?: string };

	// The `ide:open-file` listener is registered once for the app's life, so it
	// reads `open` through a ref rather than capturing the first one — a
	// listener re-subscribed on every navigation would drop events in the gap.
	const viewerOpenRef = useRef<(path: string, line?: number) => void>(() => {});
	viewerOpenRef.current = (path, line) => viewer.open(path, { line });

	// The WebView's own menu is a browser's, and this is not a browser.
	useNativeContextMenu();

	// `sessions:changed` → refetch the session lists, app-wide. See the hook for
	// why this can't live on a route.
	useSessionsSync();

	// `routine:fire` → start the session a routine came due for (F22). Here for
	// the same reason: a routine fires for a project no route is showing.
	useRoutineFires();
	useRoutinesChanged();

	// `file:changed` → re-read whatever the viewer has open (F7). Here rather
	// than in the viewer because this is where `?file=` lives, and the watch has
	// to be released when the viewer closes and the modal is gone.
	useWatchedOpenFile(viewer.path);

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

	// **Tell the backend what is on screen** (F20). The IDE bridge answers two
	// questions that depend on it and Rust cannot see the UI: `getOpenEditors`
	// has to name real files, and an `openFile` for a session that is not in
	// front must mark its tab rather than take the window. Reported from here
	// because this is the one component that outlives every route and already
	// holds the viewer's state.
	useEffect(() => {
		void cmd
			.ideReportUi({ activeSession: sessionId ?? null, openFile: viewer.path })
			// Nothing to surface: a report that goes missing leaves the bridge with
			// a stale-but-honest picture, and it errs towards marking a tab rather
			// than opening over the wrong session.
			.catch(() => undefined);
	}, [sessionId, viewer.path]);

	// The agent asked to show a file. `frontmost` was decided in Rust, from
	// whether this session is in front *and* whether the agent asked to be
	// intrusive — obeyed rather than re-decided here, so the rule lives in one
	// place.
	//
	// **A request for a session you are not looking at does nothing, and the
	// agent is told so.** It briefly put an amber dot on that session's tab,
	// which was wrong twice over: amber is `--color-status-waiting`'s exact
	// value, so it was indistinguishable from "this session is waiting for you",
	// and that dot could sit beside the status badge already on the same tab.
	// Where such a request should land is an open question — probably the toast
	// primitive roadmap item 7 wants — so until then the bridge reports honestly
	// that nothing was shown rather than claiming a mark nobody can see.
	useEffect(() => {
		let unlisten: (() => void) | undefined;
		events
			.onIdeOpenFile((e) => {
				if (e.frontmost) viewerOpenRef.current(e.path, e.line ?? undefined);
			})
			.then((fn) => {
				unlisten = fn;
			});
		return () => unlisten?.();
	}, []);

	// Where each session's bridge stands (F20). App-wide for the same reason the
	// terminal listeners are: the session you are looking at is not the only one
	// whose header has to be right when you get back to it.
	useEffect(() => {
		let unlisten: (() => void) | undefined;
		events
			.onIdeStatus((e) => useTerminalStore.getState().setIdeStatus(e.sessionId, e.error))
			.then((fn) => {
				unlisten = fn;
			});
		return () => unlisten?.();
	}, []);

	// Which checkout each session's agent is working in (F21). App-wide for the
	// same reason as the status above: a signal that arrives for a session you
	// are not looking at still has to be right when you come back to it, and the
	// panel decides for itself whether the signal concerns the route it is on.
	useEffect(() => {
		let unlisten: (() => void) | undefined;
		events
			.onSessionWorktree((e) =>
				useTerminalStore.getState().setWorktree(e.sessionId, e.path, e.branch),
			)
			.then((fn) => {
				unlisten = fn;
			});
		return () => unlisten?.();
	}, []);

	// ...and then ask every bridge to say where it stands, because a reload
	// keeps them all alive while throwing this store away. **After the listener
	// above, in source order**, since the answers arrive as ordinary
	// `ide:status` events — which is the point: a change racing this call lands
	// in order behind it rather than having to be merged with it.
	useEffect(() => {
		// Nothing to surface: without it the header behaves as it did before this
		// existed, and the next real event corrects it.
		void cmd.ideResync().catch((e) => console.error('ide_resync failed', e));
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
				position={viewer.position}
				onClose={viewer.close}
				onOpenPath={viewer.open}
			/>
			<SettingsModal
				section={settings.section}
				onSection={settings.open}
				onClose={settings.close}
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
	// `&line=` / `&col=` place the cursor (F19), 1-based, validated for the same
	// reason — Monaco should never be handed a position no file has.
	// `?settings=` opens the settings modal at one section (F11), here for the
	// same reasons `?file=` is: deep links, reload survival, back-closes.
	validateSearch: (
		search: Record<string, unknown>,
	): {
		file?: string;
		diff?: DiffMode;
		line?: number;
		col?: number;
		settings?: SettingsSection;
	} => ({
		file: typeof search.file === 'string' && search.file ? search.file : undefined,
		diff: isDiffMode(search.diff) ? search.diff : undefined,
		line: parsePosition(search.line),
		col: parsePosition(search.col),
		settings: isSettingsSection(search.settings) ? search.settings : undefined,
	}),
	component: RootLayout,
});
