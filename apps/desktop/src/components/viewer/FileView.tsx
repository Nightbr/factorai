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
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@factorai/ui';
import type { ViewerPosition } from '@hooks/useFileViewer';
import { eolOf, readOnlyReason } from '@lib/editable';
import { iconKeyFor } from '@lib/fileIcon';
import { formatBytes } from '@lib/format';
import { type LineSelection, mentionFor, mentionLabel, mentionRange } from '@lib/mentions';
import { queryKeys } from '@lib/queryKeys';
import { cmd } from '@lib/tauri';
import { REREAD_ON_OPEN } from '@lib/viewerQuery';
import { draftFor, useDraftStore } from '@store/draftStore';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { Code2, Eye, RotateCcw, Save, Sparkles } from 'lucide-react';
import type { MutableRefObject } from 'react';
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';

/**
 * One file, editable (specs/05-features.md F7, F26).
 *
 * Knows nothing about its host on purpose: the pane, the split under the tree
 * and the expand modal all render this same component (ADR-0037). Everything
 * host-shaped — size, tabs, dismissal — belongs to the host.
 */

function basename(path: string): string {
	const i = path.lastIndexOf('/');
	return i >= 0 ? path.slice(i + 1) : path;
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
 * The conflict banner's "Show diff" (F26). Its own `lazy` rather than the
 * shared `lazyViews`, which imports this file — a static import back would be
 * a module cycle for a view most readers never open.
 */
const DiffView = lazy(() =>
	import('@components/viewer/DiffView').then((m) => ({ default: m.DiffView })),
);

interface FileViewProps {
	path: string;
	/** Where to put the caret, from `&line=`/`&col=` (F19). Null opens at the
	 *  top, which is what every other way in wants. */
	position?: ViewerPosition | null;
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
	// **Keyed by path.** Everything below is one file's editing state — its
	// baseline, its buffer, whether it is dirty — and carrying that into the
	// next file would offer to save one file's text over another's.
	return <TextFileView key={path} path={path} position={position} onOpenPath={onOpenPath} />;
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

	// ---- the edit buffer (F26) ------------------------------------------------
	//
	// **Three pieces, and they answer different questions.** `baseline` is the
	// disk contents this edit is against — it is what "dirty" is measured from
	// and what a conflict is detected against. `bufferRef` is the text itself,
	// in a ref rather than in state because a keystroke must not re-render the
	// footer, and because it has to survive the editor being unmounted for a
	// markdown preview. `dirty` is the one bit the footer needs, flipped by
	// Monaco's own version id rather than by comparing megabytes per keystroke.
	const [baseline, setBaseline] = useState<string | null>(null);
	const bufferRef = useRef<string>('');
	/** Whether `bufferRef` has been filled for this file yet. */
	const seeded = useRef(false);
	const [dirty, setDirty] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	/** The disk contents the reader has already been shown the banner for, so
	 *  dismissing it stays dismissed and a *second* change shows it again. */
	const [dismissedDisk, setDismissedDisk] = useState<string | null>(null);
	const [showConflictDiff, setShowConflictDiff] = useState(false);
	const setDraft = useDraftStore((s) => s.setDraft);
	const clearDraft = useDraftStore((s) => s.clearDraft);

	const editable = !!file && !file.isBinary && readOnlyReason(file, path) === null;

	/** Take these contents as the new truth: it is what is on disk, and it is
	 *  what the editor shows. Every clean transition goes through here. */
	const adopt = useCallback(
		(contents: string) => {
			bufferRef.current = contents;
			setBaseline(contents);
			setDirty(false);
			setDismissedDisk(null);
			setShowConflictDiff(false);
			clearDraft(path);
		},
		[clearDraft, path],
	);

	// **The buffer is seeded during render, not in an effect**, which is React's
	// own lazy-initialisation shape (`if (ref.current === null) …`) and is
	// load-bearing rather than tidy: an effect runs after the first commit, so
	// the editor mounted holding an empty string for a frame. That was enough to
	// break `?line=` — the jump applied to an empty model, recorded itself as
	// applied, and the remount with the real text restored that view state
	// instead of jumping again (F19).
	//
	// A draft from an earlier visit to this tab wins over disk: it is the newer
	// of the two, and the reader never said to throw it away.
	if (file && !file.isBinary && !seeded.current) {
		seeded.current = true;
		bufferRef.current = draftFor(path) ?? file.contents;
	}

	useEffect(() => {
		if (draftFor(path) !== undefined) setDirty(true);
	}, [path]);

	// **Disk lands only when the buffer is clean.** This is the suppression F26
	// asks for: the watcher's re-read still happens, and `file.contents` still
	// updates, but applying it over an edit in progress is what would discard
	// the reader's work. When dirty, the difference becomes the banner instead.
	useEffect(() => {
		if (!file || file.isBinary || dirty) return;
		if (file.contents === baseline) return;
		bufferRef.current = file.contents;
		setBaseline(file.contents);
	}, [file, dirty, baseline]);

	// The draft outlives the tab, not the app (ADR-0040 is the next slice).
	// Written on the way out rather than per keystroke: nothing reads it while
	// this component is mounted, since the editor holds the same text.
	useEffect(() => {
		return () => {
			if (dirtyRef.current) setDraft(path, bufferRef.current);
		};
	}, [path, setDraft]);
	const dirtyRef = useRef(false);
	dirtyRef.current = dirty;

	const diskContents = file?.contents ?? null;
	/** Something else wrote the file while this buffer was dirty (F26). */
	const conflict = dirty && diskContents !== null && baseline !== null && diskContents !== baseline;
	/** It was deleted instead. `read_file` answers NotFound, which is a fact
	 *  about the file rather than a failure of the read. */
	const deleted =
		dirty && fileQ.isError && (fileQ.error as { kind?: string } | null)?.kind === 'NotFound';
	const showBanner = (conflict && diskContents !== dismissedDisk) || deleted;

	const queryClient = useQueryClient();
	const save = useCallback(async () => {
		const text = bufferRef.current;
		setSaving(true);
		setSaveError(null);
		try {
			const written = await cmd.writeFile(path, text);
			// **The cache is stale the moment the write lands**, and leaving it
			// that way is a race with a visible failure: the sync effect above
			// would see disk disagreeing with the new baseline, decide the file
			// had changed under the editor, and put the pre-save text back. The
			// command answers with what it wrote precisely so this is exact —
			// re-reading would cost a second pass over a file we just held, and
			// recomputing the line count here would be a second definition of it.
			queryClient.setQueryData(queryKeys.file(path, uncapped), written);
			adopt(text);
		} catch (e) {
			// **The buffer stays dirty.** A failed write leaves the text the reader
			// typed as the only copy of it, and discarding that to report an error
			// would be the worst thing this component could do.
			setSaveError(errorText(e));
		} finally {
			setSaving(false);
		}
	}, [adopt, path, queryClient, uncapped]);

	/** Save, asking first when it would overwrite a change nobody has read. */
	const [confirming, setConfirming] = useState<'overwrite' | 'revert' | null>(null);
	const requestSave = useCallback(() => {
		if (!editable || !dirty || saving) return;
		if (conflict) {
			setConfirming('overwrite');
			return;
		}
		void save();
	}, [conflict, dirty, editable, save, saving]);

	const revert = useCallback(async () => {
		// Re-read rather than reuse what the query holds: Revert means "give me
		// what is on disk", and the cached copy may predate the change that made
		// the reader want it back.
		const { data } = await fileQ.refetch();
		adopt(data?.contents ?? '');
	}, [adopt, fileQ]);

	const language = file && !file.isBinary ? languageForFile(basename(path)) : 'plaintext';
	const isMarkdown = language === 'markdown';
	// SVG is the one image that is also text, so it gets the same deal markdown
	// does — rendered by default, source a click away — rather than being
	// routed to `ImageView`, where it would arrive with no source view and no
	// magic bytes for the backend to sniff.
	const isSvg = iconKeyFor(basename(path)) === 'svg';
	const previewable = isMarkdown || isSvg;
	const showPreview = previewable && preview;
	// **Preview renders the buffer, not disk** (F26). Editing `CLAUDE.md` is
	// meant to be a type-toggle-see loop, and a preview of the file as it was
	// before you typed is a preview of the wrong document.
	const previewSource = dirty ? bufferRef.current : (file?.contents ?? '');
	const reason = file && !file.isBinary ? readOnlyReason(file, path) : null;
	// A dirty buffer keeps the editor on screen even when the read now fails:
	// the file being gone is what the banner is for, and unmounting the editor
	// would take the only copy of the text with it.
	const showEditor = !!file && !file.isBinary && !showPreview;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{showBanner && (
				<ConflictBanner
					deleted={!!deleted}
					onReload={() => void revert()}
					onShowDiff={deleted ? null : () => setShowConflictDiff((s) => !s)}
					showingDiff={showConflictDiff}
					onDismiss={() => setDismissedDisk(diskContents)}
				/>
			)}
			<div className="min-h-0 flex-1">
				{fileQ.isPending && <Centered>Loading…</Centered>}
				{fileQ.isError && !deleted && <Centered tone="error">{errorText(fileQ.error)}</Centered>}
				{file?.isBinary && <BinaryCard path={path} size={file.size} />}
				{file && !file.isBinary && file.contents.length === 0 && !dirty && (
					<Centered>This file is empty.</Centered>
				)}
				{showConflictDiff && conflict && diskContents !== null && (
					<Suspense fallback={<Centered>Loading diff…</Centered>}>
						<DiffView
							path={path}
							mode="head"
							sides={{
								original: diskContents,
								modified: bufferRef.current,
								label: 'on disk ↔ your unsaved changes',
							}}
						/>
					</Suspense>
				)}
				{!showConflictDiff && showEditor && (file.contents.length > 0 || dirty) && (
					<Editor
						// Keyed by the disk contents this edit is against: adopting a new
						// baseline is the one thing that should replace what the editor
						// holds, and a keystroke is not one of them.
						baseline={baseline ?? file.contents}
						bufferRef={bufferRef}
						language={language}
						readOnly={!editable}
						position={position ?? null}
						onSelection={setSelection}
						onDirtyChange={setDirty}
						onSave={requestSave}
					/>
				)}
				{!showConflictDiff && file && !file.isBinary && showPreview && isMarkdown && (
					<MarkdownView
						source={previewSource}
						path={path}
						onOpenPath={onOpenPath ?? (() => undefined)}
					/>
				)}
				{!showConflictDiff && file && !file.isBinary && showPreview && isSvg && (
					<SvgPreview source={previewSource} name={basename(path)} />
				)}
			</div>

			{file && !file.isBinary && (
				/* **`@container`, because this row has to survive a 400px column**
				   (ADR-0037). It is the only chrome in the app whose width the user
				   drags directly, and with every label spelled out it needs ~570px:
				   at less than that the spans wrapped, and a two-line footer under a
				   fixed-height strip is the Fixed-Chrome Rule broken by text. The
				   labels drop in the order they cost width — see each one. Same
				   `@container` idiom as the sidebar footer's `UpdateBadge`.

				   `h-7` and no `py-`: an explicit height, since the footer is chrome
				   (DESIGN.md § Layout). */
				<footer className="@container flex h-7 shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap border-t border-border px-3 text-muted-foreground text-xs">
					{previewable && (
						/* `quiet`, `size-3` glyph, lifted a pixel: the house shape for a
						   labelled control in a chrome strip, and the same one
						   `ShellFooter` uses for `+ Terminal`. `ghost` painted a filled
						   block behind the text on hover, which in a row of metadata
						   read as the one thing here that is a widget. */
						<Button
							variant="quiet"
							size="sm"
							className="-ml-1 h-6 shrink-0 gap-1.5 px-2 font-normal text-xs [&_svg]:-translate-y-px [&_svg]:size-3"
							aria-pressed={preview}
							title={preview ? 'View source' : 'Preview'}
							onClick={() => setPreview((p) => !p)}
						>
							{preview ? <Code2 /> : <Eye />}
							{/* Second to go, and much later: with the long label already
							    gone this one plus the metadata is ~340px, so it survives
							    every width the viewer column can take (its floor is 400).
							    22rem is where the *split* host gets narrow enough to matter
							    — a panel dragged to its 256px minimum. Measured at 410px,
							    the column at the 1400px default window, where an earlier
							    26rem threshold hid it for no reason. */}
							<span className="@max-[22rem]:hidden">{preview ? 'View source' : 'Preview'}</span>
						</Button>
					)}
					{/* One span, one string: three spans and two separators cannot
					    ellipsize as a unit, and this is what gives way last. */}
					<span className="min-w-0 truncate">
						{languageLabel(language)} · {formatBytes(file.size)} · {file.lineCount} line
						{file.lineCount === 1 ? '' : 's'}
					</span>

					{/* One spacer, not one per right-hand item: two would leave whatever
					    sits between them floating in the middle of the row. */}
					<span className="flex-1" />

					{/* **`read-only` says which kind** (F26). The bare word was removed
					    from this row on 2026-09-07 as a fifth item competing for width
					    while nothing was editable. It comes back only where it is
					    load-bearing: this file, unlike its neighbours, cannot be saved,
					    and the reason is the whole of the message. */}
					{reason && <span data-testid="viewer-read-only">{reason}</span>}

					{file.truncated && (
						<>
							{/* No byte count here on purpose: the cap lives in Rust and
							    restating it in the renderer would drift. */}
							<Button
								variant="outline"
								size="sm"
								className="h-6 shrink-0 text-xs"
								onClick={() => setUncapped(true)}
							>
								Show anyway
							</Button>
						</>
					)}

					{saveError && (
						<span className="min-w-0 truncate text-destructive" data-testid="viewer-save-error">
							{saveError}
						</span>
					)}

					{/* **Revert only exists while there is something to revert.** It is
					    also the only way to clear a draft without writing one, which is
					    why it is a control rather than an undo the reader has to guess
					    at. */}
					{editable && dirty && (
						<Button
							variant="quiet"
							size="sm"
							className="h-6 shrink-0 gap-1.5 px-2 font-normal text-xs [&_svg]:-translate-y-px [&_svg]:size-3"
							data-testid="viewer-revert"
							title="Discard unsaved changes"
							onClick={() => setConfirming('revert')}
						>
							<RotateCcw />
							<span className="@max-[30rem]:hidden">Revert</span>
						</Button>
					)}

					{/* **Save is the dirty indicator.** Disabled until the buffer
					    differs from disk, so there is no second dot saying the same
					    thing — the rule F11's settings modal already uses.

					    The label changes to `Overwrite` when the file moved under the
					    buffer, because the act changed: writing over a change nobody
					    has read is not the same as saving. */}
					{editable && (
						<Button
							variant="quiet"
							size="sm"
							className="-mr-1 h-6 shrink-0 gap-1.5 px-2 font-normal text-xs [&_svg]:-translate-y-px [&_svg]:size-3 disabled:opacity-40"
							data-testid="viewer-save"
							disabled={!dirty || saving}
							title={conflict ? 'Overwrite what is on disk' : 'Save'}
							onClick={requestSave}
						>
							<Save className={dirty ? 'text-primary' : undefined} />
							<span className="@max-[30rem]:hidden">
								{saving ? 'Saving…' : conflict ? 'Overwrite' : 'Save'}
							</span>
						</Button>
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
							variant="quiet"
							size="sm"
							className="-mr-1 h-6 shrink-0 gap-1.5 px-2 font-normal text-xs [&_svg]:-translate-y-px [&_svg]:size-3"
							data-testid="viewer-add-to-claude"
							title={mentionLabel(range)}
							onClick={() => {
								setSendState('idle');
								void cmd
									.ideMention(sessionId, [mentionFor(path, range)])
									.then(() => setSendState('sent'))
									.catch(() => setSendState('failed'));
								setTimeout(() => setSendState('idle'), 1600);
							}}
						>
							<Sparkles />
							{/* **First to go, at 36rem.** This is the longest label in the
							    row — it names the range, so it grows — and the glyph plus
							    the `title` still say what it does.

							    **The two answers are never hidden.** A control that
							    reports back and then reports back invisibly is worse than
							    one that never reported: whatever the width, pressing this
							    says whether the agent got it. */}
							{sendState === 'idle' ? (
								<span className="@max-[36rem]:hidden">{mentionLabel(range)}</span>
							) : (
								<span>
									{sendState === 'sent' ? 'Added to context' : 'The agent is not connected'}
								</span>
							)}
						</Button>
					)}
				</footer>
			)}

			<EditConfirm
				kind={confirming}
				name={basename(path)}
				onCancel={() => setConfirming(null)}
				onConfirm={() => {
					const kind = confirming;
					setConfirming(null);
					if (kind === 'overwrite') void save();
					if (kind === 'revert') void revert();
				}}
			/>
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
 */
function ConflictBanner({
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
	/** The disk contents this edit is against. Changing it replaces what the
	 *  editor holds; a keystroke does not. */
	baseline: string;
	/** The live text, written here so it survives the editor being unmounted for
	 *  a preview, and read here when the editor is created. */
	bufferRef: MutableRefObject<string>;
	language: string;
	readOnly: boolean;
	/** Caret target from `&line=`/`&col=` (F19), or null to open at the top. */
	position: ViewerPosition | null;
	/** Report what is selected, so the footer can offer to hand it to the agent
	 *  (F20). Null for a bare cursor — that is not a range. */
	onSelection?: (selection: LineSelection | null) => void;
	/** True while the buffer differs from `baseline`. */
	onDirtyChange: (dirty: boolean) => void;
	/** `Cmd/Ctrl+S`, from inside the editor only. */
	onSave: () => void;
}

/**
 * Monaco host. Mirrors the xterm lifecycle in `Terminal.tsx`: create in an
 * effect, dispose on unmount, never through React state.
 *
 * **A new baseline recreates the editor, and the view state survives it.** The
 * effect used to be keyed on the file's contents, which was invisible while the
 * only way to get new contents was to open a different file. The watcher on the
 * open file (F7 § "Freshness") made it visible: an agent saving the file you
 * are reading would drop you back at line 1, having thrown away the selection
 * you were about to hand it. Monaco's own `saveViewState` / `restoreViewState`
 * is the whole mechanism — scroll, selection and folds, in one opaque blob —
 * kept in a ref so it outlives the editor it came from but not the component,
 * which is keyed by path.
 *
 * **Editing changes which value is load-bearing** (F26). The editor is created
 * from `bufferRef`, a ref, precisely so that typing does not put the text
 * through React: a prop would make every keystroke a new value, a new dep, and
 * a recreated editor with the caret back at the top.
 *
 * **Dirty is Monaco's alternative version id, not a string comparison.** It is
 * O(1) where comparing the buffer is O(size) per keystroke, and it is the only
 * way to get undoing back to the start reported as clean rather than as an
 * edit that happens to match.
 */
function Editor({
	baseline,
	bufferRef,
	language,
	readOnly,
	position,
	onSelection,
	onDirtyChange,
	onSave,
}: EditorProps) {
	const hostRef = useRef<HTMLDivElement>(null);
	const viewStateRef = useRef<monaco.editor.ICodeEditorViewState | null>(null);
	/** The last position actually jumped to, so a *new* `?line=` wins over the
	 *  restored scroll while a re-render does not re-jump to an old one. */
	const appliedPositionRef = useRef<ViewerPosition | null>(null);
	/** Save through a ref: the handler's identity changes on every render, and
	 *  a dep on it would recreate the editor mid-keystroke. */
	const onSaveRef = useRef(onSave);
	onSaveRef.current = onSave;

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;

		ensureTheme();
		const editor = monaco.editor.create(host, {
			value: bufferRef.current,
			language,
			theme: FACTORAI_DARK,
			readOnly,
			// A read-only file still wants a caret for keyboard scrolling and
			// selection, but no edit affordances.
			domReadOnly: readOnly,
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

		const model = editor.getModel();
		// The file's own line endings, so a CRLF file saves back as one. Monaco
		// guesses from the text it was given, but only when the text has an
		// ending to guess from — a one-line file has none, and inherits the
		// default (F26 § "What Save writes").
		model?.setEOL(
			eolOf(baseline) === 'crlf'
				? monaco.editor.EndOfLineSequence.CRLF
				: monaco.editor.EndOfLineSequence.LF,
		);
		// What "clean" is, for the version-id comparison below. Read after the
		// EOL is set, since setting it counts as an edit.
		const cleanVersion = model?.getAlternativeVersionId() ?? 0;

		// A position the reader has not been sent to yet is a jump they asked for
		// — a terminal link, or a second `foo.ts:99` for the file already open.
		// Anything else (a re-render, or the file changing under us) restores
		// where they were.
		const applied = appliedPositionRef.current;
		const isNewJump =
			position !== null && (applied?.line !== position.line || applied?.col !== position.col);

		if (position && isNewJump) {
			// Clamp rather than trust: the line came off a terminal line the agent
			// printed, and the file may have shrunk since — `foo.ts:900` in stale
			// output should land at the end of a 40-line file, not throw Monaco at
			// a line that isn't there.
			const lastLine = model?.getLineCount() ?? 1;
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
			appliedPositionRef.current = position;
		} else if (viewStateRef.current) {
			editor.restoreViewState(viewStateRef.current);
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

		const contentSub = model?.onDidChangeContent(() => {
			// `getValue()` here and not per render: the buffer has to be current
			// for a Save that can come from a keystroke, and this is the only place
			// that knows it changed.
			bufferRef.current = model.getValue();
			onDirtyChange(model.getAlternativeVersionId() !== cleanVersion);
		});

		// **`Cmd/Ctrl+S`, scoped to the editor.** Not a global binding: `Ctrl+S`
		// reaching a focused terminal is XOFF, which freezes the PTY on Linux —
		// see F26 and roadmap item 5, which has to decide that question generally.
		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSaveRef.current());

		return () => {
			// Before disposal, not after: a disposed editor has no view state to
			// give, and this is the only moment the next one can inherit from.
			viewStateRef.current = editor.saveViewState();
			bufferRef.current = model?.getValue() ?? bufferRef.current;
			contentSub?.dispose();
			selectionSub.dispose();
			editor.dispose();
		};
		// Recreating on a language change is fine: the viewer is one file at a
		// time and disposal is cheap next to the initial module load.
	}, [baseline, bufferRef, language, readOnly, position, onSelection, onDirtyChange]);

	return <div ref={hostRef} className="h-full w-full" data-testid="file-view-editor" />;
}

/**
 * The two questions editing asks before it does something the reader cannot
 * undo: overwriting a change nobody has read, and throwing away their own.
 *
 * One component with a `kind` rather than two dialogs, because they are the
 * same shape and the same three buttons — and because only one of them can be
 * open at a time by construction.
 */
function EditConfirm({
	kind,
	name,
	onCancel,
	onConfirm,
}: {
	kind: 'overwrite' | 'revert' | null;
	name: string;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	const overwrite = kind === 'overwrite';
	return (
		<Dialog
			open={kind !== null}
			onOpenChange={(next) => {
				if (!next) onCancel();
			}}
		>
			<DialogContent className="sm:max-w-md" data-testid="viewer-edit-confirm">
				<DialogHeader>
					<DialogTitle>
						{overwrite ? `Overwrite ${name}?` : `Discard changes to ${name}?`}
					</DialogTitle>
					<DialogDescription>
						{overwrite
							? 'Something else changed this file after you started editing. Saving replaces what is on disk with your version.'
							: 'Your unsaved changes are thrown away and the file is re-read from disk.'}
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="outline" onClick={onCancel}>
						Cancel
					</Button>
					<Button variant="destructive" onClick={onConfirm} data-testid="viewer-edit-confirm-ok">
						{overwrite ? 'Overwrite' : 'Discard'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
