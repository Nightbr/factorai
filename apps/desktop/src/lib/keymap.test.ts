import { describe, expect, it } from 'vitest';
import type { Hotkey } from '@tanstack/react-hotkeys';
import {
	type Keymap,
	SHORTCUT_SPECS,
	assignHotkey,
	blockingAction,
	chordsOf,
	clearHotkey,
	defaultKeymap,
	digitsBinding,
	displayChord,
	hotkeysOverTerminal,
	isDigitsOverTerminal,
	isOverridden,
	mergeKeymap,
	overridesFrom,
	specsFor,
	stepTab,
	tabAtDigit,
	tabDigitOf,
	withPhysicalDigit,
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

	it('covers every single-chord spec that claims it', () => {
		const claiming = SHORTCUT_SPECS.filter((s) => s.overTerminal && s.digits !== true).length;
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

/** A keydown as far as the digit matcher reads one. */
function key(
	code: string,
	mods: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {},
) {
	return {
		code,
		ctrlKey: mods.ctrl ?? false,
		shiftKey: mods.shift ?? false,
		altKey: mods.alt ?? false,
		metaKey: mods.meta ?? false,
	};
}

describe('the tab digits row', () => {
	it('ships as Mod+1, standing for Mod+1 through Mod+9', () => {
		expect(defaultKeymap().switchToTab).toBe('Mod+1');
		expect(chordsOf('switchToTab', 'Mod+1')).toEqual([
			'Mod+1',
			'Mod+2',
			'Mod+3',
			'Mod+4',
			'Mod+5',
			'Mod+6',
			'Mod+7',
			'Mod+8',
			'Mod+9',
		]);
	});

	it('keeps a modifier change across all nine', () => {
		expect(chordsOf('switchToTab', 'Alt+1')).toContain('Alt+9');
		expect(chordsOf('switchToTab', 'Mod+Shift+1')).toContain('Mod+Shift+5');
	});

	it('reads as a range', () => {
		expect(displayChord('switchToTab', 'Mod+1', 'linux')).toBe('Ctrl+1–9');
		expect(displayChord('openSettings', 'Mod+,', 'linux')).toBe('Ctrl+,');
	});

	it('loses the whole row, not one digit, to an override already holding one', () => {
		const merged = mergeKeymap({ newSession: 'Mod+3' });
		expect(merged.newSession).toBe('Mod+3');
		expect(merged.switchToTab).toBeNull();
	});
});

describe('the tab digits are never split', () => {
	const base = defaultKeymap();

	it('refuses another action on one of its chords', () => {
		expect(blockingAction(base, 'newSession', 'Mod+3')).toBe('switchToTab');
	});

	it('refuses moving the row onto a modifier another action holds a digit of', () => {
		const map = assignHotkey(base, 'newSession', 'Alt+4');
		expect(blockingAction(map, 'switchToTab', 'Alt+1')).toBe('newSession');
	});

	it('lets everything else steal as before', () => {
		expect(blockingAction(base, 'newSession', 'Mod+K')).toBeNull();
		expect(blockingAction(base, 'switchToTab', 'Alt+1')).toBeNull();
	});

	it('steals any chord in the run when the row moves over a free modifier', () => {
		const next = assignHotkey(base, 'switchToTab', 'Alt+1');
		expect(next.switchToTab).toBe('Alt+1');
		expect(next.newSession).toBe(base.newSession);
	});
});

describe('recording a digit row', () => {
	it('keeps the modifier of whatever digit was pressed', () => {
		expect(digitsBinding('Alt+3', 'Digit3', 'linux')).toBe('Alt+1');
		expect(digitsBinding('Mod+Shift+7', 'Digit7', 'linux')).toBe('Mod+Shift+1');
	});

	// AZERTY: the recorder reports the character, the code is the key.
	it('reads the physical key, so AZERTY records the digit and not its character', () => {
		expect(digitsBinding('Mod+é' as Hotkey, 'Digit2', 'linux')).toBe('Mod+1');
		expect(withPhysicalDigit('Mod+&' as Hotkey, 'Digit1')).toBe('Mod+1');
		expect(withPhysicalDigit('Mod+K', 'KeyK')).toBe('Mod+K');
	});

	it('refuses a chord without a digit', () => {
		expect(digitsBinding('Mod+K', 'KeyK', 'linux')).toBe('noDigit');
	});

	it('refuses a bare or shifted digit, which is typing', () => {
		expect(digitsBinding('1' as Hotkey, 'Digit1', 'linux')).toBe('typing');
		expect(digitsBinding('Shift+1' as Hotkey, 'Digit1', 'linux')).toBe('typing');
	});

	// Option+digit types `{`, `[`, `|` on a French Mac (ADR-0075).
	it('refuses Option alone on macOS, shifted or not', () => {
		expect(digitsBinding('Alt+1', 'Digit1', 'mac')).toBe('optionTypes');
		expect(digitsBinding('Alt+Shift+1' as Hotkey, 'Digit1', 'mac')).toBe('optionTypes');
	});

	it('allows Option with Command or Control on macOS, and Alt alone on Linux', () => {
		expect(digitsBinding('Mod+Alt+3' as Hotkey, 'Digit3', 'mac')).toBe('Mod+Alt+1');
		expect(digitsBinding('Control+Alt+3' as Hotkey, 'Digit3', 'mac')).toBe('Control+Alt+1');
		expect(digitsBinding('Alt+3', 'Digit3', 'linux')).toBe('Alt+1');
	});
});

describe('matching a keystroke to a digit', () => {
	it('finds the digit under the bound modifier', () => {
		expect(tabDigitOf('Mod+1', key('Digit4', { ctrl: true }), 'linux')).toBe(4);
		expect(tabDigitOf('Mod+1', key('Digit4', { meta: true }), 'mac')).toBe(4);
		expect(tabDigitOf('Mod+1', key('Numpad2', { ctrl: true }), 'linux')).toBe(2);
	});

	it('wants the modifiers exactly', () => {
		expect(tabDigitOf('Mod+1', key('Digit4'), 'linux')).toBeNull();
		expect(tabDigitOf('Mod+1', key('Digit4', { ctrl: true, shift: true }), 'linux')).toBeNull();
		expect(tabDigitOf('Mod+1', key('Digit4', { meta: true }), 'linux')).toBeNull();
	});

	it('ignores 0 and anything that is not a digit key', () => {
		expect(tabDigitOf('Mod+1', key('Digit0', { ctrl: true }), 'linux')).toBeNull();
		expect(tabDigitOf('Mod+1', key('KeyA', { ctrl: true }), 'linux')).toBeNull();
	});

	it('is let through xterm while bound, and not once unbound', () => {
		const event = key('Digit2', { ctrl: true });
		expect(isDigitsOverTerminal(defaultKeymap(), event, 'linux')).toBe(true);
		expect(isDigitsOverTerminal(clearHotkey(defaultKeymap(), 'switchToTab'), event, 'linux')).toBe(
			false,
		);
	});
});

describe('the tab a digit selects', () => {
	const strip = ['a', 'b', 'c'];

	it('is the tab at that position', () => {
		expect(tabAtDigit(strip, 1)).toBe('a');
		expect(tabAtDigit(strip, 3)).toBe('c');
	});

	it('is nothing past the end', () => {
		expect(tabAtDigit(strip, 4)).toBeNull();
		expect(tabAtDigit([], 1)).toBeNull();
	});

	it('is always the last for 9', () => {
		expect(tabAtDigit(strip, 9)).toBe('c');
		expect(tabAtDigit(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'], 9)).toBe('k');
		expect(tabAtDigit([], 9)).toBeNull();
	});
});
