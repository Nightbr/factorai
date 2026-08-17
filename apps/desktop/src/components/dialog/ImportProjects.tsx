import type { ImportCandidate } from '@factorai/types';
import {
	Button,
	Checkbox,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	Label,
} from '@factorai/ui';
import { formatError } from '@lib/errors';
import { formatRelative } from '@lib/format';
import { queryKeys } from '@lib/queryKeys';
import { cmd } from '@lib/tauri';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';

/**
 * Narrow candidates by a free-text needle, matched against the whole path.
 *
 * Path rather than display name: with a dozen repos the names collide long
 * before the paths do, and "which `desktop` is this" is exactly the question
 * the dialog exists to answer. Pure and exported so the rule is testable
 * without a render.
 */
export function filterCandidates(rows: ImportCandidate[], needle: string): ImportCandidate[] {
	const q = needle.trim().toLowerCase();
	if (!q) return rows;
	return rows.filter((r) => r.realPath.toLowerCase().includes(q));
}

/**
 * The header checkbox's state, given what is selectable and what is selected.
 *
 * Three-valued on purpose: an empty box while two of fourteen rows are ticked
 * would say something false about what clicking does. Already-open rows are not
 * selectable and are excluded from both counts, so "select all" doesn't claim
 * to be partial just because some rows are permanently ticked.
 */
export function selectAllState(
	selectable: ImportCandidate[],
	selected: ReadonlySet<string>,
): boolean | 'indeterminate' {
	if (selectable.length === 0) return false;
	const n = selectable.filter((r) => selected.has(r.key)).length;
	if (n === 0) return false;
	return n === selectable.length ? true : 'indeterminate';
}

/** One stable id, so the header checkbox and its label agree. */
const SELECT_ALL_ID = 'import-select-all';

interface ImportProjectsProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

/**
 * "Import from Claude Code" (specs/05-features.md F1).
 *
 * The list is read from Claude's store directly rather than from our index —
 * since ADR-0011 nothing outside the workspace is indexed, so the index is
 * precisely the wrong place to ask what *isn't* in it. Importing a row is the
 * same `add_project` the folder picker calls; there is one concept here, with
 * two doors.
 */
