import { Dialog, DialogClose, DialogContent, DialogTitle, IconButton } from '@factorai/ui';
import { Check, Copy, ExternalLink, FolderOpen, X } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import type { DiffMode, ViewerPosition } from '@hooks/useFileViewer';
import { isMacOS } from '@lib/platform';
import { cmd, openExternally } from '@lib/tauri';

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
	/** Caret target from `&line=`/`&col=`, or null to open at the top (F19). */
	position: ViewerPosition | null;
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
export function FileViewerModal({
	path,
	diff,
	position,
	onClose,
	onOpenPath,
}: FileViewerModalProps) {
	const [copied, setCopied] = useState(false);
	const [revealFailed, setRevealFailed] = useState(false);

	if (!path) return null;
	const { name, parent } = splitPath(path);
	// The platform's own name for this, because a control labelled something
	// other than the menu item a reader already knows is a control they have to
	// read twice. See `lib/platform` for why the sniff is reliable in a webview.
	const revealTarget = isMacOS() ? 'Finder' : 'file manager';
	const revealLabel = revealFailed ? 'Reveal failed' : `Reveal in ${revealTarget}`;

	async function copyPath() {
		if (!path) return;
		await navigator.clipboard.writeText(path);
		setCopied(true);
		setTimeout(() => setCopied(false), 1200);
	}

	async function reveal() {
		if (!path) return;
		try {
			await cmd.revealInFileManager(path);
		} catch {
			// Say so rather than doing nothing visible, the same call
			// `ImageView`'s copy button makes: the two ways this fails are a file
			// deleted while it was on screen and a desktop with no file manager
			// at all, and neither is distinguishable from a dead button.
			setRevealFailed(true);
			setTimeout(() => setRevealFailed(false), 1400);
		}
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
						aria-label={revealLabel}
						title={revealLabel}
						onClick={() => void reveal()}
					>
						<FolderOpen className={revealFailed ? 'text-destructive' : undefined} />
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
						<FileView path={path} position={position} onOpenPath={onOpenPath} />
					)}
				</Suspense>
			</DialogContent>
		</Dialog>
	);
}
