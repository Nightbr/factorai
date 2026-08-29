import { EmptyHero } from '@components/layout/EmptyHero';
import { RoutineEditor } from '@components/routines/RoutineEditor';
import type { Routine, RoutineInput } from '@factorai/types';
import { Button, IconButton, Switch } from '@factorai/ui';
import { describeSchedule, formatFireTime } from '@lib/cron';
import { usePrefsStore } from '@store/prefsStore';
import { formatError } from '@lib/errors';
import { formatRelative } from '@lib/format';
import { queryKeys } from '@lib/queryKeys';
import { cmd } from '@lib/tauri';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClockFading, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * A project's routines (F22): the list, and the editor.
 *
 * The list is the surface a schedule has to be able to explain itself from —
 * when it next runs, when it last did, and what went wrong if something did.
 * That is why `lastError` and a skipped fire get a line here rather than only a
 * toast: a toast is gone by the time you come back to the machine.
 */
interface RoutinesViewProps {
	projectId: string;
	/** False for a project whose folder is gone — `Run now` cannot spawn there,
	 *  the same rule the new-session button follows. */
	canRun: boolean;
	/** Arrived from the context menu's `New routine`, so the editor opens with
	 *  the list rather than after a second click. */
	startCreating: boolean;
	/** Clear the URL's `new` once the editor is open, so a reload or a
	 *  browser-back does not reopen an editor you cancelled. */
	onCreatingOpened: () => void;
}

export function RoutinesView({
	projectId,
	canRun,
	startCreating,
	onCreatingOpened,
}: RoutinesViewProps) {
	const queryClient = useQueryClient();
	const routinesQ = useQuery({
		queryKey: queryKeys.routines(projectId),
		queryFn: () => cmd.listRoutines(projectId),
	});
	/** `null` = closed, `'new'` = creating, otherwise the routine being edited. */
	const [editing, setEditing] = useState<'new' | Routine | null>(startCreating ? 'new' : null);
	const [saveError, setSaveError] = useState<string | null>(null);
	// **In an effect as well as in the initial state**, because the menu item is
	// reachable from a project page already showing this tab — then the view does
	// not remount, the initial state never runs again, and `New routine` would
	// only clear the URL. Found by using it.
	useEffect(() => {
		if (!startCreating) return;
		setEditing('new');
		setSaveError(null);
		onCreatingOpened();
	}, [startCreating, onCreatingOpened]);

	const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
	/** What the last `Run now` on a row did, when it did not start anything.
	 *  Kept per row rather than as one banner: the answer is about that routine,
	 *  and it belongs where the button is. */
	const [runNote, setRunNote] = useState<Record<string, string>>({});

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: queryKeys.routines(projectId) });

	const save = useMutation({
		mutationFn: async (input: RoutineInput) => {
			if (editing && editing !== 'new') return cmd.updateRoutine(editing.id, input);
			return cmd.createRoutine(input);
		},
		onSuccess: async () => {
			setEditing(null);
			setSaveError(null);
			await invalidate();
		},
		// The backend refuses a cron expression it cannot parse; that message is
		// the useful half of this form's validation and belongs on screen.
		onError: (e) => setSaveError(formatError(e)),
	});

	const routines = routinesQ.data ?? [];

	return (
		// `min-h-full`, not `h-full`: the hero wants the pane's height to centre
		// in, and a list longer than the pane must be allowed to exceed it — with
		// `h-full` the last rows sat under the scroller's own bottom padding
		// (2026-08-29, user report). `pb-2` keeps a little air under the final row
		// on top of the scroller's `pb-6`.
		<div className="flex min-h-full flex-col gap-4 pb-2">
			{/* The `New routine` button lives in the page header beside the project
			    name, where `New session` is — one action, one place, whichever list
			    you are on. */}
			{(routines.length > 0 || editing !== null) && (
				<p className="text-muted-foreground text-sm">
					A routine starts a session in this project on a schedule, with its prompt as the first
					message. Routines run while factorai is open.
				</p>
			)}

			{editing !== null && (
				<RoutineEditor
					projectId={projectId}
					routine={editing === 'new' ? null : editing}
					error={saveError}
					onCancel={() => {
						setEditing(null);
						setSaveError(null);
					}}
					onSave={async (input) => {
						await save.mutateAsync(input).catch(() => {});
					}}
				/>
			)}

			{routinesQ.isLoading && <p className="text-muted-foreground text-sm">Loading routines…</p>}

			{!routinesQ.isLoading && routines.length === 0 && editing === null && (
				<EmptyHero
					icon={<ClockFading />}
					title="No routines yet"
					description="A routine starts a session in this project on a schedule, with its prompt as the first message. They run while factorai is open."
					action={
						<Button
							size="sm"
							className="gap-1.5"
							data-testid="new-routine-empty"
							onClick={() => {
								setSaveError(null);
								setEditing('new');
							}}
						>
							<Plus /> New routine
						</Button>
					}
				/>
			)}

			{routines.length > 0 && (
				<ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-card">
					{routines.map((routine) => (
						<RoutineRow
							key={routine.id}
							routine={routine}
							canRun={canRun}
							confirmingDelete={confirmingDelete === routine.id}
							runNote={runNote[routine.id]}
							onRunNote={(note) =>
								setRunNote((prev) => {
									const next = { ...prev };
									if (note) next[routine.id] = note;
									else delete next[routine.id];
									return next;
								})
							}
							onEdit={() => {
								setSaveError(null);
								setEditing(routine);
							}}
							onConfirmDelete={() => setConfirmingDelete(routine.id)}
							onCancelDelete={() => setConfirmingDelete(null)}
							onChanged={invalidate}
						/>
					))}
				</ul>
			)}
		</div>
	);
}

