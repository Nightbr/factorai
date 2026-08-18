import { useQuery } from '@tanstack/react-query';
import { IconButton } from '@factorai/ui';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { FileChangeRow } from '@components/files/FileChangeRow';
import { useFileViewer } from '@hooks/useFileViewer';
import { formatAbsolute, formatRelative } from '@lib/format';
import { queryKeys } from '@lib/queryKeys';
import { cmd } from '@lib/tauri';

/**
 * Which half of the pane is showing.
 *
 * **The pane was one scrolling column and is now two tabs (2026-08-18, on user
 * feedback).** Everything was stacked — subject, body, author, parents, then the
 * file list — so at the default height the chrome could fill the pane on its
 * own and clicking a commit showed everything about it except the files you
 * clicked for. The body had already been capped at 80px to fight this, which
 * treated the symptom and cost the body its readability. Tabs give each half the
 * whole pane instead of rationing one column between them, which at 288px is the
 * only version of this that works.
 */
type DetailTabId = 'changes' | 'description';

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
	// **Changes first**, because it is what the pane is for and what the feedback
	// was about — the hover card already carries the subject, refs, author and
	// date, so the files are the reason to click at all. Held here rather than in
	// `panelStore`: it is a reading position, not a preference. It follows you
	// from commit to commit within a sitting, which is what you want while
	// walking a history, and starts back on Changes next launch.
	const [tab, setTab] = useState<DetailTabId>('changes');
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
		<div className="flex h-full flex-col">
			{/* **Everything above the tabs is identity, not content** (arranged this
			    way on user feedback, 2026-08-18). Subject, SHA, author, date and
			    parents describe *which* commit you are looking at; the tabs below
			    choose *what about it* you are reading. Putting the metadata in a tab
			    made you switch away from the files to answer "who wrote this", which
			    is the question you least want to trade the file list for. It also
			    means the parent chips — how you walk history — stay one click away
			    whichever tab is open. */}
			<div className="shrink-0 px-3 pt-2 pb-1.5">
				<div className="flex items-start gap-1">
					{/* Clamped to two lines: a long subject would otherwise push the tab
					    strip down and take back the room this whole change is about. The
					    full text is on the hover card, and on `title` here. */}
					<p className="line-clamp-2 min-w-0 flex-1 font-medium text-sm" title={detail.subject}>
						{detail.subject || <em className="text-muted-foreground">no message</em>}
					</p>
					<CopySha sha={detail.sha} shortSha={detail.shortSha} />
				</div>

				<p className="pt-1 text-muted-foreground text-xs">
					{detail.authorName}
					<span className="text-muted-foreground/60">
						{' · '}
						{formatRelative(detail.authorTime)}
						{' · '}
						{formatAbsolute(detail.authorTime)}
					</span>
				</p>

				{detail.parents.length > 0 && (
					<p className="flex flex-wrap items-baseline gap-1.5 pt-1 text-xs">
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
			</div>

			<div
				role="tablist"
				aria-label="Commit detail"
				className="flex shrink-0 items-center gap-1 border-border border-b px-2 pb-1"
			>
				<DetailTab
					id="changes"
					active={tab}
					onSelect={setTab}
					label={detail.diffParent ? 'Changes' : 'Added'}
					count={detail.total}
				/>
				<DetailTab id="description" active={tab} onSelect={setTab} label="Description" />
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto">
				{tab === 'changes' ? (
					<>
						{detail.files.length === 0 ? (
							<Note>This commit changes nothing.</Note>
						) : (
							<ul className="py-1">
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
					</>
				) : (
					<div className="px-3 py-2">
						{detail.body ? (
							// `whitespace-pre-wrap`: a commit body's own line breaks are the
							// author's, and reflowing them turns a bullet list into a
							// paragraph.
							//
							// **No `max-h` any more.** It used to be capped at 80px because
							// the body sat directly above the file list and would push it
							// below the fold. With a tab of its own there is nothing beneath
							// it to crowd, so a long body is simply readable — which is what
							// the cap was costing.
							<p className="whitespace-pre-wrap text-muted-foreground text-xs">{detail.body}</p>
						) : (
							<p className="text-muted-foreground/60 text-xs">
								<em>No message body.</em>
							</p>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

/** One of the pane's two tabs. Visually the panel header's `TabButton`, kept as
 *  its own component rather than shared because that one is bound to
 *  `panelStore` and this selection is local by design (see `tab` above). */
function DetailTab({
	id,
	active,
	onSelect,
	label,
	count,
}: {
	id: DetailTabId;
	active: DetailTabId;
	onSelect: (tab: DetailTabId) => void;
	label: string;
	/** Shown beside the label, so "how much changed" is answerable without
	 *  opening the tab. */
	count?: number;
}) {
	const selected = active === id;

	return (
		<button
			type="button"
			role="tab"
			aria-selected={selected}
			className={`flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-sm transition-colors ${
				selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
			}`}
			onClick={() => onSelect(id)}
		>
			{label}
			{count !== undefined && <span className="text-muted-foreground/60">{count}</span>}
		</button>
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
