import { describe, expect, it, vi } from 'vitest';
import {
	currentTheme,
	installTheme,
	onThemeChange,
	resolveTheme,
	type ThemeMedia,
	type ThemePref,
	themePrefOf,
} from './theme';

/** A stand-in for `<html>`: only the one attribute the theme writes. */
function fakeRoot() {
	const attrs = new Map<string, string>();
	return {
		setAttribute: (name: string, value: string) => attrs.set(name, value),
		get theme() {
			return attrs.get('data-theme');
		},
	};
}

/** A `MediaQueryList` for `prefers-color-scheme: dark` that a test can flip. */
function fakeMedia(dark: boolean) {
	const listeners = new Set<() => void>();
	const media: ThemeMedia & { matches: boolean; flip(next: boolean): void } = {
		matches: dark,
		addEventListener: (_: 'change', cb: () => void) => listeners.add(cb),
		removeEventListener: (_: 'change', cb: () => void) => listeners.delete(cb),
		flip(next) {
			media.matches = next;
			for (const cb of listeners) cb();
		},
	};
	return media;
}

/** The preference, with the store's subscribe shape. */
function fakePref(initial: ThemePref) {
	let value = initial;
	const listeners = new Set<() => void>();
	return {
		get: () => value,
		subscribe: (cb: () => void) => {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		set(next: ThemePref) {
			value = next;
			for (const cb of listeners) cb();
		},
	};
}

function install(pref: ReturnType<typeof fakePref>, media: ReturnType<typeof fakeMedia>) {
	const root = fakeRoot();
	const onChange = vi.fn();
	installTheme({
		getPref: pref.get,
		subscribePref: pref.subscribe,
		media,
		root,
	});
	const unsubscribe = onThemeChange(onChange);
	return { root, onChange, unsubscribe };
}

describe('resolveTheme', () => {
	it('follows the system only when the preference says so', () => {
		expect(resolveTheme('system', true)).toBe('dark');
		expect(resolveTheme('system', false)).toBe('light');
		expect(resolveTheme('light', true)).toBe('light');
		expect(resolveTheme('dark', false)).toBe('dark');
	});
});

describe('themePrefOf', () => {
	it('keeps the three values and falls back to system for anything else', () => {
		expect(themePrefOf('light')).toBe('light');
		expect(themePrefOf('dark')).toBe('dark');
		expect(themePrefOf('system')).toBe('system');
		expect(themePrefOf('sepia')).toBe('system');
		expect(themePrefOf(undefined)).toBe('system');
	});
});

describe('installTheme', () => {
	it('writes the resolved theme onto the root before anything renders', () => {
		const { root } = install(fakePref('system'), fakeMedia(false));
		expect(root.theme).toBe('light');
		expect(currentTheme()).toBe('light');
	});

	it('follows the system appearance while the preference is system', () => {
		const media = fakeMedia(true);
		const { root, onChange } = install(fakePref('system'), media);
		expect(root.theme).toBe('dark');
		media.flip(false);
		expect(root.theme).toBe('light');
		expect(onChange).toHaveBeenCalledWith('light');
	});

	it('ignores the system appearance once a theme is chosen', () => {
		const media = fakeMedia(true);
		const { root, onChange } = install(fakePref('dark'), media);
		media.flip(false);
		expect(root.theme).toBe('dark');
		expect(onChange).not.toHaveBeenCalled();
	});

	it('applies a saved preference at once', () => {
		const pref = fakePref('system');
		const { root, onChange } = install(pref, fakeMedia(true));
		pref.set('light');
		expect(root.theme).toBe('light');
		expect(onChange).toHaveBeenCalledTimes(1);
	});

	it('does not notify when a change resolves to the theme already showing', () => {
		// system on a dark machine → dark: the same palette, so nothing repaints.
		const pref = fakePref('system');
		const { onChange } = install(pref, fakeMedia(true));
		pref.set('dark');
		expect(onChange).not.toHaveBeenCalled();
	});

	it('stops notifying a listener that unsubscribed', () => {
		const pref = fakePref('dark');
		const { onChange, unsubscribe } = install(pref, fakeMedia(true));
		unsubscribe();
		pref.set('light');
		expect(onChange).not.toHaveBeenCalled();
	});
});
