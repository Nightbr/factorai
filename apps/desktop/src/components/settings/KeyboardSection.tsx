import { Button, IconButton, SettingRow } from '@factorai/ui';
import { type Hotkey, useHotkeyRecorder } from '@tanstack/react-hotkeys';
import { RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
	type KeymapOverrides,
	SHORTCUT_SPECS,
	type ShortcutAction,
	assignHotkey,
	blockingAction,
	clearHotkey,
	digitsBinding,
	displayChord,
	isOverridden,
	mergeKeymap,
	overridesFrom,
	specsFor,
	withPhysicalDigit,
} from '@lib/keymap';
import { isMacOS } from '@lib/platform';
import { useRecordingStore } from '@store/recordingStore';

interface KeyboardSectionProps {
	/** The draft's overrides, and the only thing this section edits. */
	value: KeymapOverrides;
	onChange: (next: KeymapOverrides) => void;
}

/**
 * The Keyboard section of the settings modal (F28, ADR-0046).
 *
 * **Every edit here is a draft edit**, like every other section: Q24's Save
 * commits it, Cancel discards it, and the nav's dot says this section holds
 * one. That is what makes stealing a chord safe — see below.
 *
 * The rows are the platform's: macOS never shows Quit, because its menu owns
 * `Cmd+Q` and the webview never sees the key.
 */
export function KeyboardSection({ value, onChange }: KeyboardSectionProps) {
	const platform = isMacOS() ? 'mac' : 'linux';
	const keymap = mergeKeymap(value);
	const [recordingFor, setRecordingFor] = useState<ShortcutAction | null>(null);
	// Why the last recording on a row was refused. Cleared by the next attempt.
	const [refusal, setRefusal] = useState<{ action: ShortcutAction; reason: string } | null>(null);
	const setRecordingActive = useRecordingStore((s) => s.setActive);
	// The physical key of the last keystroke, which the recorder does not keep:
	// it reports `KeyboardEvent.key`, so AZERTY's `Ctrl+1` arrives as `Mod+&`.
	// Captured on `window` in the capture phase, ahead of the recorder's own
	// listener, so it is current by the time `onRecord` runs.
	const lastCode = useRef('');
	useEffect(() => {
		if (recordingFor === null) return;
		const onKeyDown = (event: KeyboardEvent) => {
			lastCode.current = event.code;
		};
		window.addEventListener('keydown', onKeyDown, true);
		return () => window.removeEventListener('keydown', onKeyDown, true);
	}, [recordingFor]);

	// Every app binding is suspended while a chord is being captured. Tied to
	// this component's state rather than set by the two callbacks, so an unmount
	// mid-recording — Esc closing the modal — cannot leave the app with its
	// shortcuts switched off.
	useEffect(() => {
		setRecordingActive(recordingFor !== null);
		return () => setRecordingActive(false);
	}, [recordingFor, setRecordingActive]);

	const recorder = useHotkeyRecorder({
		onRecord: (recorded) => {
			if (recordingFor) assign(recordingFor, recorded);
			setRecordingFor(null);
		},
		// Escape cancels rather than being captured, which is also why Escape can
		// never be bound to anything.
		onCancel: () => setRecordingFor(null),
		// Backspace clears, which is the same thing the row's × does.
		onClear: () => {
			if (recordingFor) onChange(overridesFrom(clearHotkey(keymap, recordingFor)));
			setRecordingFor(null);
		},
	});

	/**
	 * Store a recorded chord, or say why not.
	 *
	 * Stealing is the rule (ADR-0046) with one exception: a digit row's nine
	 * chords are never split, in either direction, so that collision is refused
	 * on the row being recorded (ADR-0074).
	 */
	function assign(action: ShortcutAction, recorded: Hotkey) {
		const spec = SHORTCUT_SPECS.find((s) => s.action === action);
		let hotkey = withPhysicalDigit(recorded, lastCode.current);
		if (spec?.digits === true) {
			const binding = digitsBinding(recorded, lastCode.current, platform);
			if (!binding) {
				setRefusal({ action, reason: 'Press a modifier with a digit, such as Ctrl+1 or Alt+1.' });
				return;
			}
			hotkey = binding;
		}
		const blocker = blockingAction(keymap, action, hotkey);
		if (blocker) {
			const label = SHORTCUT_SPECS.find((s) => s.action === blocker)?.label ?? blocker;
			setRefusal({ action, reason: `Already used by “${label}”. Change that row first.` });
			return;
		}
		onChange(overridesFrom(assignHotkey(keymap, action, hotkey)));
	}

	function record(action: ShortcutAction) {
		setRefusal(null);
		setRecordingFor(action);
		recorder.startRecording();
	}

	return (
		<div className="divide-y divide-border">
			{specsFor(platform).map((spec) => {
				const hotkey = keymap[spec.action];
				const recording = recordingFor === spec.action && recorder.isRecording;
				return (
					<SettingRow
						key={spec.action}
						label={spec.label}
						description={
							refusal?.action === spec.action ? (
								<span className="text-destructive" data-testid={`shortcut-refusal-${spec.action}`}>
									{refusal.reason}
								</span>
							) : undefined
						}
					>
						<div className="flex items-center gap-1">
							{/* The chord is the button: clicking it starts the capture,
							    which is one control rather than a label beside an Edit. */}
							<Button
								variant={recording ? 'default' : 'secondary'}
								size="sm"
								data-testid={`shortcut-${spec.action}`}
								className="min-w-24 font-mono text-xs"
								onClick={() => record(spec.action)}
							>
								{recording
									? 'Press keys…'
									: hotkey
										? displayChord(spec.action, hotkey, platform)
										: 'Unbound'}
							</Button>
							{/* Only while there is something to reset *to*: a link on a row
							    that already shows the shipped chord is a control that does
							    nothing. */}
							{isOverridden(keymap, spec.action) && (
								<IconButton
									size="sm"
									aria-label={`Reset ${spec.label} to its default`}
									title="Reset to default"
									onClick={() => {
										const next = { ...value };
										delete next[spec.action];
										onChange(next);
									}}
								>
									<RotateCcw />
								</IconButton>
							)}
							{hotkey && (
								<IconButton
									size="sm"
									aria-label={`Unbind ${spec.label}`}
									title="Unbind"
									onClick={() => onChange(overridesFrom(clearHotkey(keymap, spec.action)))}
								>
									<X />
								</IconButton>
							)}
						</div>
					</SettingRow>
				);
			})}

			<div className="flex items-center justify-between gap-3 py-3">
				<p className="text-muted-foreground text-xs">
					Assigning a chord another action holds takes it, and that row is left unbound, except for
					the tab digits, which are never split. Nothing is written until you Save.
				</p>
				<Button
					variant="secondary"
					size="sm"
					data-testid="shortcuts-reset-all"
					disabled={Object.keys(value).length === 0}
					onClick={() => onChange({})}
				>
					Reset all
				</Button>
			</div>
		</div>
	);
}
