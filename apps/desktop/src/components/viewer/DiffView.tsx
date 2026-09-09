import type { FileContents } from '@factorai/types';
import { Button } from '@factorai/ui';
import { useQuery } from '@tanstack/react-query';
import { Columns2, Rows2 } from 'lucide-react';
import { type MutableRefObject, useEffect, useRef } from 'react';
import { type DiffMode, parseCommitRange } from '@hooks/useFileViewer';
import { useEditBuffer } from '@hooks/useEditBuffer';
import { diffEditsWorktree, diffReadOnlyReason, eolOf, readOnlyReason } from '@lib/editable';
import { formatBytes } from '@lib/format';
import { cmd } from '@lib/tauri';
import { IMMUTABLE_REV, REREAD_ON_OPEN } from '@lib/viewerQuery';
import { queryKeys } from '@lib/queryKeys';
import { useFindHandleSink } from '@components/viewer/findHandle';
import {
	Centered,
	ConflictBanner,
	OverwriteConfirm,
	SaveButton,
	errorText,
} from '@components/viewer/chrome';
import {
	ensureTheme,
	FACTORAI_DARK,
	findIsRevealed,
	languageForFile,
	monaco,
	openFind,
} from '@components/viewer/monaco';
import { usePrefsStore } from '@store/prefsStore';

/**
 * Diff of one file between two revisions (specs/05-features.md F8, F13, F26).
 *
 * Which two depends on the mode, because a staged change has no side on disk:
 * `staged` is HEAD ↔ index, `unstaged` is index ↔ worktree, and `head` is
 * HEAD ↔ worktree for conflicted rows (markers and all — there is no 3-way
 * merge editor here).
 *
 * A missing side is **empty, not an error**: that is what added and deleted
 * look like, and they are the two most ordinary rows in the Changes list.
 *
 * **The worktree side is editable, and only the worktree side** (F26 §
 * "Editing a diff", ADR-0041). Reviewing your own uncommitted work is where
 * you notice the thing you want to change, and having to leave the diff to
 * change it is the same "leave the app" the whole feature exists to end. Every
 * other side is a git object — the index, a commit's blob — and factorai has
 * no command that writes one, so a diff of a commit is read-only whichever end
 * of it you click into.
 */

interface DiffViewProps {
	path: string;
	mode: DiffMode;
	/** Two strings to diff directly, instead of reading the revisions `mode`
	 *  names (F26). The one caller is the conflict banner's "Show diff", whose
	 *  right-hand side is an unsaved buffer — a thing no revision holds and no
	 *  command can be asked for. */
	sides?: { original: string; modified: string; label: string } | null;
}

/** One side of a diff, as a cache key plus the call that fills it.
 *  `key` is what distinguishes a HEAD blob from a blob at some commit.
 *
 *  `freshness` is per side because the two sides age differently: the worktree
 *  is whatever is on disk right now, and so are `head` and `index` — commit or
 *  stage and the blob under those names is a different one. Only a full SHA is
 *  cacheable forever. */
interface Side {
	key: readonly unknown[];
	load: () => Promise<FileContents | null>;
	freshness: { readonly staleTime: number };
}

/**
 * What each side of a diff is read from.
 *
 * Three of the four modes are working-tree pairs; the fourth is a commit against
 * its parent, which is why `git_blob_at` exists as a third command rather than
 * `GitRev` growing an object member (F18).
 */
function sidesFor(path: string, mode: DiffMode): { left: Side; right: Side } {
	const worktree: Side = {
		key: queryKeys.file(path, false),
		load: () => readWorktree(path),
		freshness: REREAD_ON_OPEN,
	};
	const at = (rev: 'head' | 'index'): Side => ({
		key: queryKeys.gitBlob(path, rev),
		load: () => cmd.gitBlob(path, rev),
		freshness: REREAD_ON_OPEN,
	});

	const range = parseCommitRange(mode);
	if (range) {
		const { left: parent, right: commit } = range;
		return {
			// A root commit has no left side at all: everything in it is an addition,
			// so an absent blob is the honest answer rather than an error.
			left: parent
				? {
						key: queryKeys.gitBlob(path, parent),
						load: () => cmd.gitBlobAt(path, parent),
						freshness: IMMUTABLE_REV,
					}
				: {
						key: queryKeys.gitBlob(path, 'empty-tree'),
						load: () => Promise.resolve(null),
						freshness: IMMUTABLE_REV,
					},
			right: {
				key: queryKeys.gitBlob(path, commit),
				load: () => cmd.gitBlobAt(path, commit),
				freshness: IMMUTABLE_REV,
			},
		};
	}
	switch (mode) {
		case 'staged':
			return { left: at('head'), right: at('index') };
		case 'unstaged':
			return { left: at('index'), right: worktree };
		default:
			return { left: at('head'), right: worktree };
	}
}

