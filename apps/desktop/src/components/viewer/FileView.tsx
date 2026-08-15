import { MarkdownView } from '@components/viewer/MarkdownView';
import {
	FACTORAI_DARK,
	ensureTheme,
	languageForFile,
	languageLabel,
	monaco,
} from '@components/viewer/monaco';
import { Button } from '@factorai/ui';
import { iconKeyFor } from '@lib/fileIcon';
import { formatBytes } from '@lib/format';
import { queryKeys } from '@lib/queryKeys';
import { cmd, openExternally } from '@lib/tauri';
import { useQuery } from '@tanstack/react-query';
import { Code2, Eye, FileWarning } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

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

/**
 * Dispatch on what kind of file this is, before any hook runs.
 *
 * An image never goes through `read_file`: that would read the bytes only to
 * notice a null byte, report `isBinary` and throw them away. `iconKeyFor` is
 * already the project's answer to "is this a picture" — reusing it means the
 * viewer and the file tree's icon can never disagree, and it keeps `svg` out,
 * which maps to its own key and is better served as source.
 *
 * Routing is by extension because it is free; the *decision* is the backend's,
 * from the magic bytes. A `.png` that isn't one lands in the fallback card.
 */
export function FileView({ path, onOpenPath }: FileViewProps) {
	if (iconKeyFor(basename(path)) === 'image') return <ImageView path={path} />;
	return <TextFileView path={path} onOpenPath={onOpenPath} />;
}

function TextFileView({ path, onOpenPath }: FileViewProps) {
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

/**
 * One image, rendered (F7).
 *
 * The bytes arrive base64 through `read_image` rather than over the asset
 * protocol, because that protocol wants a static path scope and the paths here
 * are "whatever project you opened". `read_file`'s validation already covers
 * this ground, so reusing the command boundary costs a 33% encoding overhead
 * and buys not having a second way into the filesystem.
 *
 * Anything the backend won't call an image — wrong magic bytes, over the size
 * limit — falls through to the same card a binary file gets, which already
 * offers the only useful action left.
 */
function ImageView({ path }: { path: string }) {
	// Read off the decoded element rather than the file: it costs nothing and
	// avoids parsing headers for six formats in Rust to learn what the browser
	// is about to work out anyway.
	const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

	const imageQ = useQuery({
		queryKey: queryKeys.image(path),
		queryFn: () => cmd.readImage(path),
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});

	if (imageQ.isPending) return <Centered>Loading…</Centered>;
	if (imageQ.isError || !imageQ.data) {
		return <BinaryCard path={path} reason={errorText(imageQ.error)} />;
	}

	const image = imageQ.data;
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/30 p-4">
				{/* `contain` inside a scroll container: a large image shrinks to fit
				    rather than forcing a scrollbar, and a tiny one is left at its own
				    size instead of being blown up into mush. */}
				<img
					src={`data:${image.mime};base64,${image.base64}`}
					alt={basename(path)}
					data-testid="image-view"
					className="max-h-full max-w-full object-contain"
					onLoad={(e) =>
						setDims({
							w: e.currentTarget.naturalWidth,
							h: e.currentTarget.naturalHeight,
						})
					}
				/>
			</div>
			<footer className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-1.5 text-muted-foreground text-xs">
				<span>{image.mime}</span>
				{dims && (
					<>
						<span aria-hidden="true">·</span>
						<span>
							{dims.w} × {dims.h}
						</span>
					</>
				)}
				<span aria-hidden="true">·</span>
				<span>{formatBytes(image.size)}</span>
				<span aria-hidden="true">·</span>
				<span>read-only</span>
			</footer>
		</div>
	);
}

/**
 * The dead end for a file we can't render: a binary, or an image that turned
 * out not to be one. `reason` says which, because "cannot preview" alone
 * invites the user to wonder whether the app is broken.
 */
function BinaryCard({ path, size, reason }: { path: string; size?: number; reason?: string }) {
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
