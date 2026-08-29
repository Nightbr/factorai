/**
 * The schedule half of routines (F22): presets over a cron string, and the
 * plain-language echo under the control.
 *
 * **The cron expression is the representation.** The preset picker writes one,
 * the `Custom…` field is one, the backend stores one, and the later MCP tool
 * accepts one — so this file only ever translates *between a preset and the
 * expression it produces*, never between two stored formats.
 *
 * Five fields, standard order: `minute hour day-of-month month day-of-week`.
 * The backend parses with `croner`, which is the authority; everything here is
 * the editor's convenience and is deliberately conservative — an expression it
 * cannot recognise is shown as `Custom`, never rewritten.
 */

export type PresetKind = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom';

export interface Preset {
	kind: PresetKind;
	/** Minutes past the hour, for `hourly`. */
	minute: number;
	/** Local hour and minute, for `daily`, `weekly` and `monthly`. */
	hour: number;
	/** 0 = Sunday, matching cron's day-of-week. */
	weekday: number;
	/** Day of the month, for `monthly`. */
	day: number;
}

export const DEFAULT_PRESET: Preset = { kind: 'daily', minute: 0, hour: 9, weekday: 1, day: 1 };

export const WEEKDAYS = [
	'Sunday',
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday',
] as const;

/** The expression a preset produces. `custom` has no expression of its own —
 *  the field is the source of truth there, so callers keep theirs. */
export function cronFromPreset(preset: Preset): string {
	switch (preset.kind) {
		case 'hourly':
			return `${preset.minute} * * * *`;
		case 'daily':
			return `${preset.minute} ${preset.hour} * * *`;
		case 'weekly':
			return `${preset.minute} ${preset.hour} * * ${preset.weekday}`;
		case 'monthly':
			return `${preset.minute} ${preset.hour} ${preset.day} * *`;
		case 'custom':
			return '';
	}
}

/**
 * Read an expression back into a preset, or `custom` when it is not one.
 *
 * **Conservative on purpose.** Anything with a step, a list, a range or a name
 * in it is `custom` — round-tripping it through a preset would silently rewrite
 * a schedule somebody meant, which is the one thing an editor of a cron string
 * must never do.
 */
export function presetFromCron(cron: string): Preset {
	const fields = cron.trim().split(/\s+/);
	if (fields.length !== 5) return { ...DEFAULT_PRESET, kind: 'custom' };
	const [min, hour, day, month, weekday] = fields;
	const num = (f: string) => (/^\d{1,2}$/.test(f) ? Number(f) : null);

	const minute = num(min);
	if (minute === null || month !== '*') return { ...DEFAULT_PRESET, kind: 'custom' };

	if (hour === '*' && day === '*' && weekday === '*') {
		return { ...DEFAULT_PRESET, kind: 'hourly', minute };
	}
	const atHour = num(hour);
	if (atHour === null) return { ...DEFAULT_PRESET, kind: 'custom' };

	if (day === '*' && weekday === '*') {
		return { ...DEFAULT_PRESET, kind: 'daily', minute, hour: atHour };
	}
	const onWeekday = num(weekday);
	if (day === '*' && onWeekday !== null && onWeekday <= 6) {
		return { ...DEFAULT_PRESET, kind: 'weekly', minute, hour: atHour, weekday: onWeekday };
	}
	const onDay = num(day);
	if (weekday === '*' && onDay !== null && onDay >= 1 && onDay <= 31) {
		return { ...DEFAULT_PRESET, kind: 'monthly', minute, hour: atHour, day: onDay };
	}
	return { ...DEFAULT_PRESET, kind: 'custom' };
}

/** `9:05`, in the 24-hour clock this file uses throughout — a routine is
 *  configuration, and configuration reads better unambiguous. */
function formatClock(hour: number, minute: number): string {
	return `${hour}:${String(minute).padStart(2, '0')}`;
}

/**
 * What a preset says in words, for the row in the routines list.
 *
 * `custom` gets the expression itself rather than a translation: a cron string
 * nobody can read is honest, and a wrong translation is not.
 */
