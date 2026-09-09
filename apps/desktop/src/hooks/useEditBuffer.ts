import type { FileContents } from '@factorai/types';
import { useQueryClient } from '@tanstack/react-query';
import { type MutableRefObject, useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from '@components/viewer/chrome';
import { cmd } from '@lib/tauri';
import { draftFor, useDraftStore } from '@store/draftStore';

/**
 * One unsaved buffer over one file on disk (specs/05-features.md F26).
 *
 * **Extracted from `FileView` when the diff view became editable**
 * (ADR-0041). Everything here was written for the file editor and none of it
 * is specific to it: a buffer, what it is measured against, whether something
 * else wrote the file underneath it, and the one write at the end. The diff
 * view's modified side is the same file through a different window, so it gets
 * the same machinery rather than a second, subtly different copy of it — a
 * second copy is how one of the two surfaces ends up discarding an edit the
 * other would have kept.
 *
 * What is *not* here is anything about Monaco. The hook owns the text and the
 * write; the component owns the editor, and the two meet at `bufferRef` and
 * `noteDirty`.
 */

interface EditBufferInput {
	/** Absolute path. The write target, and the key the draft is kept under —
	 *  so a buffer typed in the diff view is the same buffer the file view
	 *  shows, which is what a reader who switches between them expects. */
	path: string;
	/** The last read of that file, or null/undefined while the read is in
	 *  flight, failed, or the file is not there. */
	file: FileContents | null | undefined;
	/** Whether this surface will write at all. Policy, and the caller's:
	 *  `FileView` asks `readOnlyReason`, and `DiffView` refuses on top of that
	 *  every side that is a git object rather than a file. */
	editable: boolean;
	/** Where the written contents go afterwards. `write_file` answers with the
	 *  file it wrote precisely so the cache can be corrected without a second
	 *  pass over bytes we just held. */
	cacheKey: readonly unknown[];
	/** Back to disk, for the banner's Reload. */
	refetch: () => Promise<{ data?: FileContents | null }>;
	/** The file is gone from disk. Computed by the caller because the two
	 *  callers learn it differently — a rejected read on one side, an absent
	 *  worktree blob on the other. */
	missing: boolean;
}

interface EditBuffer {
	/** The disk contents this edit is against: what the editor is created
	 *  from, what dirty is measured from, and what a conflict is detected
	 *  against. Null until the first read lands. */
	baseline: string | null;
	/** The live text. A ref rather than state because a keystroke must not
	 *  re-render the footer, and because it has to survive the editor being
	 *  unmounted — for a markdown preview, or for a diff going identical. */
	bufferRef: MutableRefObject<string>;
	dirty: boolean;
	saving: boolean;
	saveError: string | null;
	/** Report Monaco's own answer to "does this differ from what I opened
	 *  with". Going clean deletes the draft (F26 § Save). */
	noteDirty: (dirty: boolean) => void;
	/** Save, asking first when it would write over a change nobody has read. */
	requestSave: () => void;
	/** Something else wrote the file while this buffer was dirty. */
	conflict: boolean;
	/** …or deleted it. */
	deleted: boolean;
	/** Whether to draw the banner — a conflict the reader has not dismissed. */
	showBanner: boolean;
	/** Keep typing over an unread change. Save becomes Overwrite. */
	dismiss: () => void;
	/** Throw the buffer away and take disk. */
	reload: () => Promise<void>;
	showConflictDiff: boolean;
	toggleConflictDiff: () => void;
	/** The overwrite confirm, open. */
	confirmOverwrite: boolean;
	cancelOverwrite: () => void;
	/** Write, having been told to. */
	confirmedSave: () => void;
}

export function useEditBuffer({
	path,
	file,
	editable,
	cacheKey,
	refetch,
	missing,
}: EditBufferInput): EditBuffer {
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
	const [confirmOverwrite, setConfirmOverwrite] = useState(false);
	const setDraft = useDraftStore((s) => s.setDraft);
	const clearDraft = useDraftStore((s) => s.clearDraft);

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

	// A draft from an earlier visit means the file is dirty before a key is
	// pressed. Gated on the seeding above, and re-run when the read lands,
	// because until there is a buffer there is nothing for the draft to be a
	// draft *of*: a surface that never seeds one — a commit diff, which cannot
	// be written — must not report itself dirty over a draft it is not showing.
	useEffect(() => {
		if (!file || !seeded.current) return;
		if (draftFor(path) !== undefined) setDirty(true);
	}, [path, file]);

	/**
	 * **Going clean drops the draft**, and that is the whole of the way back now
	 * that there is no Revert control: undo until the editor matches disk and the
	 * file is genuinely unedited again — the tab loses its mark and nothing is
	 * kept for the next visit. Without this the draft would outlive the edit it
	 * recorded, and reopening the file would mark it dirty against a buffer
	 * identical to disk.
	 */
	const noteDirty = useCallback(
		(next: boolean) => {
			setDirty(next);
			if (!next) clearDraft(path);
		},
		[clearDraft, path],
	);

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
	const dirtyRef = useRef(false);
	dirtyRef.current = dirty;
	useEffect(() => {
		return () => {
			// `seeded` for the same reason: an unseeded buffer is the empty string,
			// and writing that back would erase the draft rather than keep it.
			if (seeded.current && dirtyRef.current) setDraft(path, bufferRef.current);
		};
	}, [path, setDraft]);

	const diskContents = file?.contents ?? null;
	/** Something else wrote the file while this buffer was dirty (F26). */
	const conflict = dirty && diskContents !== null && baseline !== null && diskContents !== baseline;
	const deleted = dirty && missing;
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
			queryClient.setQueryData(cacheKey, written);
			adopt(text);
		} catch (e) {
			// **The buffer stays dirty.** A failed write leaves the text the reader
			// typed as the only copy of it, and discarding that to report an error
			// would be the worst thing this component could do.
			setSaveError(errorText(e));
		} finally {
			setSaving(false);
		}
	}, [adopt, cacheKey, path, queryClient]);

	/** Save, asking first when it would overwrite a change nobody has read. */
	const requestSave = useCallback(() => {
		if (!editable || !dirty || saving) return;
		if (conflict) {
			setConfirmOverwrite(true);
			return;
		}
		void save();
	}, [conflict, dirty, editable, save, saving]);

	/** Throw the buffer away and take what is on disk — the banner's Reload.
	 *
	 *  Re-reads rather than reusing what the query holds: the cached copy may
	 *  predate the change that made the reader want disk back. */
	const reload = useCallback(async () => {
		const { data } = await refetch();
		adopt(data?.contents ?? '');
	}, [adopt, refetch]);

	return {
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
		dismiss: () => setDismissedDisk(diskContents),
		reload,
		showConflictDiff,
		toggleConflictDiff: () => setShowConflictDiff((s) => !s),
		confirmOverwrite,
		cancelOverwrite: () => setConfirmOverwrite(false),
		confirmedSave: () => {
			setConfirmOverwrite(false);
			void save();
		},
	};
}
