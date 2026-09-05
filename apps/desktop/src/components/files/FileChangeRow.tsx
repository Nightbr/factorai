import type { GitChangeKind } from '@factorai/types';
import { FileIcon } from '@components/files/FileIcon';

interface FileChangeRowProps {
	/** Path relative to the project, `../` and all — that prefix is what makes a
	 *  change above the project read as not-yours. */
	relPath: string;
	/** Previous path for a rename, shown in the row's title. */
	oldRelPath: string | null;
	kind: GitChangeKind;
	additions: number | null;
	deletions: number | null;
	isBinary: boolean;
	onClick: () => void;
}

/**
 * One changed-file row: icon, dimmed parent path, basename, `+N −M`, status letter.
 *
 * Shared by F13's Changes tab and F18's commit detail pane. It takes the fields
 * explicitly rather than a `GitChange`, because a commit's diff is not staged,
 * unstaged or conflicted — passing one of those groups just to reuse the type
 * would put a lie in the payload to save an interface. The presentation is the
 * part worth sharing; the shape isn't.
 */
export function FileChangeRow({
	relPath,
	oldRelPath,
	kind,
	additions,
	deletions,
	isBinary,
	onClick,
}: FileChangeRowProps) {
	const { dir, name } = splitPath(relPath);

	return (
		<li>
			<button
				type="button"
				title={oldRelPath ? `${relPath} ← ${oldRelPath}` : relPath}
				className="flex w-full items-center gap-1.5 py-[3px] pr-2 pl-3 text-left text-muted-foreground text-sm transition-colors hover:bg-secondary/50"
				onClick={onClick}
			>
				<FileIcon fileName={name} />
				{/* Path first, filename last, with the ellipsis between them (F13) — the
				    filename was first until 2026-09-05, and at 288px one
				    `frontend/apps/web/src/features/…` pushed every name in the list off
				    the left edge. The two halves shrink in sequence rather than in
				    proportion: the directory's shrink factor is large enough that it
				    collapses to nothing and freezes there before the filename gives up a
				    single pixel, so the name survives whole down to the width of the name
				    itself. Nothing is a deliberate floor — a `min-w-*` on the directory
				    wide enough to draw a bare `…` is also wide enough to open a gap after
				    a short `src`, and a narrower one renders the ellipsis clipped, as
				    `d..`. The separator survives either way and is its own `shrink-0`
				    span, because a `/` living at the end of the directory string is the
				    first character `text-overflow` eats, which leaves `…person.ts`. The
				    run is `flex-1`, so the space the path does not use is what pins the
				    counts and the status letter to the right edge. `title` on the button
				    has the full path when either half is clipped. */}
				<span className="flex min-w-0 flex-1 items-center">
					{dir && (
						<>
							<span className="min-w-0 shrink-[9999] truncate text-muted-foreground">{dir}</span>
							<span className="shrink-0 text-muted-foreground">/</span>
						</>
					)}
					<span className="min-w-0 truncate text-foreground">{name}</span>
				</span>
				<LineCounts additions={additions} deletions={deletions} isBinary={isBinary} />
				<span
					aria-label={KIND_LABELS[kind]}
					title={KIND_LABELS[kind]}
					className={`w-3 shrink-0 text-center font-medium text-xs ${KIND_CLASSES[kind]}`}
				>
					{KIND_LETTERS[kind]}
				</span>
			</button>
		</li>
	);
}

function LineCounts({
	additions,
	deletions,
	isBinary,
}: {
	additions: number | null;
	deletions: number | null;
	isBinary: boolean;
}) {
	// Binary and over-cap rows keep their place in the list and simply carry no
	// counts — the row is the information, the numbers are a bonus.
	if (isBinary) return <span className="shrink-0 text-muted-foreground/60 text-xs">bin</span>;
	if (additions === null && deletions === null) return null;
	return (
		<span className="shrink-0 gap-1 text-xs tabular-nums">
			{additions ? <span className="text-emerald-500">+{additions}</span> : null}
			{deletions ? <span className="ml-1 text-rose-500">−{deletions}</span> : null}
		</span>
	);
}

/** The directory the row shows dimmed, plus the basename it shows bright.
 *  A change above the project keeps its `../` so it reads as not-yours. */
function splitPath(relPath: string): { dir: string; name: string } {
	const i = relPath.lastIndexOf('/');
	return i >= 0
		? { dir: relPath.slice(0, i), name: relPath.slice(i + 1) }
		: { dir: '', name: relPath };
}

const KIND_LETTERS: Record<GitChangeKind, string> = {
	modified: 'M',
	added: 'A',
	deleted: 'D',
	renamed: 'R',
	typechange: 'T',
	untracked: 'U',
	conflicted: 'C',
};

const KIND_LABELS: Record<GitChangeKind, string> = {
	modified: 'Modified',
	added: 'Added',
	deleted: 'Deleted',
	renamed: 'Renamed',
	typechange: 'Type changed',
	untracked: 'Untracked',
	conflicted: 'Conflicted',
};

/** Git's own colour semantics, expressed in the app's palette rather than new
 *  hex values (F13). */
const KIND_CLASSES: Record<GitChangeKind, string> = {
	modified: 'text-amber-500',
	added: 'text-emerald-500',
	deleted: 'text-rose-500',
	renamed: 'text-sky-500',
	typechange: 'text-amber-500',
	untracked: 'text-emerald-500',
	conflicted: 'text-rose-500',
};
