import { ImageView } from '@components/viewer/ImageView';
import { MarkdownView } from '@components/viewer/MarkdownView';
import { BinaryCard, Centered, errorText } from '@components/viewer/chrome';
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
import { cmd } from '@lib/tauri';
import { useQuery } from '@tanstack/react-query';
import { Code2, Eye } from 'lucide-react';
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
	// Markdown and SVG open rendered; `preview` is ignored for everything else.
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
	// SVG is the one image that is also text, so it gets the same deal markdown
	// does — rendered by default, source a click away — rather than being
	// routed to `ImageView`, where it would arrive with no source view and no
	// magic bytes for the backend to sniff.
	const isSvg = iconKeyFor(basename(path)) === 'svg';
	const previewable = isMarkdown || isSvg;
	const showPreview = previewable && preview;

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
				{file && !file.isBinary && file.contents.length > 0 && showPreview && isMarkdown && (
					<MarkdownView
						source={file.contents}
						path={path}
						onOpenPath={onOpenPath ?? (() => undefined)}
					/>
				)}
				{file && !file.isBinary && file.contents.length > 0 && showPreview && isSvg && (
					<SvgPreview source={file.contents} name={basename(path)} />
				)}
			</div>

			{file && !file.isBinary && (
				<footer className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-1.5 text-muted-foreground text-xs">
					{previewable && (
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

/**
 * An SVG, drawn.
 *
 * Through an `<img>` and a data URL rather than dropping the markup into the
 * DOM. That is the security property, not a stylistic choice: SVG loaded as an
 * image runs in a restricted mode with no script execution and no external
 * references, whereas inlining the same file into the document would let a
 * `<script>` inside it run with our origin. These files come out of whatever
 * repository the user opened.
 *
 * `encodeURIComponent`, not base64: `btoa` throws on any character outside
 * Latin-1, and an SVG with a `é` or an emoji in a label is ordinary.
 */
function SvgPreview({ source, name }: { source: string; name: string }) {
	return (
		<div className="flex h-full items-center justify-center overflow-auto bg-muted/30 p-4">
			<img
				src={`data:image/svg+xml,${encodeURIComponent(source)}`}
				alt={name}
				data-testid="svg-view"
				className="max-h-full max-w-full object-contain"
			/>
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
