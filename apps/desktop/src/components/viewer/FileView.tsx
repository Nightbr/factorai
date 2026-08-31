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
import type { ViewerPosition } from '@hooks/useFileViewer';
import { iconKeyFor } from '@lib/fileIcon';
import { formatBytes } from '@lib/format';
import { type LineSelection, mentionFor, mentionLabel, mentionRange } from '@lib/mentions';
import { queryKeys } from '@lib/queryKeys';
import { cmd } from '@lib/tauri';
import { REREAD_ON_OPEN } from '@lib/viewerQuery';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { Code2, Eye, Sparkles } from 'lucide-react';
import { Suspense, lazy, useEffect, useRef, useState } from 'react';

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
	/** Where to put the caret, from `&line=`/`&col=` (F19). Null opens at the
	 *  top, which is what every other way in wants. */
	position?: ViewerPosition | null;
	/** Open another file in the viewer — used by relative markdown links. */
	onOpenPath?: (path: string) => void;
}

/**
 * pdf.js is a PDF implementation, ~1MB of it, and this is the only thing that
 * wants one — so it gets a chunk of its own *below* the viewer's (ADR-0018).
 * Opening a source file loads Monaco and not this. `ImageView` stays a static
 * import: it is a few hundred lines and no dependency.
 */
const PdfView = lazy(() =>
	import('@components/viewer/PdfView').then((m) => ({ default: m.PdfView })),
);

/**
 * Dispatch on what kind of file this is, before any hook runs.
 *
 * An image never goes through `read_file`: that would read the bytes only to
 * notice a null byte, report `isBinary` and throw them away. `iconKeyFor` is
 * already the project's answer to "is this a picture" — reusing it means the
 * viewer and the file tree's icon can never disagree, and it keeps `svg` out,
 * which maps to its own key and is better served as source.
 *
 * A PDF is the same bargain again: `read_file` would find a null byte in the
 * first 8KB and hand back the binary card, which is what a `.pdf` used to get.
 *
 * Routing is by extension because it is free; the *decision* is the backend's,
 * from the magic bytes. A `.png` that isn't one lands in the fallback card.
 */
export function FileView({ path, position, onOpenPath }: FileViewProps) {
	const iconKey = iconKeyFor(basename(path));
	if (iconKey === 'image') return <ImageView path={path} />;
	if (iconKey === 'pdf') {
		return (
			<Suspense fallback={<Centered>Loading PDF viewer…</Centered>}>
				<PdfView path={path} />
			</Suspense>
		);
	}
	return <TextFileView path={path} position={position} onOpenPath={onOpenPath} />;
}