function basename(path: string): string {
	const i = path.lastIndexOf('/');
	return i >= 0 ? path.slice(i + 1) : path;
}

/**
 * **Keyed by path *and* mode**, for the reason `FileView` is keyed by path:
 * everything below is one buffer's editing state, and the pane switches which
 * file this component points at rather than mounting a second one. Mode is in
 * the key too because it decides which revisions are read and whether the
 * right-hand side is a file at all — carrying a worktree buffer into a commit
 * diff would offer to save one into the other.
 */
export function DiffView({ path, mode, sides = null }: DiffViewProps) {
	return <DiffViewInner key={`${mode}:${path}`} path={path} mode={mode} sides={sides} />;
}

function DiffViewInner({ path, mode, sides = null }: DiffViewProps) {
	const inline = usePrefsStore((s) => s.diffInline);
	const setInline = usePrefsStore((s) => s.setDiffInline);
	const { left, right } = sidesFor(path, mode);

	// Disabled rather than absent when the strings were handed to us: hooks run
	// in the same order either way, and nothing should read a revision whose
	// answer we already have.
	const leftQ = useQuery({
		queryKey: left.key,
		queryFn: left.load,
		...left.freshness,
		retry: false,
		enabled: !sides,
	});
	const rightQ = useQuery({
		queryKey: right.key,
		queryFn: right.load,
		...right.freshness,
		retry: false,
		enabled: !sides,
	});

	// A disabled query stays `pending` forever, so the flag has to know which
	// kind of diff this is.
	const pending = !sides && (leftQ.isPending || rightQ.isPending);
	const error = sides ? null : (leftQ.error ?? rightQ.error);
	// Both sides absent means the file exists at neither revision — nothing to
	// show, and not worth an error either.
	const original = sides ? { contents: sides.original } : (leftQ.data ?? null);
	const modified = sides ? { contents: sides.modified } : (rightQ.data ?? null);
	const binary = !sides && (leftQ.data?.isBinary || rightQ.data?.isBinary);
	const truncated = !sides && (leftQ.data?.truncated || rightQ.data?.truncated);

	// ---- the edit buffer (F26) ------------------------------------------------
	//
	// **Three refusals, in order, and each says which it is in the footer.**
	// The mode has to put a file on the right at all; that file has to still be
	// there (a deleted row diffs against nothing, and there is no buffer to
	// recreate it from here — the file view is where a deleted file comes
	// back); and it has to be a file F26 would let anyone edit anyway, since a
	// truncated or lossy read is no more writable through a diff than through
	// the editor.
	const writableSide = !sides && diffEditsWorktree(mode);
	// **The last worktree read this diff saw.** `readWorktree` reports a file
	// that has gone as an *absent side*, which is right for the diff — that is
	// what a deletion looks like — and wrong for a buffer over it: the text the
	// reader typed is now the only copy, and dropping the editor would take it
	// with them. So a deletion mid-edit keeps the editor and gets the banner,
	// and Save writes the file back (F26 § "What Save writes").
	const lastWorktree = useRef<FileContents | null>(null);
	if (writableSide && rightQ.data) lastWorktree.current = rightQ.data;
	const worktree = writableSide ? (rightQ.data ?? lastWorktree.current) : null;
	const gone = writableSide && !rightQ.isPending && rightQ.data === null;
	const fileReason = worktree ? readOnlyReason(worktree, path) : null;
	const modeReason = sides ? null : diffReadOnlyReason(mode);
	const editable = !!worktree && !worktree.isBinary && fileReason === null;
	const {
		baseline,
		bufferRef,
		dirty,
		saving,
		saveError,
		noteDirty,
		requestSave,
		conflict,
		deleted,
		showBanner,
		dismiss,
		reload,
		confirmOverwrite,
		cancelOverwrite,
		confirmedSave,
	} = useEditBuffer({
		path,
		file: worktree,
		editable,
		cacheKey: queryKeys.file(path, false),
		refetch: rightQ.refetch,
		// `readWorktree` turns a NotFound into an absent side, because that is
		// what a deleted file's diff *is* — so the buffer learns it from the
		// answer rather than from an error.
		missing: gone,
	});

	// **Measured from the baselines, so typing cannot pull the editor out from
	// under the reader.** Both sides are stable while the buffer is dirty — the
	// text lives in a ref — and a save that makes the file match the index is a
	// diff with nothing left in it, which is worth saying.
	const identical = !pending && !dirty && (original?.contents ?? '') === (modified?.contents ?? '');
	// The footer's label: which of the reasons applies, or nothing at all when
	// this side is a file the reader can write. A file that is not there is the
	// one of the three the mode does not decide.
	const reason = modeReason ?? fileReason ?? (gone ? 'deleted — read-only' : null);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{showBanner && (
				<ConflictBanner
					deleted={deleted}
					onReload={() => void reload()}
					// No "Show diff" here: this *is* the diff, and its left side is
					// the index or a commit rather than the disk the banner is about.
					onShowDiff={null}
					showingDiff={false}
					onDismiss={dismiss}
				/>
			)}
			<div className="min-h-0 flex-1">
				{pending && <Centered>Loading…</Centered>}
				{!pending && error && <Centered tone="error">{errorText(error)}</Centered>}
				{!pending && !error && binary && (
					<Centered>{`Cannot preview binary file (${formatBytes(bytesOf(leftQ.data ?? null, rightQ.data ?? null))}).`}</Centered>
				)}
				{!pending && !error && !binary && identical && <Centered>No changes.</Centered>}
				{!pending && !error && !binary && !identical && (
					<DiffEditor
						original={original?.contents ?? ''}
						// The disk contents this edit is against, not the live text:
						// a keystroke must not recreate the editor. Same rule, and the
						// same `baseline`/`bufferRef` pair, as `FileView`'s.
						modified={(editable ? baseline : null) ?? modified?.contents ?? ''}
						bufferRef={editable ? bufferRef : null}
						language={languageForFile(basename(path))}
						inline={inline}
						readOnly={!editable}
						onDirtyChange={noteDirty}
						onSave={requestSave}
					/>
				)}
			</div>

			{/* Same shape as `FileView`'s footer, and for the same reason: this row
			    lives in a column the user drags, so it is a `@container` whose one
			    label drops when the width does (ADR-0037). */}
			<footer className="@container flex h-7 shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap border-t border-border px-3 text-muted-foreground text-xs">
				<Button
					variant="quiet"
					size="sm"
					className="-ml-1 h-6 shrink-0 gap-1.5 px-2 font-normal text-xs [&_svg]:-translate-y-px [&_svg]:size-3"
					aria-pressed={inline}
					title={inline ? 'Split' : 'Inline'}
					onClick={() => setInline(!inline)}
				>
					{inline ? <Columns2 /> : <Rows2 />}
					<span className="@max-[22rem]:hidden">{inline ? 'Split' : 'Inline'}</span>
				</Button>
				<span className="min-w-0 truncate">{sides ? sides.label : modeLabel(mode)}</span>

				{/* One spacer, not one per right-hand item: two would leave whatever
				    sits between them floating in the middle of the row. */}
				<span className="flex-1" />

				{truncated && (
					/* Say so rather than lying by omission: a truncated side means
					   the diff above is only the part we read. */
					<span className="text-primary">truncated</span>
				)}
				{/* **Which kind of read-only** (F26). A diff of a commit is not
				    read-only for the same reason a truncated file is, and a footer
				    that says only `read-only` leaves the reader to guess which. */}
				{reason && <span data-testid="viewer-read-only">{reason}</span>}
				{saveError && (
					<span className="min-w-0 truncate text-destructive" data-testid="viewer-save-error">
						{saveError}
					</span>
				)}
				{editable && (
					<SaveButton dirty={dirty} saving={saving} conflict={conflict} onSave={requestSave} />
				)}
			</footer>

			<OverwriteConfirm
				open={confirmOverwrite}
				name={basename(path)}
				onCancel={cancelOverwrite}
				onConfirm={confirmedSave}
			/>
		</div>
	);
}

