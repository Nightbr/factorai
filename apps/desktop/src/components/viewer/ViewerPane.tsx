import { IconButton } from '@factorai/ui';
import { Maximize2 } from 'lucide-react';
import { type KeyboardEvent, Suspense, useEffect, useRef } from 'react';
import { FileTabs } from '@components/viewer/FileTabs';
import { FindHandleProvider, useFindHandleSlot } from '@components/viewer/findHandle';
import { ViewerHostProvider } from '@components/viewer/viewerHost';
import { useKeymap, useShortcuts } from '@hooks/useShortcuts';
import { stepTab } from '@lib/keymap';
import { matchesKeyboardEvent } from '@tanstack/react-hotkeys';
import { LazyDiffView, LazyFileView } from '@components/viewer/lazyViews';
import { useFileViewer } from '@hooks/useFileViewer';
import { tabsFor, useViewerStore, type ViewerTab, viewerFocusVerdict } from '@store/viewerStore';

/**
 * The viewer where it now lives: a pane with its own strip of open files
 * (F7, ADR-0037).
 *
 * Host-agnostic, the way `FileView` has been since F7 — `AppShell` renders this
 * in a column of its own, `FileTreePanel` renders the same component split
 * under the tree, and neither knows anything about the other. What decides
 * which is `resolveViewerHost`, not this.
 *
 * **One 36px strip, not two.** The tabs share their row with the pane's two
 * controls rather than taking a row above a header of their own: the column can
 * be 400px wide, and two rows of chrome over it would be a quarter of the
 * reading height gone before a line of the file is drawn.
 *
 * **`Cmd/Ctrl+F` is forwarded to the editor** (F7 § "Find"). Monaco's own
 * binding fires only when the editor has focus, so the key did nothing from the
 * tab strip or the expand button — the two places in this pane a reader's focus
 * lands without touching the file. Scoped to the pane and not global, exactly
 * as `Cmd/Ctrl+S` is: a global binding is item 5's problem to get right, and it
 * has a terminal to not break.
 *
 * **`Escape` closes the file that is showing** (ADR-0047), from anywhere in the
 * pane and nowhere else, with the find widget taking the first press when it is
 * open. A tab that is *not* the one showing closes by `Escape` on its own chip,
 * which `FileTabs` handles and stops there.
 */
