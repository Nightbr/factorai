import { Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@factorai/ui';
import { usePrefsStore } from '@store/prefsStore';

/**
 * Hour and minute, on whichever clock the app is set to (`prefsStore.clock24`).
 *
 * **Ours rather than `<input type="time">`, and that is the whole reason it
 * exists.** The native control renders on the *browser's* locale, which no
 * setting of ours can reach: the routine editor showed `09:00 AM` in the field
 * and `Next: today 9:00` in the line directly under it, from the same value.
 * One rule, stated once, applied everywhere a clock is printed.
 *
 * The value is always **24-hour** across this component's boundary — the
 * meridiem is a rendering of `hour`, never a second piece of state to keep in
 * step with it.
 */
export function TimeField({
	hour,
	minute,
	onChange,
	id,
	'data-testid': testId,
}: {
	hour: number;
	minute: number;
	onChange: (next: { hour: number; minute: number }) => void;
	id?: string;
	'data-testid'?: string;
}) {
	const clock24 = usePrefsStore((s) => s.clock24);
	const pm = hour >= 12;
	const shown = clock24 ? hour : hour % 12 === 0 ? 12 : hour % 12;

	/** A 12-hour reading plus the current meridiem, back as a 24-hour hour. */
	function hourFromShown(next: number): number {
		if (clock24) return clamp(next, 0, 23);
		const twelve = clamp(next, 1, 12) % 12;
		return pm ? twelve + 12 : twelve;
	}

	return (
		<div className="flex items-center gap-1">
			<Input
				id={id}
				data-testid={testId}
				aria-label="Hour"
				className="w-14"
				type="number"
				min={clock24 ? 0 : 1}
				max={clock24 ? 23 : 12}
				value={shown}
				onChange={(e) => onChange({ hour: hourFromShown(Number(e.target.value)), minute })}
			/>
			<span className="text-muted-foreground">:</span>
			<Input
				aria-label="Minute"
				data-testid={testId ? `${testId}-minute` : undefined}
				className="w-14"
				type="number"
				min={0}
				max={59}
				value={String(minute).padStart(2, '0')}
				onChange={(e) => onChange({ hour, minute: clamp(Number(e.target.value), 0, 59) })}
			/>
			{!clock24 && (
				<Select
					value={pm ? 'PM' : 'AM'}
					onValueChange={(v) => onChange({ hour: (hour % 12) + (v === 'PM' ? 12 : 0), minute })}
				>
					<SelectTrigger
						aria-label="AM or PM"
						data-testid={testId ? `${testId}-meridiem` : undefined}
						className="w-20"
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="AM">AM</SelectItem>
						<SelectItem value="PM">PM</SelectItem>
					</SelectContent>
				</Select>
			)}
		</div>
	);
}

/** A number field reports an empty string while you retype it, which would
 *  otherwise write `NaN` into a schedule. */
function clamp(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	return Math.min(max, Math.max(min, Math.trunc(value)));
}