export function ImportProjects({ open, onOpenChange }: ImportProjectsProps) {
	const queryClient = useQueryClient();
	const [needle, setNeedle] = useState('');
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [error, setError] = useState<string | null>(null);

	// Read on open and not before: it walks a directory, and a workspace query
	// polling every 2s is enough filesystem in the hot path already.
	const candidatesQ = useQuery({
		queryKey: queryKeys.importCandidates(),
		queryFn: () => cmd.listImportCandidates(),
		enabled: open,
		// The dialog is a snapshot of the moment you opened it; a refetch that
		// reorders rows under a cursor mid-selection is worse than slightly stale.
		staleTime: Number.POSITIVE_INFINITY,
	});

	const rows = useMemo(
		() => filterCandidates(candidatesQ.data ?? [], needle),
		[candidatesQ.data, needle],
	);
	const selectable = useMemo(() => rows.filter((r) => !r.alreadyOpen), [rows]);
	const headerState = selectAllState(selectable, selected);

	const importing = useMutation({
		mutationFn: async (paths: string[]) => {
			// Sequential rather than `Promise.all`: each one kicks off an index of
			// its folder, and firing a dozen scans at a single SQLite connection at
			// once is how you make the app feel broken on the first run that matters.
			for (const path of paths) {
				await cmd.addProject(path);
			}
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: queryKeys.projects() });
			await queryClient.invalidateQueries({ queryKey: queryKeys.importCandidates() });
			close();
		},
		onError: (e) => setError(formatError(e)),
	});

	function close() {
		setSelected(new Set());
		setNeedle('');
		setError(null);
		onOpenChange(false);
	}

	function toggle(key: string) {
		setSelected((prev) => {
			const next = new Set(prev);
			if (!next.delete(key)) next.add(key);
			return next;
		});
	}

	function toggleAll() {
		// Clicking a partial box selects the rest — the same thing every file
		// manager does, and the opposite (clearing) throws away work.
		setSelected(headerState === true ? new Set() : new Set(selectable.map((r) => r.key)));
	}

	function importSelected() {
		const paths = (candidatesQ.data ?? [])
			.filter((r) => selected.has(r.key) && !r.alreadyOpen)
			.map((r) => r.realPath);
		if (paths.length > 0) importing.mutate(paths);
	}

	const count = selected.size;

	return (
		<Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
			<DialogContent className="max-w-2xl" data-testid="import-projects">
				<DialogHeader>
					<DialogTitle>Import from Claude Code</DialogTitle>
					<DialogDescription>
						Folders Claude has worked in. Importing one adds it to your workspace and indexes its
						sessions so you can search them.
					</DialogDescription>
				</DialogHeader>

				<div className="relative">
					<Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 size-3.5 text-muted-foreground" />
					<Input
						value={needle}
						onChange={(e) => setNeedle(e.target.value)}
						placeholder="Filter by path…"
						className="pl-7"
						data-testid="import-filter"
					/>
				</div>

				{candidatesQ.isLoading && (
					<p className="py-6 text-center text-muted-foreground text-sm">Reading ~/.claude…</p>
				)}

				{candidatesQ.data && rows.length === 0 && (
					<p className="py-6 text-center text-muted-foreground text-sm">
						{candidatesQ.data.length === 0
							? 'Claude has no project history on this machine yet.'
							: 'No folder matches that filter.'}
					</p>
				)}

				{rows.length > 0 && (
					<>
						{/* `Label htmlFor` rather than a wrapping <label>: a Radix checkbox
						    renders a <button>, which is not a labelable element, so nesting
						    it inside a plain label associates nothing and the click never
						    reaches the control. Radix's Label forwards it. */}
						<div className="flex items-center gap-2 border-border border-b px-1 pb-2">
							<Checkbox
								id={SELECT_ALL_ID}
								checked={headerState}
								onCheckedChange={toggleAll}
								disabled={selectable.length === 0}
							/>
							<Label htmlFor={SELECT_ALL_ID} className="text-muted-foreground text-xs">
								Select all
								{count > 0 && ` (${count} of ${selectable.length})`}
							</Label>
						</div>

						{/* Capped height with its own scroller: a store with fifty folders
						    must not push the Import button off the bottom of the screen. */}
						<ul className="-mx-1 max-h-80 overflow-y-auto px-1" data-testid="import-list">
							{rows.map((row) => {
								const checked = row.alreadyOpen || selected.has(row.key);
								return (
									<li key={`${row.agent}:${row.key}`}>
										<div
											// `secondary`, not `accent`: accent is the amber primary in this
											// theme, and a full-width amber bar under the cursor reads as a
											// selection rather than a hover. The sidebar's rows settled this.
											className={`flex items-center gap-3 rounded px-1 py-1.5 text-sm ${
												row.alreadyOpen ? 'opacity-50' : 'hover:bg-secondary/50'
											}`}
											data-testid={`import-row-${row.key}`}
										>
											<Checkbox
												id={`import-${row.key}`}
												checked={checked}
												disabled={row.alreadyOpen}
												onCheckedChange={() => toggle(row.key)}
												aria-label={row.realPath}
											/>
											<Label
												htmlFor={`import-${row.key}`}
												className={`min-w-0 flex-1 truncate font-normal ${
													row.missing ? 'opacity-60' : ''
												}`}
												title={row.realPath}
											>
												{row.realPath}
											</Label>
											{/* Dimmed, not hidden: every transcript is still on disk, so
											    the row is worth importing — only starting a session in it
											    is impossible (F1). */}
											{row.missing && (
												<span className="shrink-0 text-muted-foreground/70 text-xs">missing</span>
											)}
											<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
												{row.sessionCount} session{row.sessionCount === 1 ? '' : 's'}
											</span>
											<span className="w-20 shrink-0 text-right text-muted-foreground text-xs">
												{row.alreadyOpen
													? 'in workspace'
													: row.lastActivityAt
														? formatRelative(row.lastActivityAt)
														: '—'}
											</span>
										</div>
									</li>
								);
							})}
						</ul>
					</>
				)}

				{error && (
					<p role="alert" className="text-destructive text-xs" data-testid="import-error">
						{error}
					</p>
				)}

				<DialogFooter>
					<Button variant="outline" onClick={close}>
						Cancel
					</Button>
					<Button
						onClick={importSelected}
						disabled={count === 0 || importing.isPending}
						data-testid="import-confirm"
					>
						{importing.isPending ? 'Importing…' : count > 0 ? `Import ${count}` : 'Import'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
