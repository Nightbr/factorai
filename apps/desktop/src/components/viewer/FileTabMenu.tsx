import { ContextMenuContent, ContextMenuItem } from '@factorai/ui';
import { Clipboard, ExternalLink, FolderOpen } from 'lucide-react';
import type { RowOutcome } from '@components/files/FileRowMenu';
import { revealLabel } from '@lib/platform';
import { cmd, copyText, openExternally } from '@lib/tauri';

interface FileTabMenuProps {
	path: string;
	/** Told what happened so the tab can show it: the menu has closed by then. */
	onOutcome: (outcome: RowOutcome) => void;
}

/**
 * The right-click menu on a viewer tab (specs/05-features.md F7).
 *
 * **File actions only.** It is how the split pane reaches the file manager
 * without expanding first — the pane header stays Expand and nothing else —
 * and the tab is already the control that says *which* file. Pinning and
 * closing keep their gestures on the tab itself.
 *
 * The labels match the tree's menu (F12) word for word, so the two menus read
 * as one.
 */
export function FileTabMenu({ path, onOutcome }: FileTabMenuProps) {
	return (
		<ContextMenuContent className="w-56">
			<ContextMenuItem
				onSelect={() => void cmd.revealInFileManager(path).catch(() => onOutcome('failed'))}
			>
				<FolderOpen /> {revealLabel()}
			</ContextMenuItem>
			<ContextMenuItem onSelect={() => void openExternally(path)}>
				<ExternalLink /> Open in default app
			</ContextMenuItem>
			<ContextMenuItem
				onSelect={() =>
					void copyText(path).then(
						() => onOutcome('yes'),
						() => onOutcome('failed'),
					)
				}
			>
				<Clipboard /> Copy path
			</ContextMenuItem>
		</ContextMenuContent>
	);
}