const MODE_LABELS: Record<'staged' | 'unstaged' | 'head', string> = {
	staged: 'HEAD ↔ index',
	unstaged: 'index ↔ working tree',
	head: 'HEAD ↔ working tree',
};

/** What the footer calls the two revisions.
 *
 *  A commit range gets its own line rather than falling out of the lookup as
 *  `undefined`: F18 can open `<parent>..<sha>`, and the row above the editor
 *  went blank for every one of them. Short SHAs, because the footer is 288px
 *  wide at worst and eighty hex characters is not a label. */
function modeLabel(mode: DiffMode): string {
	const range = parseCommitRange(mode);
	if (!range) return MODE_LABELS[mode as 'staged' | 'unstaged' | 'head'];
	const short = (sha: string) => sha.slice(0, 7);
	return range.left ? `${short(range.left)} ↔ ${short(range.right)}` : `∅ ↔ ${short(range.right)}`;
}

/** A worktree side that no longer exists on disk is a deleted file — empty,
 *  not an error, same rule `git_blob` follows for a missing revision. */
async function readWorktree(path: string): Promise<FileContents | null> {
	try {
		return await cmd.readFile(path);
	} catch (e) {
		if (e && typeof e === 'object' && 'kind' in e && e.kind === 'NotFound') return null;
		throw e;
	}
}