interface RoutineRowProps {
	routine: Routine;
	canRun: boolean;
	confirmingDelete: boolean;
	/** Why the last `Run now` started nothing, if it started nothing. */
	runNote: string | undefined;
	onRunNote: (note: string | null) => void;
	onEdit: () => void;
	onConfirmDelete: () => void;
	onCancelDelete: () => void;
	onChanged: () => Promise<unknown>;
}

function RoutineRow({
	routine,
	canRun,
	confirmingDelete,
	runNote,
	onRunNote,
	onEdit,
	onConfirmDelete,
	onCancelDelete,
	onChanged,
}: RoutineRowProps) {
	const clock24 = usePrefsStore((s) => s.clock24);
	return (
		<li className="flex items-center gap-3 px-4 py-3" data-testid={`routine-${routine.id}`}>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="truncate font-medium">{routine.name}</span>
					{!routine.enabled && (
						<span className="shrink-0 text-muted-foreground text-xs">disabled</span>
					)}
				</div>
				<div className="text-muted-foreground text-xs">
					{describeSchedule(routine.cron, clock24)}
					{routine.enabled && routine.nextRunAt !== null && (
						<> · next {formatFireTime(new Date(routine.nextRunAt), new Date(), clock24)}</>
					)}
				</div>
				{runNote ? (
					<div
						className="text-muted-foreground text-xs"
						data-testid={`routine-run-note-${routine.id}`}
					>
						Did not run — {runNote}
					</div>
				) : (
					<RunState routine={routine} />
				)}
			</div>

			{confirmingDelete ? (
				// Deleting is irreversible, so it asks — and says the thing that is
				// least obvious about it: a session it already started keeps running.
				<div className="flex shrink-0 items-center gap-2">
					<span className="text-muted-foreground text-xs">
						Delete this routine? A session it started keeps running.
					</span>
					<Button size="sm" variant="ghost" onClick={onCancelDelete}>
						Cancel
					</Button>
					<Button
						size="sm"
						variant="destructive"
						data-testid={`routine-delete-confirm-${routine.id}`}
						onClick={async () => {
							await cmd.deleteRoutine(routine.id);
							onCancelDelete();
							await onChanged();
						}}
					>
						Delete
					</Button>
				</div>
			) : (
				<div className="flex shrink-0 items-center gap-1">
					{/* `inline-flex`, not a bare span: an inline wrapper sits on the text
					    baseline, which put `Run now` a pixel or two below the three
					    icons beside it (2026-08-29, user report). The wrapper exists
					    at all because a disabled button swallows the tooltip. */}
					<span
						className="inline-flex"
						title={canRun ? 'Run now' : 'No project folder on disk — cannot start a session here'}
					>
						<IconButton
							size="md"
							aria-label={`Run ${routine.name} now`}
							disabled={!canRun}
							data-testid={`routine-run-${routine.id}`}
							onClick={async () => {
								// **Always says what happened.** A run that the overlap
								// skip or the cap declined used to return null and show
								// nothing at all, which reads as a broken button.
								const result = await cmd.runRoutineNow(routine.id);
								onRunNote(result.outcome === 'started' ? null : result.message);
								await onChanged();
							}}
						>
							<Play />
						</IconButton>
					</span>
					<IconButton size="md" aria-label={`Edit ${routine.name}`} onClick={onEdit}>
						<Pencil />
					</IconButton>
					<IconButton
						size="md"
						aria-label={`Delete ${routine.name}`}
						data-testid={`routine-delete-${routine.id}`}
						onClick={onConfirmDelete}
					>
						<Trash2 />
					</IconButton>
					{/* Stops future fires and nothing else — it never kills a session
					    that is already running, because that is not what a switch
					    means. Set apart from the icons by more than their own gap:
					    it is a different kind of control, and the one beside it is
					    Delete. */}
					<Switch
						className="ml-2"
						aria-label={`${routine.enabled ? 'Disable' : 'Enable'} ${routine.name}`}
						data-testid={`routine-toggle-${routine.id}`}
						checked={routine.enabled}
						onCheckedChange={async (enabled) => {
							await cmd.setRoutineEnabled(routine.id, enabled);
							await onChanged();
						}}
					/>
				</div>
			)}
		</li>
	);
}

/** The third line of a row: what happened last time, and only when something
 *  did. A routine that has never run says nothing rather than "never run". */
function RunState({ routine }: { routine: Routine }) {
	if (routine.lastError) {
		return (
			<div className="text-destructive text-xs" data-testid={`routine-error-${routine.id}`}>
				Last run failed: {routine.lastError}
			</div>
		);
	}
	const skippedLast =
		routine.lastSkippedAt !== null &&
		(routine.lastRunAt === null || routine.lastSkippedAt > routine.lastRunAt);
	if (skippedLast && routine.lastSkippedAt !== null) {
		return (
			<div className="text-muted-foreground text-xs">
				Skipped {formatRelative(routine.lastSkippedAt)} — the previous session was still running
			</div>
		);
	}
	if (routine.lastRunAt !== null) {
		return (
			<div className="text-muted-foreground text-xs">
				Last run {formatRelative(routine.lastRunAt)}
			</div>
		);
	}
	return null;
}
