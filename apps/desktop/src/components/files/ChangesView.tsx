import type { GitChange, GitGroup } from '@factorai/types';
import { FileChangeRow } from '@components/files/FileChangeRow';
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

	// Which pair the diff compares is the row's group: a staged row has no side
	// on disk at all (F13).
	const diff =
		change.group === 'staged' ? 'staged' : change.group === 'unstaged' ? 'unstaged' : 'head';

	return (
		<FileChangeRow
			relPath={change.relPath}
			oldRelPath={change.oldRelPath}
			kind={change.kind}
			additions={change.additions}
			deletions={change.deletions}
			isBinary={change.isBinary}
			onClick={() => open(change.path, diff)}
		/>
	);
}

function Empty({ children }: { children: string }) {
	return <p className="px-3 py-2 text-muted-foreground text-xs">{children}</p>;
}
