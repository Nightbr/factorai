import type { PersistStorage, StorageValue } from 'zustand/middleware';

/**
 * How long a persisted store waits before writing. Long enough to coalesce a
 * pointer drag or a window resize, short enough that it is over before anyone
 * could act on it — a flush is also forced when the window goes away.
 */
const WRITE_DELAY_MS = 150;

/**
 * `localStorage` for a persisted Zustand store, deferred by a frame or two
 * (PERF-12, `specs/10-performance.md`).
 *
 * **Why not the default.** Zustand's `persist` wraps `setState`, so *every*
 * change to a persisted store runs `partialize`, serialises the result and
 * writes it — whether or not the persisted slice moved. Two of the app's
 * setters run per frame: `viewerStore.setShellWidth` from the shell's
 * `ResizeObserver`, which serialised the whole open-tabs map on every frame of
 * a window resize although `shellWidth` is not even persisted, and the six
 * `panelStore` size setters plus `sidebarStore.setWidth` from `PanelResizer`,
 * which run on every `pointermove` of a drag. On WebKitGTK `localStorage` is
 * SQLite-backed, so that is a synchronous database write per frame.
 *
 * Deferring collapses a burst into one write and — because the value is held as
 * an object and serialised at the end — one `JSON.stringify` as well. The last
 * value wins, which is what a drag wants.
 *
 * **Nothing is lost on the way out.** A pending write is flushed when the page
 * is hidden or unloaded, and synchronously, because `pagehide` is the last
 * moment anything runs.
 */
export function deferredLocalStorage<S>(): PersistStorage<S> {
	const pending = new Map<string, StorageValue<S>>();
	let timer: ReturnType<typeof setTimeout> | null = null;

	const flush = () => {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
		for (const [name, value] of pending) {
			try {
				localStorage.setItem(name, JSON.stringify(value));
			} catch {
				// A full or blocked store — and, in the unit-test environment, no
				// storage at all — is not worth taking a panel resize down for. The
				// preference is lost; the window keeps working.
			}
		}
		pending.clear();
	};

	if (typeof window !== 'undefined') {
		// `pagehide` rather than `beforeunload`: it fires for a webview being torn
		// down, and it is not subject to the "did the user interact" rule that
		// makes `beforeunload` unreliable.
		window.addEventListener('pagehide', flush);
		window.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') flush();
		});
	}

	return {
		getItem: (name) => {
			// A pending value is the newer one, and a rehydrate that missed it would
			// read a state the store has already left.
			const queued = pending.get(name);
			if (queued) return queued;
			try {
				const raw = localStorage.getItem(name);
				if (raw === null) return null;
				return JSON.parse(raw) as StorageValue<S>;
			} catch {
				// Corrupt JSON, or no storage to read — both are "nothing stored",
				// which is what `persist` does with a `null` and what every one of
				// these stores has a default for.
				return null;
			}
		},
		setItem: (name, value) => {
			pending.set(name, value);
			if (timer === null) timer = setTimeout(flush, WRITE_DELAY_MS);
		},
		removeItem: (name) => {
			pending.delete(name);
			try {
				localStorage.removeItem(name);
			} catch {
				// See `flush`.
			}
		},
	};
}
