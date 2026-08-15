import { Button } from '@factorai/ui';
import { formatBytes } from '@lib/format';
import { openExternally } from '@lib/tauri';
import { FileWarning } from 'lucide-react';

/**
 * The bits of viewer furniture both `FileView` and `ImageView` need.
 *
 * They live here rather than in either one because the alternative is a cycle:
 * `FileView` dispatches to `ImageView`, so `ImageView` cannot import back out
 * of it.
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
