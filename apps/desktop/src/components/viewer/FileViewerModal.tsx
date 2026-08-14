import { Dialog, DialogClose, DialogContent, DialogTitle, IconButton } from '@factorai/ui';
import { Check, Copy, ExternalLink, X } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import type { DiffMode } from '@hooks/useFileViewer';
import { openExternally } from '@lib/tauri';

// Monaco is the heaviest thing in the app, and the viewer is the only thing
// that needs it. Lazy-loading keeps it out of the initial bundle: the chunk is
// fetched from local disk the first time a file is opened (ADR-0007).
const FileView = lazy(() =>
	import('@components/viewer/FileView').then((m) => ({ default: m.FileView })),
);
const DiffView = lazy(() =>
	import('@components/viewer/DiffView').then((m) => ({ default: m.DiffView })),
);

function splitPath(path: string): { name: string; parent: string } {
	const i = path.lastIndexOf('/');
	return i >= 0
		? { name: path.slice(i + 1), parent: path.slice(0, i) }
		: { name: path, parent: '' };
}

interface FileViewerModalProps {
	/** Absolute path to show, or null for closed. Driven by `?file=`. */
	path: string | null;
	/** Diff mode from `&diff=`, or null to show the file itself (F13). */
	diff: DiffMode | null;
	onClose: () => void;
	/** Swap the viewer to another file — relative markdown links use this. */
	onOpenPath: (path: string) => void;
}

/**
 * V0 host for `FileView`: a near-fullscreen modal (specs/05-features.md F7).
 *
 * The per-project tab system will host the same `FileView` in a tab; only this
 * shell gets replaced. Dismissal (Esc, click-outside, the close button) all
 * route through `onClose`, which clears the URL param.
 */
export function FileViewerModal({ path, diff, onClose, onOpenPath }: FileViewerModalProps) {
	const [copied, setCopied] = useState(false);

	if (!path) return null;
	const { name, parent } = splitPath(path);

	async function copyPath() {
		if (!path) return;
		await navigator.clipboard.writeText(path);
		setCopied(true);
		setTimeout(() => setCopied(false), 1200);
	}

	return (
		<Dialog
			open
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<DialogContent
				data-testid="file-viewer"
				// `hideClose`: the built-in close button is absolutely positioned at
				// right-4 top-4, which can't share a baseline with this header's own
				// controls. We render DialogClose in-flow with them instead.
				hideClose
				className="flex h-[85vh] w-[90vw] max-w-none flex-col gap-0 overflow-hidden p-0"
			>
				<header className="flex shrink-0 items-center gap-1 border-b border-border px-4 py-2.5">
					<div className="min-w-0 flex-1 pr-2">
						<DialogTitle className="truncate font-medium text-sm">{name}</DialogTitle>
						{parent && <p className="truncate font-mono text-muted-foreground text-xs">{parent}</p>}
					</div>
					<IconButton
						size="md"
						aria-label="Copy path"
						title="Copy path"
						onClick={() => void copyPath()}
					>
						{copied ? <Check className="text-primary" /> : <Copy />}
					</IconButton>
					<IconButton
						size="md"
						aria-label="Open in default app"
						title="Open in default app"
						onClick={() => void openExternally(path)}
					>
						<ExternalLink />
					</IconButton>
					<DialogClose asChild>
						<IconButton size="md" aria-label="Close viewer" title="Close viewer">
							<X />
						</IconButton>
					</DialogClose>
				</header>

				<Suspense
					fallback={
						<p className="flex h-full items-center justify-center text-muted-foreground text-sm">
							Loading editor…
						</p>
					}
				>
					{diff ? (
						<DiffView path={path} mode={diff} />
					) : (
						<FileView path={path} onOpenPath={onOpenPath} />
					)}
				</Suspense>
			</DialogContent>
		</Dialog>
	);
}
