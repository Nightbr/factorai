import type { ResolveContext, ResolvedLink } from '@lib/fileLinks';

/**
 * What a **path** link in a terminal does when it is clicked, and how the
 * provider that found it reaches React (specs/05-features.md F19).
 *
 * Its own module because **two terminals carry file links**: the agent's (F3)
 * and every pane of the project's footer shell (F23, F24). The provider is
 * registered once per pooled xterm, in `Terminal.tsx`, and what it needs — the
 * bases a relative path resolves against, the router, the panel store — only
 * exists inside a mounted component. This is the seam between the two, and it
 * belongs to the provider rather than to either terminal: the first version
 * kept the map in `Terminal.tsx` and keyed it by session id, so a shell pane's
 * key was never in it and every path a plain command printed stayed dead text.
 */

/** Where a resolved file link goes: the viewer for a file, the tree for a
 *  directory. Passed in rather than imported so this stays testable without a
 *  router, and so a terminal knows nothing about either destination. */
export interface FileLinkTargets {
	openInViewer: (path: string, position: { line?: number; col?: number }) => void;
	revealInTree: (path: string) => void;
}

/**
 * What a modifier-click on a path does (F19).
 *
 * The third kind of link in a terminal, and it takes the same gate as the other
 * two on purpose — see `onLinkActivated` in `Terminal.tsx`. The ambush argument
 * is if anything stronger here: throwing a near-fullscreen viewer over the
 * terminal you were reading is more disruptive than opening a browser beside it.
 *
 * The destination is the only thing that differs. A file the agent touched
 * belongs in the viewer (F7), not in whatever the OS says owns `.ts`.
 */
export function onFileLinkActivated(
	event: MouseEvent,
	link: ResolvedLink,
	targets: FileLinkTargets,
): void {
	if (!event.ctrlKey && !event.metaKey) return;
	if (link.kind === 'directory') {
		targets.revealInTree(link.path);
		return;
	}
	targets.openInViewer(link.path, {
		line: link.line ?? undefined,
		col: link.col ?? undefined,
	});
}

/** What the file-link provider needs from React, per terminal. Not exported:
 *  every caller passes it as a literal to `setFileLinkWiring`, so an exported
 *  name nothing imports is exactly what knip is for. */
interface FileLinkWiring {
	context: () => ResolveContext;
	activate: (event: MouseEvent, link: ResolvedLink) => void;
}

/** Keyed by the pooled xterm's key — a session id for an agent, a pane key for
 *  a shell. The pool is keyed the same way, which is what lets one provider
 *  registration serve both. */
const wiring = new Map<string, FileLinkWiring>();

/**
 * Wire the terminal `key` while a component is mounted. Returns the disposer,
 * so a `useEffect` can `return setFileLinkWiring(...)`.
 *
 * **An unmounted terminal therefore has no links**, which is right: there is
 * nothing on screen to hover, and opening a viewer for a terminal nobody is
 * looking at would be the ambush the modifier gate exists to prevent.
 *
 * The delete is identity-checked, so a re-register followed by the previous
 * cleanup — the order StrictMode and a fast remount can produce — cannot clear
 * the live wiring.
 */
export function setFileLinkWiring(key: string, entry: FileLinkWiring): () => void {
	wiring.set(key, entry);
	return () => {
		if (wiring.get(key) === entry) wiring.delete(key);
	};
}

/** The bases and home a path in this terminal resolves against. An empty chain
 *  for a terminal nothing has wired, which resolves nothing — see above. */
export function fileLinkContext(key: string): ResolveContext {
	return wiring.get(key)?.context() ?? { bases: [], home: null };
}

/** Hand a click on a resolved link to whatever is mounted on `key`. */
export function activateFileLink(key: string, event: MouseEvent, link: ResolvedLink): void {
	wiring.get(key)?.activate(event, link);
}
