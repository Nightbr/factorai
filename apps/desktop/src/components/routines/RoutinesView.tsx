import { RoutineEditor } from '@components/routines/RoutineEditor';
import type { Routine, RoutineInput } from '@factorai/types';
import { Button, IconButton, Switch } from '@factorai/ui';
import { describeSchedule, formatFireTime } from '@lib/cron';
import { formatError } from '@lib/errors';
import { formatRelative } from '@lib/format';
import { queryKeys } from '@lib/queryKeys';
import { cmd } from '@lib/tauri';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Play, Plus, Trash2 } from 'lucide-react';
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
		<div className="flex flex-col gap-4">
			<div className="flex items-start gap-3">
				<p className="flex-1 text-muted-foreground text-sm">
					A routine starts a session in this project on a schedule, with its prompt as the first
					message. Routines run while factorai is open.
				</p>
				{editing === null && (
					<Button
						size="sm"
						className="gap-1.5"
						data-testid="new-routine"
						onClick={() => {
							setSaveError(null);
							setEditing('new');
						}}
					>
						<Plus /> New routine
					</Button>
				)}
			</div>

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
				<p className="text-muted-foreground text-sm">
					No routines in this project yet — create one with <b>New routine</b>.
				</p>
			)}

			{routines.length > 0 && (
				<ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-card">
					{routines.map((routine) => (
						<RoutineRow
							key={routine.id}
							routine={routine}
							canRun={canRun}
							confirmingDelete={confirmingDelete === routine.id}
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
	onEdit: () => void;
	onConfirmDelete: () => void;
	onCancelDelete: () => void;
	onChanged: () => Promise<unknown>;
}

function RoutineRow({
	routine,
	canRun,
	confirmingDelete,
	onEdit,
	onConfirmDelete,
	onCancelDelete,
	onChanged,
}: RoutineRowProps) {
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
					{describeSchedule(routine.cron)}
					{routine.enabled && routine.nextRunAt !== null && (
						<> · next {formatFireTime(new Date(routine.nextRunAt), new Date())}</>
					)}
				</div>
				<RunState routine={routine} />
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
					<span
						title={canRun ? 'Run now' : 'No project folder on disk — cannot start a session here'}
					>
						<IconButton
							size="md"
							aria-label={`Run ${routine.name} now`}
							disabled={!canRun}
							data-testid={`routine-run-${routine.id}`}
							onClick={async () => {
								await cmd.runRoutineNow(routine.id);
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
					    means. */}
					<Switch
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
