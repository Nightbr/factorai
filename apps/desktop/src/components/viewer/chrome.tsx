import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@factorai/ui';
import { formatBytes } from '@lib/format';
import { openExternally } from '@lib/tauri';
import { FileWarning, Save } from 'lucide-react';

/**
 * The bits of viewer furniture `FileView`, `DiffView` and `ImageView` need.
 *
 * They live here rather than in any one of them because the alternative is a
 * cycle: `FileView` dispatches to `ImageView` and lazily to `DiffView`, so
 * neither can import back out of it.
 */

export function Centered({
	children,
	tone = 'muted',
}: {
	children: string;
	tone?: 'muted' | 'error';
}) {
	return (
		<p
			className={`flex h-full items-center justify-center px-6 text-center text-sm ${
				tone === 'error' ? 'text-destructive' : 'text-muted-foreground'
			}`}
		>
			{children}
		</p>
	);
}

/**
 * The dead end for a file we can't render: a binary, or an image that turned
 * out not to be one. `reason` says which, because "cannot preview" alone
 * invites the user to wonder whether the app is broken.
 */
export function BinaryCard({
	path,
	size,
	reason,
}: {
	path: string;
	size?: number;
	reason?: string;
}) {
	return (
		<div
			data-testid="binary-card"
			className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
		>
			<FileWarning className="size-8 text-muted-foreground/60" />
			<p className="text-muted-foreground text-sm">
				{reason ?? `Cannot preview binary file (${formatBytes(size ?? 0)}).`}
			</p>
			<Button variant="outline" size="sm" onClick={() => void openExternally(path)}>
				Open in default app
			</Button>
		</div>
	);
}

/**
 * Something else wrote — or deleted — the file while this buffer was dirty
 * (F26 § "The agent writes the file you are editing").
 *
 * Above the editor rather than in the footer: the footer says what the file
 * *is*, and this says what happened to it. Neither side is discarded by
 * anything here — Reload takes disk, dismissing keeps typing, and the Save it
 * leaves behind asks before it overwrites.
 *
 * `onShowDiff` is null where there is nothing useful to show: a deleted file
 * has no disk side, and the diff view is already a diff — its left side is the
 * index or a commit, not the disk the banner is about (ADR-0041).
 */
export function ConflictBanner({
	deleted,
	onReload,
	onShowDiff,
	showingDiff,
	onDismiss,
}: {
	deleted: boolean;
	onReload: () => void;
	onShowDiff: (() => void) | null;
	showingDiff: boolean;
	onDismiss: () => void;
}) {
	return (
		<div
			data-testid="viewer-conflict"
			className="flex shrink-0 items-center gap-2 border-border border-b bg-primary/10 px-3 py-1.5 text-xs"
		>
			<span className="min-w-0 flex-1 truncate">
				{deleted
					? 'Deleted on disk. Saving writes the file back.'
					: 'Changed on disk. Something else wrote this file while you were editing it.'}
			</span>
			{!deleted && (
				<Button
					variant="quiet"
					size="sm"
					className="h-6 shrink-0 px-2 font-normal text-xs"
					data-testid="viewer-conflict-reload"
					onClick={onReload}
				>
					Reload
				</Button>
			)}
			{onShowDiff && (
				<Button
					variant="quiet"
					size="sm"
					className="h-6 shrink-0 px-2 font-normal text-xs"
					data-testid="viewer-conflict-diff"
					aria-pressed={showingDiff}
					onClick={onShowDiff}
				>
					{showingDiff ? 'Back to editing' : 'Show diff'}
				</Button>
			)}
			<Button
				variant="quiet"
				size="sm"
				className="h-6 shrink-0 px-2 font-normal text-xs"
				data-testid="viewer-conflict-dismiss"
				onClick={onDismiss}
			>
				Dismiss
			</Button>
		</div>
	);
}

/**
 * **Save is the dirty indicator** (F26 § Save). Disabled until the buffer
 * differs from disk, so there is no second dot saying the same thing — the
 * rule F11's settings modal already uses.
 *
 * The label changes to `Overwrite` when the file moved under the buffer,
 * because the act changed: writing over a change nobody has read is not the
 * same as saving.
 *
 * In `chrome` rather than in either footer because both footers have one, and
 * two of these drifting apart would mean the same control saying different
 * things about the same file.
 */
export function SaveButton({
	dirty,
	saving,
	conflict,
	onSave,
}: {
	dirty: boolean;
	saving: boolean;
	conflict: boolean;
	onSave: () => void;
}) {
	return (
		<Button
			variant="quiet"
			size="sm"
			className="-mr-1 h-6 shrink-0 gap-1.5 px-2 font-normal text-xs [&_svg]:-translate-y-px [&_svg]:size-3 disabled:opacity-40"
			data-testid="viewer-save"
			disabled={!dirty || saving}
			title={conflict ? 'Overwrite what is on disk' : 'Save'}
			onClick={onSave}
		>
			<Save className={dirty ? 'text-primary' : undefined} />
			<span className="@max-[30rem]:hidden">
				{saving ? 'Saving…' : conflict ? 'Overwrite' : 'Save'}
			</span>
		</Button>
	);
}

/**
 * The one question editing asks before doing something the reader cannot undo:
 * writing over a change nobody has read.
 *
 * There is no discard dialog beside it. Undo is the way back — `Ctrl/Cmd+Z`
 * until the buffer matches disk, which reports itself clean because dirty is
 * Monaco's alternative version id rather than a string comparison.
 */
export function OverwriteConfirm({
	open,
	name,
	onCancel,
	onConfirm,
}: {
	open: boolean;
	name: string;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onCancel();
			}}
		>
			<DialogContent className="sm:max-w-md" data-testid="viewer-edit-confirm">
				<DialogHeader>
					<DialogTitle>Overwrite {name}?</DialogTitle>
					<DialogDescription>
						Something else changed this file after you started editing. Saving replaces what is on
						disk with your version.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="outline" onClick={onCancel}>
						Cancel
					</Button>
					<Button variant="destructive" onClick={onConfirm} data-testid="viewer-edit-confirm-ok">
						Overwrite
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export function errorText(e: unknown): string {
	if (e && typeof e === 'object' && 'message' in e) {
		const message = String((e as { message: unknown }).message);
		// `read_file` returns NotFound for a path the tree listed a moment ago —
		// worth saying why rather than echoing the raw error.
		if ('kind' in e && (e as { kind: unknown }).kind === 'NotFound') {
			return 'File not found. The tree may be out of date — try refreshing it.';
		}
		return message;
	}
	return String(e);
}