export function ViewerPane() {
	const viewer = useFileViewer();
	const findSlot = useFindHandleSlot();
	const keymap = useKeymap();
	const checkout = useViewerStore((s) => s.checkout);
	const tabs = useViewerStore((s) => tabsFor(s, s.checkout));
	const pinTab = useViewerStore((s) => s.pinTab);
	const closeTab = useViewerStore((s) => s.closeTab);
	const setExpanded = useViewerStore((s) => s.setExpanded);
	const expanded = useViewerStore((s) => s.expanded);
	const focusRequest = useViewerStore((s) => s.focusRequest);
	const clearFocusRequest = useViewerStore((s) => s.clearFocusRequest);

	/**
	 * `Mod+W` closes the **file** tab while this pane has focus (F28).
	 *
	 * Scoped to the pane with `target`, which is how a context-dependent binding
	 * is expressed — the library has no named scopes. The session strip
	 * registers the same action on the document, and this one runs first and
	 * stops the event, so "the tab" means whichever strip you are looking at
	 * rather than a rule anybody has to remember.
	 *
	 * An unsaved draft is F26's problem exactly as it is for the tab's `×`:
	 * `closeTab` is the same call.
	 */
	const paneRef = useRef<HTMLDivElement>(null);
	const openPath = viewer.path;
	useShortcuts(
		{
			closeFocusedTab: () => {
				if (openPath) close(openPath);
			},
			// The file strip's half of the same two actions: with this pane focused
			// the tab keys step through open files, and the session strip's
			// registration never sees them.
			nextTab: () => stepToFile(1),
			previousTab: () => stepToFile(-1),
		},
		{ target: paneRef },
	);

	/** One file tab along, in strip order, wrapping (F28). */
	function stepToFile(delta: 1 | -1) {
		if (!openPath) return;
		const next = stepTab(
			tabs.map((t) => t.path),
			openPath,
			delta,
		);
		if (!next || next === openPath) return;
		const tab = tabs.find((t) => t.path === next);
		if (tab) show(tab);
	}

	/**
	 * **A file opened for a human lands with focus in the pane** (ADR-0048).
	 *
	 * Without it every key this pane owns is unreachable until the reader clicks
	 * the file they just asked for: `Escape` closes nothing, `Mod+W` closes the
	 * *session* tab, and the find forward never fires — the click that opened
	 * the file left focus on the tree row, on a Changes row, or in the terminal.
	 *
	 * The request is made in `useFileViewer.open` and collected here on the
	 * render that shows the path it was made for, because opening the first file
	 * is what mounts this pane. `viewerFocusVerdict` is the whole rule: focus
	 * already in the pane and the expanded modal both keep it where it is, and a
	 * request for a path that is not showing yet waits for the render that is.
	 */
	useEffect(() => {
		const pane = paneRef.current;
		if (!pane) return;
		const verdict = viewerFocusVerdict({
			request: focusRequest,
			showing: openPath,
			expanded,
			focusInside: pane.contains(document.activeElement),
		});
		if (verdict === 'wait') return;
		// Cleared on a `drop` as well, so a request the modal or a focused strip
		// declined cannot be collected by the next thing that re-runs this.
		clearFocusRequest();
		if (verdict === 'take') pane.focus();
	}, [focusRequest, openPath, expanded, clearFocusRequest]);

	if (!viewer.path) return null;

	/** Showing a tab restores the mode it was last read in — one path is one
	 *  tab whether you came to it from the tree or from the Changes list. */
	function show(tab: ViewerTab) {
		viewer.open(tab.path, { diff: tab.diff ?? undefined });
	}

	function close(path: string) {
		const next = closeTab(path, viewer.path);
		if (!next) {
			viewer.close();
			return;
		}
		const nextTab = tabsFor(useViewerStore.getState(), checkout).find((t) => t.path === next);
		viewer.open(next, { diff: nextTab?.diff ?? undefined });
	}

	/** Forward the key, or leave it alone. Monaco stops the event when it
	 *  handles it itself, so this only ever runs for a keystroke the editor
	 *  never saw.
	 *
	 *  **The chord comes from the keymap** (F28): this is the viewer half of
	 *  `findOrSearch`, and rebinding it in settings has to move both halves. The
	 *  shell's half never fires here — its registration ignores input-like
	 *  elements, and the editor is one. */
	function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		if (event.key === 'Escape') {
			onEscape(event);
			return;
		}
		const findKey = keymap.findOrSearch;
		if (!findKey || !matchesKeyboardEvent(event.nativeEvent, findKey)) return;
		const handle = findSlot.current;
		if (!handle) return;
		event.preventDefault();
		handle.open();
	}

	/**
	 * `Escape` closes the file the pane is showing (ADR-0047).
	 *
	 * **Anywhere in the pane, not only on a tab**: the editor, the rendered
	 * markdown, a diff, an image, the expand control. Focus in the pane is the
	 * whole scope — the terminal keeps its `Escape`, and so does everything
	 * outside the pane, because a key that closes files from wherever you are
	 * standing is a key that closes one while you are typing to the agent.
	 *
	 * **Find gets it first.** With the widget open this closes find and nothing
	 * else, so the sequence over a search is `Escape`, `Escape`. Monaco stops
	 * the keystroke itself when it handles one — a widget it closed, a selection
	 * it cleared, a suggestion it dismissed — so most of that never reaches
	 * here; the gate covers the preview's own bar, which does not.
	 */
	function onEscape(event: KeyboardEvent<HTMLDivElement>) {
		if (findSlot.current?.isRevealed()) return;
		if (!viewer.path) return;
		event.preventDefault();
		close(viewer.path);
		// **The pane takes focus back.** What focus was on was inside the view
		// this close unmounts — an editor, a preview — and the browser's answer to
		// that is `<body>`, from where a second `Escape` reaches the shell rather
		// than the file now showing. Focusing the pane keeps the run going, and
		// the next view is free to take focus off it again.
		paneRef.current?.focus();
	}

	return (
		<div
			ref={paneRef}
			data-testid="file-viewer"
			// **`tabIndex={-1}` so a click in the pane is focus in the pane.** A
			// rendered markdown document, an image and a PDF have nothing focusable
			// in them, so clicking one left focus on `<body>` and every key this
			// pane owns — `Escape`, the find forward, `Mod+W`, the tab steps — went
			// to the shell instead. Not tabbable: it is a click target for focus,
			// not a stop on the way to the strip.
			tabIndex={-1}
			className="flex min-h-0 min-w-0 flex-1 flex-col bg-background outline-none"
			onKeyDown={onKeyDown}
		>
			{/* `pr-2` against the button's own `ml-2`: 8px either side, so the one
			    control in this row sits centred in its slot rather than hugging the
			    edge it happens to be nearest. */}
			<div className="flex h-9 shrink-0 items-center border-border border-b bg-card pr-2">
				<FileTabs tabs={tabs} active={viewer.path} onOpen={show} onPin={pinTab} onClose={close} />
				{/* **Expand, and nothing else.** The close that used to sit here was the
				    active tab's `×` a second time, eight pixels away — two controls for
				    one act, and the one on the tab is the one that says *which* file it
				    closes. `ml-2` keeps it off the strip it scrolls beside.
				
				    What it opens is the demoted modal (ADR-0037), reached from here and
				    from nowhere else: a file lands in this pane, and the full view is
				    something you ask for when the column is too narrow to read in. */}
				<IconButton
					className="ml-2"
					aria-label="Expand to full view"
					title="Expand to full view"
					data-testid="viewer-expand"
					onClick={() => setExpanded(true)}
				>
					<Maximize2 />
				</IconButton>
			</div>

			{/* **This host names itself** (F7). Both hosts are mounted while the
			    modal is open, and `MediaView` is the one view for which that
			    matters — two players on one file is two soundtracks. */}
			<ViewerHostProvider value="pane">
				<FindHandleProvider value={findSlot}>
					<Suspense
						fallback={
							<p className="flex h-full items-center justify-center text-muted-foreground text-sm">
								Loading editor…
							</p>
						}
					>
						{viewer.diff ? (
							<LazyDiffView path={viewer.path} mode={viewer.diff} />
						) : (
							<LazyFileView
								path={viewer.path}
								position={viewer.position}
								onOpenPath={(path) => viewer.open(path)}
							/>
						)}
					</Suspense>
				</FindHandleProvider>
			</ViewerHostProvider>
		</div>
	);
}
