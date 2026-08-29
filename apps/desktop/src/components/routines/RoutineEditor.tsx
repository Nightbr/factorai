import type { Routine, RoutineInput } from '@factorai/types';
import {
	Button,
	IconButton,
	Input,
	Label,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Switch,
	Textarea,
} from '@factorai/ui';
import {
	cronFromPreset,
	DEFAULT_PRESET,
	formatFireTime,
	nextRuns,
	type Preset,
	type PresetKind,
	presetFromCron,
	WEEKDAYS,
} from '@lib/cron';
import { X } from 'lucide-react';
import { useState } from 'react';

/**
 * The routine editor (F22).
 *
 * **Inline on the Routines tab rather than a modal**: it holds a name, a
 * schedule, a multi-line prompt and two switches, and you want the other
 * routines visible while writing one.
 *
 * The schedule is a **preset picker with a `Custom…` escape**, and the cron
 * expression is what is stored either way — so the presets are a writer, not a
 * second format. Under it, the next few fire times in plain local time: the only
 * defence against a schedule that silently never fires is seeing when it will.
 */
interface RoutineEditorProps {
	projectId: string;
	/** The routine being edited, or null for a new one. */
	routine: Routine | null;
	onCancel: () => void;
	onSave: (input: RoutineInput) => Promise<void>;
	/** Rejected by the backend — a cron expression it could not parse, usually.
	 *  Shown against the form rather than swallowed. */
	error: string | null;
}

const KINDS: Array<{ value: PresetKind; label: string }> = [
	{ value: 'hourly', label: 'Every hour' },
	{ value: 'daily', label: 'Daily at' },
	{ value: 'weekly', label: 'Weekly on' },
	{ value: 'monthly', label: 'Monthly on day' },
	{ value: 'custom', label: 'Custom…' },
];

