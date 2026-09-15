import { getCurrentWindow } from '@tauri-apps/api/window';
import { useMemo } from 'react';
import { useActiveProject } from '@hooks/useActiveProject';
import { useSettingsModal } from '@hooks/useSettingsModal';
import { useShortcuts } from '@hooks/useShortcuts';
import { useStartSession } from '@hooks/useStartSession';
import { usePanelStore } from '@store/panelStore';
import { useSidebarStore } from '@store/sidebarStore';

/**
 * The bindings that mean the same thing wherever you are (F28, ADR-0046).
 *
 * Called once, at the shell. The context-dependent ones are **not** here:
 * `Mod+F` inside a viewer and `Mod+W` over a tab strip register at whoever owns
 * that focus, because the alternative is this hook importing the viewer's find
 * handle and both tab strips' close paths to ask what is focused.
 */
export function useGlobalShortcuts(): void {
	const { projectId } = useActiveProject();
	const startSession = useStartSession();
	const settings = useSettingsModal();
	const togglePanel = usePanelStore((s) => s.toggle);
	const focusSearch = useSidebarStore((s) => s.focusSearch);

	const handlers = useMemo(
		() => ({
			// Nothing to start a session *in* off a route with no project — the
			// sidebar's own button is absent there for the same reason.
			newSession: () => {
				if (projectId) void startSession(projectId);
			},
			focusSidebarSearch: focusSearch,
			// The other half of this action lives in `ViewerPane`: with the editor
			// focused the chord is find, and it never reaches here.
			findOrSearch: focusSearch,
			toggleFilePanel: togglePanel,
			// Q24: opens and focuses, and does nothing when settings is already
			// open. `open()` on an open section is exactly that — it writes the
			// same `?settings=` it already has.
			openSettings: () => settings.open(),
			// **The window close, not an exit.** Going through `CloseRequested` is
			// what runs ADR-0020's quit guard and `kill_all()`; calling
			// `app_quit_confirmed` here would kill live sessions with no ask.
			// macOS never reaches this — the menu owns Cmd+Q — and `useShortcuts`
			// drops the registration there.
			quit: () => void getCurrentWindow().close(),
		}),
		[projectId, startSession, focusSearch, togglePanel, settings],
	);

	useShortcuts(handlers);
}
