import { useQuery } from '@tanstack/react-query';
import { IconButton } from '@factorai/ui';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { FileChangeRow } from '@components/files/FileChangeRow';
import { useFileViewer } from '@hooks/useFileViewer';
import { formatAbsolute, formatRelative } from '@lib/format';
import { queryKeys } from '@lib/queryKeys';
import { cmd } from '@lib/tauri';

interface CommitDetailProps {
	projectPath: string;
	sha: string;
	/** Select another commit in the graph — what a parent chip does. */
	onSelectSha: (sha: string) => void;
}

/**
 * The pane docked under the graph (specs/05-features.md F18).
 *
 * Click goes deeper: this is the half the hover card deliberately doesn't carry,
 * because a body and a file list want room and a card big enough for them would
 * cover the graph you are reading.
 */
export function CommitDetail({ projectPath, sha, onSelectSha }: CommitDetailProps) {
	const { open } = useFileViewer();
	const query = useQuery({
		queryKey: queryKeys.gitCommit(projectPath, sha),
		queryFn: () => cmd.gitCommit(projectPath, sha),
		// A commit is immutable, so once fetched there is nothing to refresh. This
		// is the one git query in the app that should never poll.
		staleTime: Number.POSITIVE_INFINITY,
	});

	if (query.isPending) return <Note>Loading commit…</Note>;
	// Null rather than an error: a row clicked after the branch it was on was
	// force-pushed is stale, and a toast would be the wrong shape for that.
	if (!query.data) return <Note>That commit is no longer in the repository.</Note>;

	const detail = query.data;

	return (
		<div data-testid="commit-detail" className="flex h-full flex-col overflow-y-auto">
			<div className="flex items-start gap-1 px-3 pt-2">
				<p className="min-w-0 flex-1 font-medium text-sm">
					{detail.subject || <em className="text-muted-foreground">no message</em>}
				</p>
				<CopySha sha={detail.sha} shortSha={detail.shortSha} />
			</div>

			{detail.body && (
				// `whitespace-pre-wrap`: a commit body's own line breaks are the
				// author's, and reflowing them turns a bullet list into a paragraph.
				//
				// **Capped, and it scrolls itself.** Found in the app rather than in a
				// test: at the default 200px pane, one of this repo's own merge
				// commits pushed the author line, the parents and the whole file list
				// below the fold, so clicking a commit appeared to show only prose.
				// The body is context; the files are what you clicked for, so the body
				// is the part that gives up space.
				<p className="max-h-20 shrink-0 overflow-y-auto whitespace-pre-wrap px-3 pt-1 text-muted-foreground text-xs">
					{detail.body}
				</p>
			)}

			<p className="px-3 pt-1.5 text-muted-foreground text-xs">
				{detail.authorName}
				<span className="text-muted-foreground/60">
					{' · '}
					{formatRelative(detail.authorTime)}
					{' · '}
					{formatAbsolute(detail.authorTime)}
				</span>
			</p>

			{detail.parents.length > 0 && (
				<p className="flex flex-wrap items-baseline gap-1.5 px-3 pt-1.5 text-xs">
					<span className="text-muted-foreground/60">
						{detail.parents.length > 1 ? 'Parents' : 'Parent'}
					</span>
					{detail.parents.map((parent, index) => (
						<button
							key={parent}
							type="button"
							// Selecting the parent rather than opening anything: the graph is
							// right there, and jumping the selection is how you walk history.
							onClick={() => onSelectSha(parent)}
							title={
								index === 0 && detail.parents.length > 1
									? `${parent} — the parent this diff is against`
									: parent
							}
							className="font-mono text-muted-foreground transition-colors hover:text-primary"
						>
							{parent.slice(0, 7)}
							{/* A merge's file list is the diff against parent 1, and saying
							    so beats making the reader remember the convention. */}
							{index === 0 && detail.parents.length > 1 && (
								<span className="text-muted-foreground/60"> (diffed)</span>
							)}
						</button>
					))}
				</p>
			)}

			<h3 className="flex items-center gap-1.5 px-3 pt-2.5 pb-0.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
				{detail.diffParent ? 'Changes' : 'Added in this commit'}
				<span className="text-muted-foreground/60">{detail.total}</span>
			</h3>
			{detail.files.length === 0 ? (
				<Note>This commit changes nothing.</Note>
			) : (
				<ul className="pb-2">
					{detail.files.map((file) => (
						<FileChangeRow
							key={file.path}
							relPath={file.relPath}
							oldRelPath={file.oldRelPath}
							kind={file.kind}
							additions={file.additions}
							deletions={file.deletions}
							isBinary={file.isBinary}
							// Git's own range notation, both ends explicit, so nothing in
							// the renderer has to resolve `sha^`. A root commit has no left
							// side, so the empty tree stands in for it.
							onClick={() => open(file.path, `${detail.diffParent ?? ''}..${detail.sha}`)}
						/>
					))}
				</ul>
			)}
			{detail.truncated && (
				<p className="px-3 pb-2 text-muted-foreground/60 text-xs">
					… {detail.total - detail.files.length} more files
				</p>
			)}
		</div>
	);
}

function CopySha({ sha, shortSha }: { sha: string; shortSha: string }) {
	const [copied, setCopied] = useState(false);

	return (
		<IconButton
			aria-label={copied ? 'Copied' : `Copy ${shortSha}`}
			title={copied ? 'Copied' : `Copy ${sha}`}
			className="shrink-0"
			onClick={async () => {
				await navigator.clipboard.writeText(sha);
				setCopied(true);
				window.setTimeout(() => setCopied(false), 1200);
			}}
		>
			{/* The full SHA goes to the clipboard, the short one is what's shown —
			    nobody wants 40 characters pasted into a terminal, but a truncated
			    SHA in a `git show` is a coin flip in a big repo. */}
			{copied ? <Check /> : <Copy />}
			<span className="ml-1 font-mono text-xs">{shortSha}</span>
		</IconButton>
	);
}

function Note({ children }: { children: string }) {
	return <p className="px-3 py-2 text-muted-foreground text-xs">{children}</p>;
}
