import type { DirEntry } from '@factorai/types';
import { ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '@factorai/ui';
import { useQuery } from '@tanstack/react-query';
import { Clipboard, ExternalLink, FileText, Link, Route, Sparkles } from 'lucide-react';
import { iconKeyFor } from '@lib/fileIcon';
import { relativeToRoot } from '@lib/paths';
import { queryKeys } from '@lib/queryKeys';
import { cmd, copyImageFile, openExternally } from '@lib/tauri';
import { usePanelStore } from '@store/panelStore';

/** Whether a menu action worked, for the transient mark the row shows after —
 *  the menu has closed by then and cannot report anything itself. Named for the
 *  outcome rather than for copying since "Add to agent context" reports through it
 *  too. */
export type RowOutcome = 'yes' | 'failed';

/** What the add-to-Claude row says, which depends on how much it would send.
 *  Naming the count is the difference between a menu item you trust and one you
 *  try once to find out what it does. */
function addLabel(entry: DirEntry, enabled: boolean): string {
	if (!enabled) return 'Add to agent context — no session open';
	const selected = usePanelStore.getState().selectedPaths;
	if (selected.has(entry.path) && selected.size > 1) {
		return `Add ${selected.size} items to agent context`;
	}
	return entry.isDir ? 'Add folder to agent context' : 'Add to agent context';
}

interface FileRowMenuProps {
	entry: DirEntry;
	/** Project root — the base "Copy relative path" measures against. */
	root: string;
	/** Open in the viewer. Undefined for a directory, which has nothing to show. */
	onOpen?: () => void;
	/** Told what happened so the row can show it: the menu has closed by then,
	 *  so it cannot report anything itself. */
	onCopied: (outcome: RowOutcome) => void;
	/** True while this row's menu is open — gates the `read_file` below. */
	menuOpen: boolean;
	/** The session in front, or null when the human is not in one. Decides
	 *  whether "Add to agent context" can do anything (F20). */
	activeSessionId: string | null;
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
export function FileRowMenu({
	entry,
	root,
	onOpen,
	onCopied,
	menuOpen,
	activeSessionId,
}: FileRowMenuProps) {
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
			{/* **Hands these to the agent as `@path` mentions** (F20). Acts on the
			    whole selection when this row is part of one, which is what the
			    right-click already established — so ctrl-clicking five files and
			    right-clicking any of them sends all five.

			    Disabled with no session in front rather than hidden: the row is
			    what tells you the gesture exists, and a menu that changes shape
			    depending on where you were last is harder to learn than one that
			    greys out. */}
			<ContextMenuItem
				disabled={!activeSessionId}
				onSelect={() => {
					if (!activeSessionId) return;
					const selected = usePanelStore.getState().selectedPaths;
					const paths = selected.has(entry.path) ? [...selected] : [entry.path];
					void run(() =>
						cmd.ideMention(
							activeSessionId,
							paths.map((path) => ({ path })),
						),
					);
				}}
			>
				<Sparkles />
				{addLabel(entry, Boolean(activeSessionId))}
			</ContextMenuItem>
			<ContextMenuSeparator />
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
