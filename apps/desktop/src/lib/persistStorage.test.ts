import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferredLocalStorage } from '@lib/persistStorage';

/**
 * The unit lane runs in `node`, which has neither `localStorage` nor `window`.
 * A fake of each is enough, and it keeps the assertions about *when* a write
 * happens rather than about a browser implementation.
 */
describe('deferredLocalStorage', () => {
	let data: Map<string, string>;
	let writes: string[];
	let refuse: boolean;
	let listeners: Record<string, Array<() => void>>;

	beforeEach(() => {
		vi.useFakeTimers();
		data = new Map();
		writes = [];
		refuse = false;
		listeners = {};
		vi.stubGlobal('localStorage', {
			getItem: (k: string) => data.get(k) ?? null,
			setItem: (k: string, v: string) => {
				if (refuse) throw new Error('QuotaExceededError');
				data.set(k, v);
				writes.push(k);
			},
			removeItem: (k: string) => {
				data.delete(k);
			},
		});
		vi.stubGlobal('window', {
			addEventListener: (name: string, fn: () => void) => {
				const existing = listeners[name] ?? [];
				existing.push(fn);
				listeners[name] = existing;
			},
		});
		vi.stubGlobal('document', { visibilityState: 'visible' });
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	const stored = (k: string) => data.get(k) ?? null;

	it('writes once for a burst of sets, keeping the last value', () => {
		const storage = deferredLocalStorage<{ width: number }>();

		for (let width = 200; width <= 260; width += 10) {
			storage.setItem('factorai.panel', { state: { width }, version: 1 });
		}
		expect(writes.length).toBe(0);

		vi.runAllTimers();
		expect(writes.length).toBe(1);
		expect(JSON.parse(stored('factorai.panel') ?? '{}')).toEqual({
			state: { width: 260 },
			version: 1,
		});
	});

	it('reads back a value that has not been written yet', () => {
		const storage = deferredLocalStorage<{ width: number }>();
		storage.setItem('factorai.panel', { state: { width: 300 }, version: 1 });

		// A rehydrate landing inside the window must not see the older state the
		// store has already left.
		expect(storage.getItem('factorai.panel')).toEqual({ state: { width: 300 }, version: 1 });
		expect(stored('factorai.panel')).toBeNull();
	});

	it('flushes what is pending when the page goes away', () => {
		const storage = deferredLocalStorage<{ width: number }>();
		storage.setItem('factorai.panel', { state: { width: 321 }, version: 1 });

		for (const fn of listeners.pagehide ?? []) fn();

		expect(JSON.parse(stored('factorai.panel') ?? '{}')).toEqual({
			state: { width: 321 },
			version: 1,
		});
	});

	it('removing drops a pending write as well as the stored value', () => {
		const storage = deferredLocalStorage<{ width: number }>();
		localStorage.setItem('factorai.panel', JSON.stringify({ state: { width: 1 }, version: 1 }));
		storage.setItem('factorai.panel', { state: { width: 2 }, version: 1 });

		storage.removeItem('factorai.panel');
		vi.runAllTimers();

		expect(stored('factorai.panel')).toBeNull();
		expect(storage.getItem('factorai.panel')).toBeNull();
	});

	it('reads null rather than throwing on corrupt json', () => {
		localStorage.setItem('factorai.panel', '{not json');
		expect(deferredLocalStorage().getItem('factorai.panel')).toBeNull();
	});

	it('survives a storage that refuses to write', () => {
		refuse = true;
		const storage = deferredLocalStorage<{ width: number }>();
		storage.setItem('factorai.panel', { state: { width: 1 }, version: 1 });

		expect(() => vi.runAllTimers()).not.toThrow();
	});
});
