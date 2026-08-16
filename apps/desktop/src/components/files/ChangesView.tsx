import type { GitChange, GitChangeKind, GitGroup } from '@factorai/types';
import { FileIcon } from '@components/files/FileIcon';
import { useFileViewer } from '@hooks/useFileViewer';
import { useGitStatus } from '@hooks/useGitStatus';

/**
 * The panel's Changes tab (specs/05-features.md F13).
 *
 * Read-only: rows open a diff, nothing stages or discards. Groups are ordered
 * conflicts → staged → unstaged, because during a rebase the conflicts are the
 * only thing that matters.
 */
export function ChangesView() {
	const { status, isPending, root } = useGitStatus();

	if (!root) return <Empty>Select a project to see its changes.</Empty>;
	if (isPending && !status) return <Empty>Loading…</Empty>;
	if (!status?.repoRoot) return <Empty>Not a git repository.</Empty>;
	if (status.changes.length === 0) return <Empty>No changes.</Empty>;

	const groups: { group: GitGroup; label: string }[] = [
		{ group: 'conflicted', label: 'Merge Changes' },
		{ group: 'staged', label: 'Staged Changes' },
		{ group: 'unstaged', label: 'Changes' },
	];

	return (
		<div data-testid="changes-view">
			{groups.map(({ group, label }) => {
				const rows = status.changes.filter((c) => c.group === group);
				if (rows.length === 0) return null;
				return (
					<section key={group}>
						<h3 className="flex items-center gap-1.5 px-3 py-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
							{label}
							<span className="text-muted-foreground/60">{rows.length}</span>
						</h3>
						<ul>
							{rows.map((change) => (
								<ChangeRow key={`${change.group}:${change.path}`} change={change} />
							))}
						</ul>
					</section>
				);
			})}
			{status.truncated && (
				<p className="px-3 py-2 text-muted-foreground/60 text-xs">
					… {status.total - status.changes.length} more changes
				</p>
			)}
		</div>
	);
}

function ChangeRow({ change }: { change: GitChange }) {
	const { open } = useFileViewer();
	const { dir, name } = splitPath(change.relPath);

	// Which pair the diff compares is the row's group: a staged row has no side
	// on disk at all (F13).
	const diff =
		change.group === 'staged' ? 'staged' : change.group === 'unstaged' ? 'unstaged' : 'head';

	return (
		<li>
			<button
				type="button"
				title={change.oldRelPath ? `${change.relPath} ← ${change.oldRelPath}` : change.relPath}
				className="flex w-full items-center gap-1.5 py-[3px] pr-2 pl-3 text-left text-muted-foreground text-sm transition-colors hover:bg-secondary/50"
				onClick={() => open(change.path, diff)}
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
				<LineCounts change={change} />
				<span
					aria-label={KIND_LABELS[change.kind]}
					title={KIND_LABELS[change.kind]}
					className={`w-3 shrink-0 text-center font-medium text-xs ${KIND_CLASSES[change.kind]}`}
				>
					{KIND_LETTERS[change.kind]}
				</span>
			</button>
		</li>
	);
}

function LineCounts({ change }: { change: GitChange }) {
	// Binary and over-cap rows keep their place in the list and simply carry no
	// counts — the row is the information, the numbers are a bonus.
	if (change.isBinary)
		return <span className="shrink-0 text-muted-foreground/60 text-xs">bin</span>;
	if (change.additions === null && change.deletions === null) return null;
	return (
		<span className="shrink-0 gap-1 text-xs tabular-nums">
			{change.additions ? <span className="text-emerald-500">+{change.additions}</span> : null}
			{change.deletions ? <span className="ml-1 text-rose-500">−{change.deletions}</span> : null}
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

function Empty({ children }: { children: string }) {
	return <p className="px-3 py-2 text-muted-foreground text-xs">{children}</p>;
}