function bytesOf(a: FileContents | null, b: FileContents | null): number {
	return Math.max(a?.size ?? 0, b?.size ?? 0);
}

interface DiffEditorProps {
	original: string;
	/** The right-hand side's baseline — what it was read as, not what the
	 *  reader has typed since. */
	modified: string;
	/** The live text of an editable right-hand side, or null when this diff is
	 *  read-only. Written here so it survives the editor being recreated. */
	bufferRef: MutableRefObject<string> | null;
	language: string;
	inline: boolean;
	readOnly: boolean;
	onDirtyChange: (dirty: boolean) => void;
	onSave: () => void;
}

/**
 * Monaco diff host. Same lifecycle rule as `FileView`'s editor and the
 * terminal: create in an effect, dispose on unmount, never through state.
 *
 * **Find works here too**, and it arrived with the import rather than with any
 * code (F7 § "Find"): reviewing a diff is exactly where you go looking for a
 * symbol. The widget belongs to the **modified** side — the one a reviewer
 * reads, and now the one they may be typing in.
 *
 * **`readOnly` is the modified side's**, which is what `createDiffEditor`
 * means by it; `originalEditable` stays off, so the left side is never
 * writable whatever the mode. The right side, when it is the working tree,
 * carries everything `FileView`'s editor does for the same buffer: the file's
 * own EOL, dirty from Monaco's alternative version id rather than a string
 * comparison, `Cmd/Ctrl+S` bound inside the host only, and a view state that
 * survives the editor being recreated by a save (F26).
 */
