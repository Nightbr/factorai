import { Button } from '@factorai/ui';
import { useQuery } from '@tanstack/react-query';
import { Code2, Eye, FileWarning } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MarkdownView } from '@components/viewer/MarkdownView';
import { formatBytes } from '@lib/format';
import { cmd, openExternally } from '@lib/tauri';
import { queryKeys } from '@lib/queryKeys';
import {
	ensureTheme,
	FACTORAI_DARK,
	languageForFile,
	languageLabel,
	monaco,
} from '@components/viewer/monaco';

/**
 * Read-only view of one file (specs/05-features.md F7).
 *
 * Knows nothing about modals on purpose: V0 hosts it in `FileViewerModal`, and
 * the per-project tab system will host the same component in a tab. Everything
 * modal-shaped (size, overlay, dismissal) belongs to the host.
 */

function basename(path: string): string {
	const i = path.lastIndexOf('/');
	return i >= 0 ? path.slice(i + 1) : path;
}

interface FileViewProps {
	path: string;
	/** Open another file in the viewer — used by relative markdown links. */
	onOpenPath?: (path: string) => void;
}

export function FileView({ path, onOpenPath }: FileViewProps) {
	// The user asked to see an oversized file anyway → read with no cap.
	const [uncapped, setUncapped] = useState(false);
	// Markdown opens rendered; `preview` is ignored for everything else.
	const [preview, setPreview] = useState(true);

	const fileQ = useQuery({
		queryKey: queryKeys.file(path, uncapped),
		queryFn: () => cmd.readFile(path, uncapped ? null : undefined),
		// A file open in the viewer is a snapshot; the refresh path is reopening
		// it, not a background refetch that would yank the scroll position.
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});

	const file = fileQ.data;
	const language = file && !file.isBinary ? languageForFile(basename(path)) : 'plaintext';
	const isMarkdown = language === 'markdown';
	const showPreview = isMarkdown && preview;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="min-h-0 flex-1">
				{fileQ.isPending && <Centered>Loading…</Centered>}
				{fileQ.isError && <Centered tone="error">{errorText(fileQ.error)}</Centered>}
				{file?.isBinary && <BinaryCard path={path} size={file.size} />}
				{file && !file.isBinary && file.contents.length === 0 && (
					<Centered>This file is empty.</Centered>
				)}
				{file && !file.isBinary && file.contents.length > 0 && !showPreview && (
					<Editor contents={file.contents} language={language} />
				)}
				{file && !file.isBinary && file.contents.length > 0 && showPreview && (
					<MarkdownView
						source={file.contents}
						path={path}
						onOpenPath={onOpenPath ?? (() => undefined)}
					/>
				)}
			</div>

			{file && !file.isBinary && (
				<footer className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-1.5 text-muted-foreground text-xs">
					{isMarkdown && (
						<Button
							variant="ghost"
							size="sm"
							className="-ml-1 h-6 gap-1.5 px-2 text-xs"
							aria-pressed={preview}
							onClick={() => setPreview((p) => !p)}
						>
							{preview ? <Code2 className="size-3.5" /> : <Eye className="size-3.5" />}
							{preview ? 'View source' : 'Preview'}
						</Button>
					)}
					<span>{languageLabel(language)}</span>
					<span aria-hidden="true">·</span>
					<span>{formatBytes(file.size)}</span>
					<span aria-hidden="true">·</span>
					<span>
						{file.lineCount} line{file.lineCount === 1 ? '' : 's'}
					</span>
					<span aria-hidden="true">·</span>
					<span>read-only</span>
					{file.truncated && (
						<>
							<span className="flex-1" />
							{/* No byte count here on purpose: the cap lives in Rust and
							    restating it in the renderer would drift. */}
							<span className="text-primary">truncated</span>
							<Button
								variant="outline"
								size="sm"
								className="h-6 text-xs"
								onClick={() => setUncapped(true)}
							>
								Show anyway
							</Button>
						</>
					)}
				</footer>
			)}
		</div>
	);
}

interface EditorProps {
	contents: string;
	language: string;
}

/**
 * Monaco host. Mirrors the xterm lifecycle in `Terminal.tsx`: create in an
 * effect, dispose on unmount, never through React state.
 */
function Editor({ contents, language }: EditorProps) {
	const hostRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;

		ensureTheme();
		const editor = monaco.editor.create(host, {
			value: contents,
			language,
			theme: FACTORAI_DARK,
			readOnly: true,
			// Read-only still wants a caret for keyboard scrolling and selection,
			// but no edit affordances.
			domReadOnly: true,
			minimap: { enabled: false },
			lineNumbers: 'on',
			// Wrapped, so reading a file never means scrolling sideways. Long
			// wrapped lines get a hanging indent so continuations are obvious.
			wordWrap: 'on',
			wrappingIndent: 'indent',
			scrollBeyondLastLine: false,
			renderLineHighlight: 'line',
			fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
			fontSize: 13,
			// Monaco measures its container on create. Inside a dialog that is
			// mid-open-animation it would measure zero and render nothing, so let
			// it own a ResizeObserver instead — same failure mode the terminal had
			// before its fit() ran after layout.
			automaticLayout: true,
			padding: { top: 8, bottom: 8 },
		});
		return () => editor.dispose();
		// Recreating on a language change is fine: the viewer is one file at a
		// time and disposal is cheap next to the initial module load.
	}, [contents, language]);

	return <div ref={hostRef} className="h-full w-full" data-testid="file-view-editor" />;
}

function BinaryCard({ path, size }: { path: string; size: number }) {
	return (
		<div
			data-testid="binary-card"
			className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
		>
			<FileWarning className="size-8 text-muted-foreground/60" />
			<p className="text-muted-foreground text-sm">
				Cannot preview binary file ({formatBytes(size)}).
			</p>
			<Button variant="outline" size="sm" onClick={() => void openExternally(path)}>
				Open in default app
			</Button>
		</div>
	);
}

function Centered({ children, tone = 'muted' }: { children: string; tone?: 'muted' | 'error' }) {
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

function errorText(e: unknown): string {
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