export function describeSchedule(cron: string): string {
	const preset = presetFromCron(cron);
	switch (preset.kind) {
		case 'hourly':
			return preset.minute === 0
				? 'Every hour, on the hour'
				: `Every hour at :${String(preset.minute).padStart(2, '0')}`;
		case 'daily':
			return `Every day at ${formatClock(preset.hour, preset.minute)}`;
		case 'weekly':
			return `Every ${WEEKDAYS[preset.weekday]} at ${formatClock(preset.hour, preset.minute)}`;
		case 'monthly':
			return `Day ${preset.day} of the month at ${formatClock(preset.hour, preset.minute)}`;
		case 'custom':
			return cron;
	}
}

/**
 * The next few times an expression fires, as local wall-clock times.
 *
 * **The editor's own projection, not the backend's**, and it exists because the
 * only defence against a schedule that silently never fires is seeing when it
 * will. `nextRunAt` on a saved routine comes from `croner` in Rust; this
 * answers for an expression that has not been saved yet, which is exactly when
 * the answer is worth having.
 *
 * Deliberately supports only what the presets can produce plus the simple
 * literal forms — a step, a list or a range returns nothing rather than a
 * guess, and the field then says "saved schedules show their next run" instead
 * of lying. `null` for an expression that cannot be parsed at all.
 */
export function nextRuns(cron: string, from: Date, count: number): Date[] | null {
	const fields = cron.trim().split(/\s+/);
	if (fields.length !== 5) return null;
	// `undefined` is "a form this projection does not model" — a step or a list.
	const literal = (f: string) => (/^\d{1,2}$/.test(f) ? Number(f) : f === '*' ? null : undefined);
	const [minute, hour, day, month, weekday] = fields.map(literal);
	const want = [minute, hour, day, month, weekday];
	if (want.some((v) => v === undefined) || minute === null) return null;
	const [wantMinute, wantHour, wantDay, wantMonth, wantWeekday] = want as Array<number | null>;
	if (wantMinute === null) return null;

	const out: Date[] = [];
	// Minute resolution, walking forward from the next whole minute. A day is
	// 1440 candidates and the horizon is a year, which is bounded work and far
	// cheaper than reimplementing a cron engine in the renderer.
	const cursor = new Date(from.getTime());
	cursor.setSeconds(0, 0);
	cursor.setMinutes(cursor.getMinutes() + 1);
	const horizon = new Date(from.getTime());
	horizon.setFullYear(horizon.getFullYear() + 1);
	while (out.length < count && cursor <= horizon) {
		const matches =
			cursor.getMinutes() === wantMinute &&
			(wantHour === null || cursor.getHours() === wantHour) &&
			(wantDay === null || cursor.getDate() === wantDay) &&
			(wantMonth === null || cursor.getMonth() + 1 === wantMonth) &&
			(wantWeekday === null || cursor.getDay() === wantWeekday % 7);
		if (matches) out.push(new Date(cursor.getTime()));
		// Skip a whole hour when the minute cannot match — 60× fewer steps for
		// the common `0 9 * * *`, and the same answer.
		cursor.setMinutes(cursor.getMinutes() + (cursor.getMinutes() === wantMinute ? 60 : 1));
	}
	return out;
}

/** A fire time as the editor shows it: `Today 18:00`, `Tomorrow 18:00`,
 *  `Thu 18:00`, or a date once it is further out than that. */
export function formatFireTime(when: Date, now: Date): string {
	const clock = formatClock(when.getHours(), when.getMinutes());
	const days = Math.round(
		(new Date(when.getFullYear(), when.getMonth(), when.getDate()).getTime() -
			new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
			86_400_000,
	);
	if (days === 0) return `Today ${clock}`;
	if (days === 1) return `Tomorrow ${clock}`;
	if (days < 7) return `${WEEKDAYS[when.getDay()].slice(0, 3)} ${clock}`;
	return `${when.getDate()}/${when.getMonth() + 1} ${clock}`;
}
