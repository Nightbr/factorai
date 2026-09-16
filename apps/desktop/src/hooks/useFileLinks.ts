import { useEffect, useRef } from 'react';
import {
	type FileLinkTargets,
	onFileLinkActivated,
	setFileLinkWiring,
} from '@components/terminal/fileLinkWiring';
import { useFileViewer } from '@hooks/useFileViewer';
import { useRevealInTree } from '@hooks/useRevealInTree';
import type { ResolveContext } from '@lib/fileLinks';
import { homeDir } from '@lib/tauri';

interface FileLinkOptions {
	/** The pooled xterm's key — a session id for the agent, a pane key for a
	 *  shell. The same key the provider was registered with. */
	termKey: string;
	/** Absolute directories a relative path resolves against, best first, nulls
	 *  allowed so a caller can pass a root it has not resolved yet. */
	bases: Array<string | null>;
	/** What a directory link's reveal is rooted at — the project's own folder.
	 *  A directory outside it is not a link at all, which `resolveLinks`
	 *  enforces from `bases`, and this is where the tree then expands from. */
	treeRoot: string | null;
	/** Put the caret back in this terminal. Called after the viewer this
	 *  terminal opened is closed. */
	focus: () => void;
}

/**
 * Hand the file-link provider what it cannot reach on its own (F19).
 *
 * The provider is registered when the pooled terminal is built — ahead of
 * `WebLinksAddon`, for the ordering reason at its registration — and so it
 * outlives every component and can capture nothing. It reads through
 * `fileLinkWiring` instead, which this keeps current while a terminal is on
 * screen and clears when it is not.
 *
 * **One hook for both terminals that carry file links**: the agent's (F3) and
 * every pane of the project's footer shell (F23, F24). They differ only in
 * their bases and in which xterm takes the caret back, so a second copy of this
 * would be two surfaces free to drift about what a path click means.
 */
export function useFileLinks({ termKey, bases, treeRoot, focus }: FileLinkOptions): void {
	const { open: openInViewer, path: viewerPath } = useFileViewer();
	const revealInTree = useRevealInTree(treeRoot);

	/** Did the open viewer come from a link in *this* terminal? Decides whether
	 *  closing it hands focus back here — see the effect below. */
	const cameFromHereRef = useRef(false);

	// Read through a ref inside `provideLinks`, which runs on mouse move and
	// must not be re-registered every time a query resolves.
	const targetsRef = useRef<FileLinkTargets>({ openInViewer: () => {}, revealInTree });
	targetsRef.current = {
		openInViewer: (path, position) => {
			cameFromHereRef.current = true;
			openInViewer(path, position);
		},
		revealInTree,
	};

	// `home` is resolved once and cached by the bridge; until it lands, a `~/`
	// path just isn't a link yet.
	const homeRef = useRef<string | null>(null);
	useEffect(() => {
		void homeDir().then((h) => {
			homeRef.current = h;
		});
	}, []);

	const contextRef = useRef<ResolveContext>({ bases: [], home: null });
	contextRef.current = {
		bases: bases.filter((b): b is string => Boolean(b)),
		home: homeRef.current,
	};

	useEffect(
		() =>
			setFileLinkWiring(termKey, {
				context: () => contextRef.current,
				activate: (event, link) => onFileLinkActivated(event, link, targetsRef.current),
			}),
		[termKey],
	);

	// Read through a ref for the same reason the targets are: the closure a
	// caller passes is fresh on every render, and the effect below must fire on
	// the viewer closing rather than on a re-render.
	const focusRef = useRef(focus);
	focusRef.current = focus;

	/**
	 * Closing a viewer that was opened from this terminal puts the caret back in
	 * the terminal.
	 *
	 * Without it the sequence is: ctrl-click a path, read the file, press `Esc`,
	 * type — and the keystrokes go nowhere. The viewer's pane takes focus and
	 * gives it to `<body>` when the file it was showing closes (ADR-0047);
	 * **measured in the running app, not assumed** — an `x` typed after `Esc`
	 * never reached the prompt.
	 *
	 * Deferred by a tick because the close happens during the viewer's own
	 * unmount, so focusing synchronously here would simply be overwritten.
	 *
	 * Only when the viewer came from here. Opening a file from the tree and
	 * closing it should leave focus where the tree put it, not yank it into a
	 * terminal the reader was not using.
	 */
	useEffect(() => {
		if (viewerPath || !cameFromHereRef.current) return;
		cameFromHereRef.current = false;
		const timer = setTimeout(() => focusRef.current(), 0);
		return () => clearTimeout(timer);
	}, [viewerPath]);
}
