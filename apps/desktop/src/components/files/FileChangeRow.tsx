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
 * One changed-file row: icon, basename, dimmed directory, `+N −M`, status letter.
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
				{/* Both halves of the path shrink, or the row sets a min-content width
				    the panel can't meet and the whole list scrolls sideways — one
				    `0004_workspace_projects.sql` was enough to push every other row's
				    name off the left edge. They shrink in proportion to their own
				    length (`grow`, not `flex-1`, keeps the directory's basis at its
				    content size), so the long half gives up the space and a short
				    filename beside a deep path stays whole. `title` on the button has
				    the full path when both end up clipped. */}
				<span className="min-w-0 truncate text-foreground">{name}</span>
				{dir && (
					<span className="min-w-0 grow truncate text-muted-foreground/60 text-xs">{dir}</span>
				)}
				{!dir && <span className="flex-1" />}
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

/** Basename plus the directory it sits in, which is what the row shows dimmed.
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
