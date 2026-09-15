import { describe, expect, it } from 'vitest';
import type { Hotkey } from '@tanstack/react-hotkeys';
import {
	type Keymap,
	SHORTCUT_SPECS,
	assignHotkey,
	clearHotkey,
	defaultKeymap,
	firesOverTerminal,
	hotkeysOverTerminal,
	isOverridden,
	mergeKeymap,
	overridesFrom,
	specsFor,
} from './keymap';

describe('the shipped map', () => {
	it('binds every action to a distinct chord', () => {
		const bound = Object.values(defaultKeymap()).filter((h): h is Hotkey => h !== null);
		expect(new Set(bound).size).toBe(bound.length);
	});

	it('hides the Linux-only rows on macOS', () => {
		expect(specsFor('mac').some((s) => s.action === 'quit')).toBe(false);
		expect(specsFor('linux').some((s) => s.action === 'quit')).toBe(true);
	});
});

describe('merging overrides', () => {
	it('is the shipped map when there are none', () => {
		expect(mergeKeymap({})).toEqual(defaultKeymap());
	});

	it('keeps an explicit null as deliberately unbound', () => {
		expect(mergeKeymap({ openSettings: null }).openSettings).toBeNull();
	});

	it('drops an override for an action that no longer exists', () => {
		const merged = mergeKeymap({ goToLine: 'Mod+G' } as never);
		expect(merged).toEqual(defaultKeymap());
	});

	// The case this whole shape exists for: item 12 ships Mod+P as quick-open's
	// default, and this user took Mod+P for something else a release ago.
	it('lets the user override win over a default that arrives later', () => {
		const merged = mergeKeymap({ newSession: 'Mod+K' });
		expect(merged.newSession).toBe('Mod+K');
		expect(merged.focusSidebarSearch).toBeNull();
	});

	it('never leaves two actions holding one chord', () => {
		const merged = mergeKeymap({ newSession: 'Mod+K', toggleFilePanel: 'Mod+,' });
		const bound = Object.values(merged).filter((h): h is Hotkey => h !== null);
		expect(new Set(bound).size).toBe(bound.length);
	});
});

describe('assigning in the draft', () => {
	const base: Keymap = defaultKeymap();

	it('steals the chord and blanks the row that held it', () => {
		const next = assignHotkey(base, 'newSession', 'Mod+K');
		expect(next.newSession).toBe('Mod+K');
		expect(next.focusSidebarSearch).toBeNull();
	});

	it('leaves the other rows alone', () => {
		const next = assignHotkey(base, 'newSession', 'Mod+K');
		expect(next.openSettings).toBe(base.openSettings);
	});

	it('is a no-op against itself', () => {
		expect(assignHotkey(base, 'openSettings', 'Mod+,')).toEqual(base);
	});

	it('clears one row without touching the rest', () => {
		const next = clearHotkey(base, 'openSettings');
		expect(next.openSettings).toBeNull();
		expect(next.newSession).toBe(base.newSession);
	});
});

describe('what gets persisted', () => {
	it('stores nothing when the draft is the shipped map', () => {
		expect(overridesFrom(defaultKeymap())).toEqual({});
	});

	it('stores only the rows that differ, including an unbind', () => {
		let map = assignHotkey(defaultKeymap(), 'openSettings', 'Mod+Shift+P');
		map = clearHotkey(map, 'newSession');
		expect(overridesFrom(map)).toEqual({ openSettings: 'Mod+Shift+P', newSession: null });
	});

	it('round-trips through a merge', () => {
		const map = assignHotkey(defaultKeymap(), 'openSettings', 'Mod+Shift+P');
		expect(mergeKeymap(overridesFrom(map))).toEqual(map);
	});

	it('marks a row overridden only while it differs', () => {
		const map = assignHotkey(defaultKeymap(), 'openSettings', 'Mod+Shift+P');
		expect(isOverridden(map, 'openSettings')).toBe(true);
		expect(isOverridden(map, 'newSession')).toBe(false);
	});
});

describe('the chords xterm must let through', () => {
	it('is every over-terminal action that has a binding', () => {
		const through = hotkeysOverTerminal(defaultKeymap(), 'linux');
		expect(through).toContain('Mod+,');
		expect(through).toContain('Mod+Shift+E');
	});

	// The one binding whose answer is not the same on both platforms: Ctrl+W is
	// readline's delete-previous-word and stays the terminal's, while Cmd+W means
	// nothing to a shell and a Mac user has the terminal focused nearly always.
	it('lets close-tab through on macOS and not on Linux', () => {
		expect(hotkeysOverTerminal(defaultKeymap(), 'mac')).toContain('Mod+W');
		expect(hotkeysOverTerminal(defaultKeymap(), 'linux')).not.toContain('Mod+W');
	});

	it('never lets find through: the terminal keeps that chord', () => {
		expect(hotkeysOverTerminal(defaultKeymap(), 'mac')).not.toContain('Mod+F');
		expect(hotkeysOverTerminal(defaultKeymap(), 'linux')).not.toContain('Mod+F');
	});

	it('drops an action the user unbound', () => {
		const map = clearHotkey(defaultKeymap(), 'openSettings');
		expect(hotkeysOverTerminal(map, 'linux')).not.toContain('Mod+,');
	});

	it('follows a rebind rather than the default', () => {
		const map = assignHotkey(defaultKeymap(), 'openSettings', 'Mod+Shift+P');
		const through = hotkeysOverTerminal(map, 'linux');
		expect(through).toContain('Mod+Shift+P');
		expect(through).not.toContain('Mod+,');
	});

	it('covers every spec that claims it', () => {
		const claiming = SHORTCUT_SPECS.filter((s) => firesOverTerminal(s, 'linux')).length;
		expect(hotkeysOverTerminal(defaultKeymap(), 'linux')).toHaveLength(claiming);
	});
});