function TextFileView({ path, position, onOpenPath }: FileViewProps) {
	// The user asked to see an oversized file anyway → read with no cap.
	const [uncapped, setUncapped] = useState(false);
	// What is selected in the editor, for the footer's hand-to-Claude control
	// (F20). Held here rather than in the editor because the footer is what
	// renders it, and the editor is recreated on every content change.
	const [selection, setSelection] = useState<LineSelection | null>(null);
	// Which agent it would go to: the session in front, and none when the viewer
	// was opened from somewhere that is not a session.
	const { sessionId } = useParams({ strict: false }) as { sessionId?: string };
	const [sendState, setSendState] = useState<'idle' | 'sent' | 'failed'>('idle');
	const range = mentionRange(selection);
	// Markdown and SVG open rendered; `preview` is ignored for everything else.
	//
	// **Except when a position was asked for.** A link to `README.md:42` is a
	// request for line 42, and the rendered page has no lines — it would open at
	// the top with the position silently dropped. Source honours the ask, and the
	// toggle is right there. Keyed off the initial value only: toggling to
	// preview afterwards is the reader's decision and this must not undo it.
	const [preview, setPreview] = useState(!position);

	const fileQ = useQuery({
		queryKey: queryKeys.file(path, uncapped),
		queryFn: () => cmd.readFile(path, uncapped ? null : undefined),
		// A file open in the viewer is a snapshot; the refresh path is reopening
		// it, not a background refetch that would yank the scroll position — so
		// the reopen has to actually re-read. See `REREAD_ON_OPEN`.
		...REREAD_ON_OPEN,
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
					<Editor
						contents={file.contents}
						language={language}
						position={position ?? null}
						onSelection={setSelection}
					/>
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

					{/* One spacer, not one per right-hand item: two would leave whatever
					    sits between them floating in the middle of the row. */}
					<span className="flex-1" />

					{file.truncated && (
						<>
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

					{/* **Hand this to the agent** (F20). In the footer rather than the
					    header because this is the only place that knows the selection,
					    and because the label has to name the range — a control that
					    sends more than you highlighted is worse than one you press
					    twice.

					    Far right, away from the metadata: everything to the left of the
					    spacer describes the file, and this is the one thing here that
					    *does* something. Absent with no session in front, since there
					    is nothing to send to and a disabled control in a row of
					    metadata reads as broken rather than unavailable. */}
					{sessionId && (
						<Button
							variant="ghost"
							size="sm"
							className="-mr-1 h-6 gap-1.5 px-2 text-xs"
							data-testid="viewer-add-to-claude"
							onClick={() => {
								setSendState('idle');
								void cmd
									.ideMention(sessionId, [mentionFor(path, range)])
									.then(() => setSendState('sent'))
									.catch(() => setSendState('failed'));
								setTimeout(() => setSendState('idle'), 1600);
							}}
						>
							<Sparkles className="size-3.5" />
							{sendState === 'sent'
								? 'Added to context'
								: sendState === 'failed'
									? 'The agent is not connected'
									: mentionLabel(range)}
						</Button>
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
	/** Caret target from `&line=`/`&col=` (F19), or null to open at the top. */
	position: ViewerPosition | null;
	/** Report what is selected, so the footer can offer to hand it to the agent
	 *  (F20). Null for a bare cursor — that is not a range. */
	onSelection?: (selection: LineSelection | null) => void;
}

/**
 * Monaco host. Mirrors the xterm lifecycle in `Terminal.tsx`: create in an
 * effect, dispose on unmount, never through React state.
 */
function Editor({ contents, language, position, onSelection }: EditorProps) {
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

		if (position) {
			// Clamp rather than trust: the line came off a terminal line the agent
			// printed, and the file may have shrunk since — `foo.ts:900` in stale
			// output should land at the end of a 40-line file, not throw Monaco at
			// a line that isn't there.
			const lastLine = editor.getModel()?.getLineCount() ?? 1;
			const line = Math.min(position.line, lastLine);
			const column = position.col ?? 1;
			editor.setPosition({ lineNumber: line, column });
			// Centred rather than merely scrolled into view: a link is a jump, and
			// landing on the last visible row shows you the line with no context
			// above it, which is the half you usually need.
			editor.revealLineInCenter(line);
			// The caret is the only thing marking the destination, and Monaco puts
			// it where it isn't visible until the editor has focus.
			editor.focus();
		}

		// Monaco's line and column numbers are 1-based, which is already what an
		// `@file#L12-18` mention wants — the conversion happens once, in
		// `lib/mentions`, and nothing else has to know about the convention.
		const selectionSub = editor.onDidChangeCursorSelection(({ selection }) => {
			onSelection?.(
				selection.isEmpty()
					? null
					: {
							startLine: selection.startLineNumber,
							endLine: selection.endLineNumber,
							endColumn: selection.endColumn,
						},
			);
		});

		return () => {
			selectionSub.dispose();
			editor.dispose();
		};
		// Recreating on a language change is fine: the viewer is one file at a
		// time and disposal is cheap next to the initial module load.
	}, [contents, language, position, onSelection]);

	return <div ref={hostRef} className="h-full w-full" data-testid="file-view-editor" />;
}
