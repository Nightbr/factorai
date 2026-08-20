import { afterEach, describe, expect, it } from 'vitest';
import { legacyDiffInline, resetDiffInlineHandover } from './diffInlineHandover';

/** The tests run in node, so there is no `localStorage` — a two-method stand-in
 *  is enough for a module that only ever reads one key. */
function installStorage(entries: Record<string, string>): void {
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		value: { getItem: (k: string) => entries[k] ?? null },
	});
}

function removeStorage(): void {
	Reflect.deleteProperty(globalThis, 'localStorage');
}

afterEach(() => {
	resetDiffInlineHandover();
	removeStorage();
});

describe('legacyDiffInline', () => {
	it('reads the value panelStore persisted', () => {
		installStorage({
			'factorai.panel': JSON.stringify({ state: { diffInline: true }, version: 2 }),
		});
		expect(legacyDiffInline()).toBe(true);
	});

	it('reads a false as a value, not as absence', () => {
		// The distinction matters: `false` is somebody's choice, `undefined` is
		// nobody's, and only the second should fall back to the new default.
		installStorage({
			'factorai.panel': JSON.stringify({ state: { diffInline: false }, version: 2 }),
		});
		expect(legacyDiffInline()).toBe(false);
	});

	it('is undefined when the key was never persisted', () => {
		installStorage({ 'factorai.panel': JSON.stringify({ state: { width: 288 }, version: 2 }) });
		expect(legacyDiffInline()).toBeUndefined();
	});

	it('is undefined on a fresh install', () => {
		installStorage({});
		expect(legacyDiffInline()).toBeUndefined();
	});

	it('survives unparseable storage rather than taking hydration down with it', () => {
		installStorage({ 'factorai.panel': '{not json' });
		expect(legacyDiffInline()).toBeUndefined();
	});

	it('ignores a value of the wrong type', () => {
		installStorage({
			'factorai.panel': JSON.stringify({ state: { diffInline: 'yes' }, version: 2 }),
		});
		expect(legacyDiffInline()).toBeUndefined();
	});

	it('answers without a DOM at all', () => {
		// Both stores import this, and the unit suite loads them in node.
		expect(legacyDiffInline()).toBeUndefined();
	});

	it('memoises, so a later reader sees what was on disk before anything wrote', () => {
		installStorage({ 'factorai.panel': JSON.stringify({ state: { diffInline: true } }) });
		expect(legacyDiffInline()).toBe(true);
		// panelStore's v3 migration has now dropped the key; the second store to
		// hydrate must still get the value rather than the new default.
		installStorage({ 'factorai.panel': JSON.stringify({ state: {}, version: 3 }) });
		expect(legacyDiffInline()).toBe(true);
	});
});