export function RoutineEditor({ projectId, routine, onCancel, onSave, error }: RoutineEditorProps) {
	const [name, setName] = useState(routine?.name ?? '');
	const [prompt, setPrompt] = useState(routine?.prompt ?? '');
	const [enabled, setEnabled] = useState(routine?.enabled ?? true);
	const [preset, setPreset] = useState<Preset>(() =>
		routine ? presetFromCron(routine.cron) : DEFAULT_PRESET,
	);
	// Only meaningful under `Custom…`, but kept whatever the picker says so
	// switching to Custom shows the expression the presets were producing rather
	// than an empty field.
	const [customCron, setCustomCron] = useState(routine?.cron ?? cronFromPreset(DEFAULT_PRESET));
	// Null is "inherit the app-wide default", which is a different thing from 0
	// ("never run late") — so the switch and the number are separate controls.
	const [catchup, setCatchup] = useState(routine?.catchupHours ?? null);
	const [saving, setSaving] = useState(false);

	const cron = preset.kind === 'custom' ? customCron : cronFromPreset(preset);
	const now = new Date();
	const upcoming = nextRuns(cron, now, 3);
	const canSave = name.trim() !== '' && prompt.trim() !== '' && cron.trim() !== '' && !saving;

	function pickKind(kind: PresetKind) {
		if (kind === 'custom') {
			// Carry the expression the presets were producing into the field, so
			// Custom starts from what you already had rather than from nothing.
			setCustomCron(cron);
		}
		setPreset({ ...preset, kind });
	}

	async function submit() {
		setSaving(true);
		try {
			await onSave({
				projectId,
				name: name.trim(),
				cron: cron.trim(),
				prompt: prompt.trim(),
				enabled,
				catchupHours: catchup,
			});
		} finally {
			setSaving(false);
		}
	}

	return (
		<div
			data-testid="routine-editor"
			className="flex flex-col gap-3 rounded-md border border-border bg-card p-4"
		>
			<div className="flex items-center gap-2">
				<h3 className="flex-1 font-medium text-sm">{routine ? 'Edit routine' : 'New routine'}</h3>
				<IconButton size="md" aria-label="Cancel" title="Cancel" onClick={onCancel}>
					<X />
				</IconButton>
			</div>

			<div className="flex flex-col gap-1.5">
				<Label htmlFor="routine-name">Name</Label>
				<Input
					id="routine-name"
					data-testid="routine-name"
					value={name}
					placeholder="Nightly triage"
					onChange={(e) => setName(e.target.value)}
				/>
			</div>

			<div className="flex flex-col gap-1.5">
				<Label htmlFor="routine-schedule">Schedule</Label>
				<div className="flex flex-wrap items-center gap-2">
					<Select value={preset.kind} onValueChange={(v) => pickKind(v as PresetKind)}>
						<SelectTrigger id="routine-schedule" data-testid="routine-preset" className="w-44">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{KINDS.map((k) => (
								<SelectItem key={k.value} value={k.value}>
									{k.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>

					{preset.kind === 'weekly' && (
						<Select
							value={String(preset.weekday)}
							onValueChange={(v) => setPreset({ ...preset, weekday: Number(v) })}
						>
							<SelectTrigger data-testid="routine-weekday" className="w-32">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{WEEKDAYS.map((day, index) => (
									<SelectItem key={day} value={String(index)}>
										{day}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}

					{preset.kind === 'monthly' && (
						<Input
							aria-label="Day of the month"
							data-testid="routine-day"
							className="w-16"
							type="number"
							min={1}
							max={31}
							value={preset.day}
							onChange={(e) => setPreset({ ...preset, day: clamp(e.target.value, 1, 31) })}
						/>
					)}

					{preset.kind === 'hourly' && (
						<div className="flex items-center gap-1.5 text-muted-foreground text-xs">
							at minute
							<Input
								aria-label="Minutes past the hour"
								data-testid="routine-minute"
								className="w-16"
								type="number"
								min={0}
								max={59}
								value={preset.minute}
								onChange={(e) => setPreset({ ...preset, minute: clamp(e.target.value, 0, 59) })}
							/>
						</div>
					)}

					{(preset.kind === 'daily' || preset.kind === 'weekly' || preset.kind === 'monthly') && (
						<Input
							aria-label="Time of day"
							data-testid="routine-time"
							className="w-28"
							type="time"
							value={`${String(preset.hour).padStart(2, '0')}:${String(preset.minute).padStart(2, '0')}`}
							onChange={(e) => {
								const [h, m] = e.target.value.split(':');
								setPreset({ ...preset, hour: clamp(h, 0, 23), minute: clamp(m, 0, 59) });
							}}
						/>
					)}
				</div>

				{preset.kind === 'custom' && (
					<Input
						aria-label="Cron expression"
						data-testid="routine-cron"
						className="font-mono"
						value={customCron}
						placeholder="0 18 * * 1-5"
						onChange={(e) => setCustomCron(e.target.value)}
					/>
				)}

				<p className="text-muted-foreground text-xs" data-testid="routine-next">
					{upcoming === null
						? 'Saved routines show their next run in the list.'
						: upcoming.length === 0
							? 'This schedule has no run in the next year.'
							: `Next: ${upcoming.map((d) => formatFireTime(d, now)).join(' · ')}`}
				</p>
			</div>

			<div className="flex flex-col gap-1.5">
				<Label htmlFor="routine-prompt">Prompt</Label>
				<Textarea
					id="routine-prompt"
					data-testid="routine-prompt"
					rows={5}
					value={prompt}
					placeholder="What should the agent do when this runs?"
					onChange={(e) => setPrompt(e.target.value)}
				/>
				<p className="text-muted-foreground text-xs">Sent as the session's first message.</p>
			</div>

			<div className="flex flex-col gap-2 border-border border-t pt-3">
				<label className="flex items-center gap-2 text-sm" htmlFor="routine-enabled">
					<Switch
						id="routine-enabled"
						data-testid="routine-enabled"
						checked={enabled}
						onCheckedChange={setEnabled}
					/>
					Enabled
				</label>
				<label className="flex items-center gap-2 text-sm" htmlFor="routine-catchup">
					<Switch
						id="routine-catchup"
						data-testid="routine-catchup"
						checked={catchup !== 0}
						onCheckedChange={(on) => setCatchup(on ? null : 0)}
					/>
					Run if missed
					{catchup !== 0 && (
						<>
							<Input
								aria-label="Catch-up window in hours"
								data-testid="routine-catchup-hours"
								className="w-16"
								type="number"
								min={1}
								max={168}
								value={catchup ?? ''}
								placeholder="—"
								onChange={(e) =>
									setCatchup(e.target.value === '' ? null : clamp(e.target.value, 1, 168))
								}
							/>
							<span className="text-muted-foreground text-xs">
								hours late{catchup === null ? ' (app default)' : ''}
							</span>
						</>
					)}
				</label>
			</div>

			{error && (
				<p data-testid="routine-error" className="text-destructive text-xs">
					{error}
				</p>
			)}

			<div className="flex justify-end gap-2">
				<Button size="sm" variant="ghost" onClick={onCancel}>
					Cancel
				</Button>
				<Button
					size="sm"
					data-testid="routine-save"
					disabled={!canSave}
					onClick={() => void submit()}
				>
					{routine ? 'Save' : 'Create routine'}
				</Button>
			</div>
		</div>
	);
}

/** A number field's value, kept inside its own bounds. A `type="number"` input
 *  reports an empty string while you retype it, which would otherwise write
 *  `NaN` into the schedule. */
function clamp(value: string, min: number, max: number): number {
	const n = Number(value);
	if (!Number.isFinite(n)) return min;
	return Math.min(max, Math.max(min, Math.trunc(n)));
}
