import { IconButton } from '@factorai/ui';
import { Maximize2 } from 'lucide-react';
import { Suspense } from 'react';
import { FileTabs } from '@components/viewer/FileTabs';
import { LazyDiffView, LazyFileView } from '@components/viewer/lazyViews';
import { useFileViewer } from '@hooks/useFileViewer';
import { tabsFor, useViewerStore, type ViewerTab } from '@store/viewerStore';

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
 */
export function ViewerPane() {
	const viewer = useFileViewer();
	const checkout = useViewerStore((s) => s.checkout);
	const tabs = useViewerStore((s) => tabsFor(s, s.checkout));
	const pinTab = useViewerStore((s) => s.pinTab);
	const closeTab = useViewerStore((s) => s.closeTab);
	const setExpanded = useViewerStore((s) => s.setExpanded);

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

	return (
		<div data-testid="file-viewer" className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
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
		</div>
	);
}
