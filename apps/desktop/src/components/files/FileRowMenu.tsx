import type { DirEntry } from '@factorai/types';
import { ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '@factorai/ui';
import { useQuery } from '@tanstack/react-query';
import { Clipboard, ExternalLink, FileText, Link, Route } from 'lucide-react';
import { iconKeyFor } from '@lib/fileIcon';
import { relativeToRoot } from '@lib/paths';
import { queryKeys } from '@lib/queryKeys';
import { cmd, copyImageFile, openExternally } from '@lib/tauri';

export type CopyOutcome = 'yes' | 'failed';

interface FileRowMenuProps {
	entry: DirEntry;
	/** Project root — the base "Copy relative path" measures against. */
	root: string;
	/** Open in the viewer. Undefined for a directory, which has nothing to show. */
	onOpen?: () => void;
	/** Told what happened so the row can show it: the menu has closed by then,
	 *  so it cannot report anything itself. */
	onCopied: (outcome: CopyOutcome) => void;
	/** True while this row's menu is open — gates the `read_file` below. */
	menuOpen: boolean;
}

/**
 * The right-click menu on a file tree row (specs/05-features.md F12).
 *
 * F12 gives the row **no hover actions** on purpose — at 288px a permanent
 * control is a permanent accident — and this is how the other things you want
 * to do with a file exist anyway, costing nothing until you ask.
 *
 * **Two ways to open, and they are different rows.** `Open` is the viewer (F7),
 * which is also what a single click does; `Open in default app` is
 * `plugin-shell`'s `open`, which is what the viewer's own header offers. They
 * are named separately rather than collapsed into one ambiguous `Open`.
 *
 * **A directory gets the same menu, not a second one.** Paths are meaningful
 * for a directory; its contents aren't, and neither is the viewer. Those rows
 * disable rather than disappearing, so the menu keeps one shape.
 */
export function FileRowMenu({ entry, root, onOpen, onCopied, menuOpen }: FileRowMenuProps) {
	const isImage = !entry.isDir && iconKeyFor(entry.name) === 'image';
	const readable = menuOpen && !entry.isDir && !isImage;

	// Shares the viewer's cache entry (same key, same cap), so right-clicking a
	// file you already opened costs nothing and vice versa. Read on open rather
	// than on click because the answer decides whether the row is *offered*:
	// `isBinary` and `truncated` are what stop a null byte or half a file
	// reaching the clipboard.
	const fileQ = useQuery({
		queryKey: queryKeys.file(entry.path, false),
		queryFn: () => cmd.readFile(entry.path),
		enabled: readable,
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});

	const file = fileQ.data;
	const copyableText = Boolean(file && !file.isBinary && !file.truncated);
	const canCopyContents = isImage || copyableText;

	async function run(action: () => Promise<void> | void) {
		try {
			await action();
			onCopied('yes');
		} catch {
			// A clipboard write can be refused by the platform. Saying so beats a
			// tick for something that didn't happen — you would paste stale content
			// somewhere else and not know why.
			onCopied('failed');
		}
	}

	return (
		<ContextMenuContent className="w-56">
			<ContextMenuItem disabled={!onOpen} onSelect={() => onOpen?.()}>
				<FileText /> Open
			</ContextMenuItem>
			<ContextMenuItem onSelect={() => void openExternally(entry.path)}>
				<ExternalLink /> Open in default app
			</ContextMenuItem>
			<ContextMenuSeparator />
			<ContextMenuItem
				disabled={!canCopyContents}
				onSelect={() =>
					void run(() =>
						isImage
							? copyImageFile(entry.path)
							: navigator.clipboard.writeText(file?.contents ?? ''),
					)
				}
			>
				<Clipboard /> {contentsLabel(entry, isImage, file?.isBinary, file?.truncated)}
			</ContextMenuItem>
			<ContextMenuItem onSelect={() => void run(() => navigator.clipboard.writeText(entry.path))}>
				<Route /> Copy absolute path
			</ContextMenuItem>
			<ContextMenuItem
				onSelect={() =>
					void run(() => navigator.clipboard.writeText(relativeToRoot(entry.path, root)))
				}
			>
				<Link /> Copy relative path
			</ContextMenuItem>
		</ContextMenuContent>
	);
}

/**
 * Why the contents row is off, in the row itself. A disabled control with no
 * reason reads as a broken one, and there is no toast to explain it in (roadmap
 * item 7).
 */
function contentsLabel(
	entry: DirEntry,
	isImage: boolean,
	isBinary: boolean | undefined,
	truncated: boolean | undefined,
): string {
	if (entry.isDir) return 'Copy contents (directory)';
	if (isImage) return 'Copy image';
	if (isBinary) return 'Copy contents (binary)';
	if (truncated) return 'Copy contents (too large)';
	return 'Copy contents';
}
