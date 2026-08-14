import type { FileContents } from '@factorai/types';
import { Button } from '@factorai/ui';
import { useQuery } from '@tanstack/react-query';
import { Columns2, Rows2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { DiffMode } from '@hooks/useFileViewer';
import { formatBytes } from '@lib/format';
import { cmd } from '@lib/tauri';
import { queryKeys } from '@lib/queryKeys';
import { ensureTheme, FACTORAI_DARK, languageForFile, monaco } from '@components/viewer/monaco';
import { usePanelStore } from '@store/panelStore';

/**
 * Diff of one file between two revisions (specs/05-features.md F8, F13).
 *
 * Which two depends on the mode, because a staged change has no side on disk:
 * `staged` is HEAD ↔ index, `unstaged` is index ↔ worktree, and `head` is
 * HEAD ↔ worktree for conflicted rows (markers and all — there is no 3-way
 * merge editor here).
 *
 * A missing side is **empty, not an error**: that is what added and deleted
 * look like, and they are the two most ordinary rows in the Changes list.
 */

interface DiffViewProps {
	path: string;
	mode: DiffMode;
}

/** The two revisions a mode compares. `null` means the worktree — `read_file`
 *  rather than `git_blob`. */
function sidesFor(mode: DiffMode): { left: 'head' | 'index'; right: 'index' | null } {
	switch (mode) {
		case 'staged':
			return { left: 'head', right: 'index' };
		case 'unstaged':
			return { left: 'index', right: null };
		case 'head':
			return { left: 'head', right: null };
	}
}

function basename(path: string): string {
	const i = path.lastIndexOf('/');
	return i >= 0 ? path.slice(i + 1) : path;
}

export function DiffView({ path, mode }: DiffViewProps) {
	const inline = usePanelStore((s) => s.diffInline);
	const setInline = usePanelStore((s) => s.setDiffInline);
	const { left, right } = sidesFor(mode);

	const leftQ = useQuery({
		queryKey: queryKeys.gitBlob(path, left),
		queryFn: () => cmd.gitBlob(path, left),
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
	const rightQ = useQuery({
		queryKey: right ? queryKeys.gitBlob(path, right) : queryKeys.file(path, false),
		queryFn: () => (right ? cmd.gitBlob(path, right) : readWorktree(path)),
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});

	const pending = leftQ.isPending || rightQ.isPending;
	const error = leftQ.error ?? rightQ.error;
	// Both sides absent means the file exists at neither revision — nothing to
	// show, and not worth an error either.
	const original = leftQ.data ?? null;
	const modified = rightQ.data ?? null;
	const binary = original?.isBinary || modified?.isBinary;
	const identical = !pending && (original?.contents ?? '') === (modified?.contents ?? '');
	const truncated = original?.truncated || modified?.truncated;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="min-h-0 flex-1">
				{pending && <Centered>Loading…</Centered>}
				{!pending && error && <Centered tone="error">{errorText(error)}</Centered>}
				{!pending && !error && binary && (
					<Centered>{`Cannot preview binary file (${formatBytes(bytesOf(original, modified))}).`}</Centered>
				)}
				{!pending && !error && !binary && identical && <Centered>No changes.</Centered>}
				{!pending && !error && !binary && !identical && (
					<DiffEditor
						original={original?.contents ?? ''}
						modified={modified?.contents ?? ''}
						language={languageForFile(basename(path))}
						inline={inline}
					/>
				)}
			</div>

			<footer className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-1.5 text-muted-foreground text-xs">
				<Button
					variant="ghost"
					size="sm"
					className="-ml-1 h-6 gap-1.5 px-2 text-xs"
					aria-pressed={inline}
					onClick={() => setInline(!inline)}
				>
					{inline ? <Columns2 className="size-3.5" /> : <Rows2 className="size-3.5" />}
					{inline ? 'Split' : 'Inline'}
				</Button>
				<span>{MODE_LABELS[mode]}</span>
				<span aria-hidden="true">·</span>
				<span>read-only</span>
				{truncated && (
					<>
						<span className="flex-1" />
						{/* Say so rather than lying by omission: a truncated side means
						    the diff below is only the part we read. */}
						<span className="text-primary">truncated</span>
					</>
				)}
			</footer>
		</div>
	);
}

const MODE_LABELS: Record<DiffMode, string> = {
	staged: 'HEAD ↔ index',
	unstaged: 'index ↔ working tree',
	head: 'HEAD ↔ working tree',
};

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
	modified: string;
	language: string;
	inline: boolean;
}

/** Monaco diff host. Same lifecycle rule as `FileView`'s editor and the
 *  terminal: create in an effect, dispose on unmount, never through state. */
function DiffEditor({ original, modified, language, inline }: DiffEditorProps) {
	const hostRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;

		ensureTheme();
		const editor = monaco.editor.createDiffEditor(host, {
			theme: FACTORAI_DARK,
			readOnly: true,
			domReadOnly: true,
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
		const originalModel = monaco.editor.createModel(original, language);
		const modifiedModel = monaco.editor.createModel(modified, language);
		editor.setModel({ original: originalModel, modified: modifiedModel });

		return () => {
			// Models outlive the editor unless disposed explicitly — Monaco keeps
			// them in a global registry, so leaking them leaks the file's contents.
			editor.dispose();
			originalModel.dispose();
			modifiedModel.dispose();
		};
	}, [original, modified, language, inline]);

	return <div ref={hostRef} className="h-full w-full" data-testid="diff-view-editor" />;
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
		return String((e as { message: unknown }).message);
	}
	return String(e);
}
