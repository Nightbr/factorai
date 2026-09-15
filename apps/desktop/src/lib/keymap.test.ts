import { describe, expect, it } from 'vitest';
import type { Hotkey } from '@tanstack/react-hotkeys';
import {
	type Keymap,
	SHORTCUT_SPECS,
	assignHotkey,
	clearHotkey,
	defaultKeymap,
	hotkeysOverTerminal,
	isOverridden,
	mergeKeymap,
	overridesFrom,
	specsFor,
	stepTab,
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
		const through = hotkeysOverTerminal(defaultKeymap());
		expect(through).toContain('Mod+,');
		expect(through).toContain('Mod+Shift+E');
	});

	// Corrected on user feedback: it shipped suppressed over the terminal, which
	// is where the focus almost always is, so the binding was unreachable exactly
	// when it was wanted.
	it('lets close-tab through, which costs the terminal that chord', () => {
		expect(hotkeysOverTerminal(defaultKeymap())).toContain('Mod+W');
	});

	it('never lets find through: the terminal keeps that chord', () => {
		expect(hotkeysOverTerminal(defaultKeymap())).not.toContain('Mod+F');
	});

	it('drops an action the user unbound', () => {
		const map = clearHotkey(defaultKeymap(), 'openSettings');
		expect(hotkeysOverTerminal(map)).not.toContain('Mod+,');
	});

	it('follows a rebind rather than the default', () => {
		const map = assignHotkey(defaultKeymap(), 'openSettings', 'Mod+Shift+P');
		const through = hotkeysOverTerminal(map);
		expect(through).toContain('Mod+Shift+P');
		expect(through).not.toContain('Mod+,');
	});

	it('covers every spec that claims it', () => {
		const claiming = SHORTCUT_SPECS.filter((s) => s.overTerminal).length;
		expect(hotkeysOverTerminal(defaultKeymap())).toHaveLength(claiming);
	});
});

describe('stepping through a tab strip', () => {
	const strip = ['a', 'b', 'c'];

	it('moves one step in each direction', () => {
		expect(stepTab(strip, 'a', 1)).toBe('b');
		expect(stepTab(strip, 'b', -1)).toBe('a');
	});

	it('wraps at both ends, so a repeated keystroke never dead-ends', () => {
		expect(stepTab(strip, 'c', 1)).toBe('a');
		expect(stepTab(strip, 'a', -1)).toBe('c');
	});

	it('stays put with one tab open', () => {
		expect(stepTab(['only'], 'only', 1)).toBe('only');
	});

	it('has nowhere to go from an empty strip or an unknown tab', () => {
		expect(stepTab([], 'a', 1)).toBeNull();
		expect(stepTab(strip, 'gone', 1)).toBeNull();
	});
});