function DiffEditor({
	original,
	modified,
	bufferRef,
	language,
	inline,
	readOnly,
	onDirtyChange,
	onSave,
}: DiffEditorProps) {
	const hostRef = useRef<HTMLDivElement>(null);
	const findSink = useFindHandleSink();
	const viewStateRef = useRef<monaco.editor.IDiffEditorViewState | null>(null);
	const modelsRef = useRef<{
		original: monaco.editor.ITextModel;
		modified: monaco.editor.ITextModel;
	} | null>(null);
	/** The modified model's version id at the last point it matched disk. */
	const cleanVersionRef = useRef(0);
	/** The baseline the modified model currently stands on, so the effect below
	 *  can tell "a new one arrived" from "this is the first run". */
	const appliedBaselineRef = useRef<string | null>(null);
	/** The two texts, for the creation effect — which must not *depend* on them.
	 *  See the effect for why. */
	const textRef = useRef({ original, modified });
	textRef.current = { original, modified };
	/** Save through a ref: the handler's identity changes on every render, and
	 *  a dep on it would recreate the editor mid-keystroke. */
	const onSaveRef = useRef(onSave);
	onSaveRef.current = onSave;
	const onDirtyRef = useRef(onDirtyChange);
	onDirtyRef.current = onDirtyChange;

	/**
	 * **Creation only. Neither text is a dependency**, and that is the fix for a
	 * crash rather than an optimisation (2026-09-09).
	 *
	 * Disposing a diff editor's models while its worker is mid-`computeDiff`
	 * makes the worker answer `null` for a model it no longer holds, and
	 * Monaco's provider turns that into a bare `Error: no diff result
	 * available` — the same disposed-mid-flight race `lib/globalErrors.ts`
	 * already ignores in its `CancellationError` form, one tick later and
	 * wearing a different name. Keying this effect on the text meant every Save
	 * tore both models down to show text the editor was already displaying, and
	 * the toast landed on the second or third save.
	 *
	 * So content arrives through the two effects below, which mutate the models
	 * in place. What is left here genuinely needs a new editor: the language,
	 * the split/inline layout, and whether the modified side is writable.
	 */
	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;

		ensureTheme();
		const editor = monaco.editor.createDiffEditor(host, {
			theme: FACTORAI_DARK,
			readOnly,
			domReadOnly: readOnly,
			// The left side is a revision in every mode there is. Nothing here
			// can write one, so it is never editable — not even when the right
			// side is.
			originalEditable: false,
			renderSideBySide: !inline,
			minimap: { enabled: false },
			lineNumbers: 'on',
			wordWrap: 'on',
			wrappingIndent: 'indent',
			scrollBeyondLastLine: false,
			fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
			fontSize: 13,
			// Same reason as the file viewer: inside a dialog that is mid-open the
			// container measures zero, so let Monaco own a ResizeObserver.
			automaticLayout: true,
		});
		const { original: left, modified: baseline } = textRef.current;
		const originalModel = monaco.editor.createModel(left, language);
		// A draft from an earlier visit wins over what was read, exactly as it
		// does in the file view — the buffer is the same buffer.
		const modifiedModel = monaco.editor.createModel(bufferRef?.current ?? baseline, language);
		editor.setModel({ original: originalModel, modified: modifiedModel });
		modelsRef.current = { original: originalModel, modified: modifiedModel };
		appliedBaselineRef.current = baseline;

		const modifiedEditor = editor.getModifiedEditor();
		let contentSub: { dispose: () => void } | undefined;

		if (bufferRef) {
			// The file's own line endings, so a CRLF file saves back as one.
			// Monaco guesses from the text it was given, but only when the text
			// has an ending to guess from (F26 § "What Save writes").
			modifiedModel.setEOL(
				eolOf(baseline) === 'crlf'
					? monaco.editor.EndOfLineSequence.CRLF
					: monaco.editor.EndOfLineSequence.LF,
			);
			// What "clean" is, read after the EOL is set since setting it counts
			// as an edit.
			cleanVersionRef.current = modifiedModel.getAlternativeVersionId();
			contentSub = modifiedModel.onDidChangeContent(() => {
				bufferRef.current = modifiedModel.getValue();
				onDirtyRef.current(modifiedModel.getAlternativeVersionId() !== cleanVersionRef.current);
			});
			// **`Cmd/Ctrl+S`, scoped to the editor.** Not a global binding:
			// `Ctrl+S` reaching a focused terminal is XOFF, which freezes the PTY
			// on Linux — see F26 and roadmap item 5.
			modifiedEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
				onSaveRef.current(),
			);
			if (viewStateRef.current) editor.restoreViewState(viewStateRef.current);
		}

		if (findSink) {
			findSink.current = {
				open: () => openFind(modifiedEditor),
				isRevealed: () => findIsRevealed(modifiedEditor),
			};
		}

		return () => {
			// Before disposal, not after: a disposed editor has no view state to
			// give, and this is the only moment the next one can inherit from.
			if (bufferRef) {
				viewStateRef.current = editor.saveViewState();
				bufferRef.current = modifiedModel.getValue();
			}
			if (findSink) findSink.current = null;
			contentSub?.dispose();
			modelsRef.current = null;
			appliedBaselineRef.current = null;
			// **Detach before disposing**, so the widget stops asking about models
			// that are on their way out — the same race the effect's comment
			// describes, at unmount rather than on a save.
			editor.setModel(null);
			// Models outlive the editor unless disposed explicitly — Monaco keeps
			// them in a global registry, so leaking them leaks the file's contents.
			editor.dispose();
			originalModel.dispose();
			modifiedModel.dispose();
		};
	}, [bufferRef, language, inline, readOnly, findSink]);

	/** A new left-hand revision — the index moved, or the watcher re-read. In
	 *  place, because this side has no buffer to protect and no undo worth
	 *  keeping. */
	useEffect(() => {
		const models = modelsRef.current;
		if (models && models.original.getValue() !== original) models.original.setValue(original);
	}, [original]);

	/**
	 * A new baseline for the right-hand side: a Save adopted the buffer, or a
	 * Reload took disk.
	 *
	 * **The first run is a no-op on purpose.** The creation effect already
	 * seeded the model — possibly from a *draft*, which differs from the
	 * baseline by definition — so writing the baseline over it here would
	 * discard the restored buffer the moment the tab opened. `appliedBaseline`
	 * is what tells the two apart.
	 */
	useEffect(() => {
		const models = modelsRef.current;
		if (!models || appliedBaselineRef.current === modified) return;
		appliedBaselineRef.current = modified;
		// Equal already after a Save — the baseline caught up with the buffer —
		// so there is nothing to write, only a new mark for what clean means.
		if (models.modified.getValue() !== modified) models.modified.setValue(modified);
		if (bufferRef) bufferRef.current = models.modified.getValue();
		cleanVersionRef.current = models.modified.getAlternativeVersionId();
		onDirtyRef.current(false);
	}, [modified, bufferRef]);

	// `relative` for the same reason the file editor's host has it: Monaco
	// renders its hovers into this element, positioned against it.
	return <div ref={hostRef} className="relative h-full w-full" data-testid="diff-view-editor" />;
}
