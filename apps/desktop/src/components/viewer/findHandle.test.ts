import { describe, expect, it } from 'vitest';
import { type FindKeystroke, isFindKey } from '@components/viewer/findHandle';

function stroke(over: Partial<FindKeystroke>): FindKeystroke {
	return { key: 'f', metaKey: false, ctrlKey: false, altKey: false, ...over };
}

describe('isFindKey', () => {
	it('accepts either modifier, because the app never sniffs the platform', () => {
		expect(isFindKey(stroke({ metaKey: true }))).toBe(true);
		expect(isFindKey(stroke({ ctrlKey: true }))).toBe(true);
	});

	it('accepts a capital F, which is what the key reports with caps lock on', () => {
		expect(isFindKey(stroke({ key: 'F', ctrlKey: true }))).toBe(true);
	});

	it('refuses a bare f, so typing into the file is not a find', () => {
		expect(isFindKey(stroke({}))).toBe(false);
	});

	it('refuses Alt: `Ctrl+Alt+F` is a console switch on Linux, not this', () => {
		expect(isFindKey(stroke({ ctrlKey: true, altKey: true }))).toBe(false);
		expect(isFindKey(stroke({ metaKey: true, altKey: true }))).toBe(false);
	});

	it('refuses another letter with the same modifier', () => {
		expect(isFindKey(stroke({ key: 's', metaKey: true }))).toBe(false);
	});
});
