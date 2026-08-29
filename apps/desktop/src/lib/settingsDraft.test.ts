import { describe, expect, it } from 'vitest';
import {
	binaryOverride,
	CATCHUP,
	CONCURRENT,
	dirtySections,
	isDirty,
	isSettingsSection,
	SECTION_FOR,
	SETTINGS_SECTIONS,
	type SettingsValues,
} from './settingsDraft';

const SAVED: SettingsValues = {
	claudeBinary: '',
	routinesCatchupHours: '',
	routinesMaxConcurrent: '',
	diffInline: false,
	confirmCloseSession: true,
	confirmCloseMiddleClick: true,
	frontmatterOpen: true,
	restoreTabs: true,
};

describe('isSettingsSection', () => {
	it('accepts every section in the nav', () => {
		for (const section of SETTINGS_SECTIONS) expect(isSettingsSection(section)).toBe(true);
	});

	it('rejects a hand-edited URL asking for something else', () => {
		expect(isSettingsSection('appearance')).toBe(false);
		expect(isSettingsSection('')).toBe(false);
		expect(isSettingsSection(undefined)).toBe(false);
		expect(isSettingsSection(3)).toBe(false);
	});
});

describe('binaryOverride', () => {
	it('is null for an empty field, which is what deletes the row', () => {
		expect(binaryOverride('')).toBeNull();
		// Whitespace is empty too: an all-spaces value would be a *set* setting
		// that no probe could recover from.
		expect(binaryOverride('   ')).toBeNull();
	});

	it('trims a pasted path', () => {
		expect(binaryOverride('  /opt/homebrew/bin/claude\n')).toBe('/opt/homebrew/bin/claude');
	});
});

describe('dirtySections', () => {
	it('reports nothing for an untouched draft', () => {
		expect(dirtySections(SAVED, { ...SAVED })).toEqual([]);
		expect(isDirty(SAVED, { ...SAVED })).toBe(false);
	});

	it('places every value in exactly one section', () => {
		for (const key of Object.keys(SECTION_FOR) as (keyof SettingsValues)[]) {
			const draft: SettingsValues = { ...SAVED };
			// Flip whatever it is: booleans invert, the text fields get a value.
			if (key === 'claudeBinary') draft.claudeBinary = '/usr/local/bin/claude';
			else if (key === 'routinesCatchupHours') draft.routinesCatchupHours = '12';
			else if (key === 'routinesMaxConcurrent') draft.routinesMaxConcurrent = '4';
			else draft[key] = !SAVED[key];
			expect(dirtySections(SAVED, draft)).toEqual([SECTION_FOR[key]]);
		}
	});

	it('reports both confirm switches under the one section', () => {
		const draft: SettingsValues = {
			...SAVED,
			confirmCloseSession: false,
			confirmCloseMiddleClick: false,
		};
		expect(dirtySections(SAVED, draft)).toEqual(['confirmations']);
	});

	it('returns sections in nav order rather than edit order', () => {
		const draft: SettingsValues = {
			...SAVED,
			restoreTabs: false,
			claudeBinary: '/usr/local/bin/claude',
			diffInline: true,
		};
		expect(dirtySections(SAVED, draft)).toEqual(['claude', 'editor', 'sessions']);
	});

	it('does not call whitespace around an unchanged path a change', () => {
		const saved: SettingsValues = { ...SAVED, claudeBinary: '/usr/local/bin/claude' };
		const draft: SettingsValues = { ...saved, claudeBinary: ' /usr/local/bin/claude ' };
		// Otherwise a cursor left in the wrong place enables Save and writes a
		// path with a space on the end.
		expect(isDirty(saved, draft)).toBe(false);
	});

	it('sees clearing an override as a change', () => {
		const saved: SettingsValues = { ...SAVED, claudeBinary: '/usr/local/bin/claude' };
		expect(dirtySections(saved, { ...saved, claudeBinary: '' })).toEqual(['claude']);
	});
});

describe('the routine settings', () => {
	it('is null for an empty field, which is what deletes the row', () => {
		expect(CATCHUP('')).toBeNull();
		expect(CONCURRENT('  ')).toBeNull();
	});

	it('refuses anything that is not a whole number in range', () => {
		// A stray keystroke must not reach the runner as a cap of NaN.
		expect(CONCURRENT('lots')).toBeNull();
		expect(CONCURRENT('0')).toBeNull();
		expect(CONCURRENT('2.5')).toBeNull();
		expect(CATCHUP('-1')).toBeNull();
		expect(CATCHUP('999')).toBeNull();
	});

	it('keeps zero hours, which is a real answer', () => {
		// "Never run late" is a setting, not an absence of one.
		expect(CATCHUP('0')).toBe('0');
		expect(CATCHUP(' 6 ')).toBe('6');
		expect(CONCURRENT('4')).toBe('4');
	});

	it('does not call whitespace a change', () => {
		const saved: SettingsValues = { ...SAVED, routinesMaxConcurrent: '3' };
		expect(isDirty(saved, { ...saved, routinesMaxConcurrent: ' 3 ' })).toBe(false);
		expect(isDirty(saved, { ...saved, routinesMaxConcurrent: '4' })).toBe(true);
	});
});
