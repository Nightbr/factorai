import { describe, expect, it } from 'vitest';
import {
	cronFromPreset,
	DEFAULT_PRESET,
	describeSchedule,
	formatFireTime,
	nextRuns,
	presetFromCron,
	routineSessionLabel,
} from './cron';

describe('presets', () => {
	it('round-trips every shape the picker can produce', () => {
		const cases = [
			{ ...DEFAULT_PRESET, kind: 'hourly' as const, minute: 15 },
			{ ...DEFAULT_PRESET, kind: 'daily' as const, hour: 18, minute: 30 },
			{ ...DEFAULT_PRESET, kind: 'weekly' as const, hour: 9, minute: 0, weekday: 5 },
			{ ...DEFAULT_PRESET, kind: 'monthly' as const, hour: 7, minute: 0, day: 12 },
		];
		for (const preset of cases) {
			expect(presetFromCron(cronFromPreset(preset))).toEqual(preset);
		}
	});

	/** The rule that keeps the picker from destroying a schedule somebody meant:
	 *  anything it cannot represent exactly is `custom`, never approximated. */
	it('refuses to read a stepped, listed or ranged expression as a preset', () => {
		for (const cron of ['*/15 * * * *', '0 9,17 * * *', '0 9 * * 1-5', '0 9 * JAN *']) {
			expect(presetFromCron(cron).kind).toBe('custom');
		}
	});

	it('treats a malformed expression as custom rather than throwing', () => {
		expect(presetFromCron('nonsense').kind).toBe('custom');
		expect(presetFromCron('').kind).toBe('custom');
	});

	it('prints the clock the app is set to', () => {
		// The setting is passed in rather than read from a store: `lib/` stays
		// free of store imports, and this is the whole of the rule.
		expect(describeSchedule('30 18 * * *', true)).toBe('Every day at 18:30');
		expect(describeSchedule('30 18 * * *', false)).toBe('Every day at 6:30 PM');
		expect(describeSchedule('0 9 * * 1', false)).toBe('Every Monday at 9:00 AM');
		// Midnight and noon are the two the 12-hour clock gets wrong if you
		// write `hour % 12` and stop there.
		expect(describeSchedule('0 0 * * *', false)).toBe('Every day at 12:00 AM');
		expect(describeSchedule('0 12 * * *', false)).toBe('Every day at 12:00 PM');
	});

	it('describes a schedule in words, and leaves a custom one as its expression', () => {
		expect(describeSchedule('0 * * * *')).toBe('Every hour, on the hour');
		expect(describeSchedule('30 18 * * *')).toBe('Every day at 18:30');
		expect(describeSchedule('0 9 * * 1')).toBe('Every Monday at 9:00');
		expect(describeSchedule('0 7 12 * *')).toBe('Day 12 of the month at 7:00');
		expect(describeSchedule('0 9 * * 1-5')).toBe('0 9 * * 1-5');
	});
});

describe('nextRuns', () => {
	const now = new Date(2026, 7, 29, 10, 15); // Sat 29 Aug 2026, 10:15 local

	it('projects a daily schedule from now', () => {
		const runs = nextRuns('0 18 * * *', now, 3);
		expect(runs?.map((d) => [d.getDate(), d.getHours()])).toEqual([
			[29, 18],
			[30, 18],
			[31, 18],
		]);
	});

	it('projects an hourly schedule', () => {
		const runs = nextRuns('30 * * * *', now, 2);
		expect(runs?.map((d) => [d.getHours(), d.getMinutes()])).toEqual([
			[10, 30],
			[11, 30],
		]);
	});

	it('projects a weekly schedule onto the right weekday', () => {
		const runs = nextRuns('0 9 * * 1', now, 2);
		expect(runs?.every((d) => d.getDay() === 1)).toBe(true);
		expect(runs?.[0].getDate()).toBe(31);
	});

	/** Better nothing than a guess: the editor says so, and a saved routine
	 *  shows the backend's own `nextRunAt` instead. */
	it('returns null for a form it does not model', () => {
		expect(nextRuns('*/5 * * * *', now, 3)).toBeNull();
		expect(nextRuns('0 9 * * 1-5', now, 3)).toBeNull();
		expect(nextRuns('nope', now, 3)).toBeNull();
	});

	it('never returns a time in the past', () => {
		const runs = nextRuns('15 10 * * *', now, 1);
		expect(runs?.[0].getTime()).toBeGreaterThan(now.getTime());
	});
});

describe('formatFireTime', () => {
	const now = new Date(2026, 7, 29, 10, 15);

	it('follows the clock setting', () => {
		expect(formatFireTime(new Date(2026, 7, 29, 18, 0), now, false)).toBe('Today 6:00 PM');
		expect(formatFireTime(new Date(2026, 7, 30, 0, 5), now, false)).toBe('Tomorrow 12:05 AM');
	});

	it('names today, tomorrow, the weekday, then the date', () => {
		expect(formatFireTime(new Date(2026, 7, 29, 18, 0), now)).toBe('Today 18:00');
		expect(formatFireTime(new Date(2026, 7, 30, 18, 5), now)).toBe('Tomorrow 18:05');
		expect(formatFireTime(new Date(2026, 8, 1, 9, 0), now)).toBe('Tue 9:00');
		expect(formatFireTime(new Date(2026, 8, 20, 9, 0), now)).toBe('20/9 9:00');
	});
});

describe('routineSessionLabel', () => {
	it('names the routine and when this run started, absolutely', () => {
		// Two runs of the same daily routine are otherwise identical rows until
		// Claude writes a transcript to take a title from — and the stamp is
		// absolute, because "Today" stops being true at midnight on a row you
		// scroll past days later.
		const origin = {
			routineName: 'Nightly triage',
			startedAt: new Date(2026, 7, 29, 2, 0).getTime(),
		};
		expect(routineSessionLabel(origin, true)).toBe('Nightly triage · 29/08 2:00');
		expect(routineSessionLabel(origin, false)).toBe('Nightly triage · 29/08 2:00 AM');
	});
});
