import { type Hotkey, formatForDisplay, parseHotkey } from '@tanstack/react-hotkeys';

/**
 * Every app-level action that can carry a keyboard binding (F28, ADR-0046).
 *
 * **Not everything keyboard-driven is here.** Arrow-key navigation inside a
 * focused list — the sidebar, the Changes tab, the graph — is list behaviour and
 * stays a local `onKeyDown` with a roving tabindex. A settings row offering to
 * reassign `↓` would be offering something that cannot work.
 */
export type ShortcutAction =
	| 'newSession'
	| 'focusSidebarSearch'
	| 'findOrSearch'
	| 'toggleFilePanel'
	| 'closeFocusedTab'
	| 'nextTab'
	| 'previousTab'
	| 'switchToTab'
	| 'openSettings'
	| 'quit';

/** What the settings section renders, and what the bindings are registered
 *  from. One entry per action, in the order the section lists them. */
interface ShortcutSpec {
	action: ShortcutAction;
	/** The row's name in settings, and what a tooltip appends its chord to. */
	label: string;
	/** The shipped binding. `null` would mean "ships unbound", which nothing
	 *  does today — it is the shape a future action arrives in when the user has
	 *  already taken its chord. */
	defaultHotkey: Hotkey | null;
	/**
	 * Does this fire while the terminal (or Monaco, or a text field) has focus?
	 *
	 * **False is the safe answer**: xterm's focus target is a real hidden
	 * `<textarea>`, so the library's `ignoreInputs` already suppresses hotkeys
	 * there, and a global handler that swallows a keystroke breaks typing to
	 * Claude. True is for the bindings whose whole point is reaching the rest of
	 * the app *from* a terminal you are typing in — and every one of them also
	 * needs `attachCustomKeyEventHandler` to let it past xterm, which is why
	 * `hotkeysOverTerminal` derives that list from here rather than from a second
	 * list kept by hand.
	 *
	 * A binding that fires over the terminal **takes** the chord: xterm is told
	 * not to handle it, so nothing is written to the PTY either. That is a real
	 * cost where the shell wanted the key, and it is the reason this is per
	 * action rather than a blanket rule.
	 */
	overTerminal: boolean;
	/** Linux only. macOS gets this action from the app menu instead, because
	 *  AppKit consumes the accelerator before the webview sees it (ADR-0046). */
	linuxOnly?: true;
	/**
	 * The binding is a **modifier applied to the digits 1–9**, not one chord
	 * (ADR-0074). It is stored as the `1` chord — `Mod+1` stands for `Mod+1`
	 * through `Mod+9` — so the map's shape, persistence and reset stay the same
	 * as every other row's. Such a row never loses a digit to a steal: a
	 * recording that would break the run is refused instead.
	 */
	digits?: true;
}

/**
 * The shipped bindings, in settings order.
 *
 * `Mod` resolves to Meta on macOS and Control on Linux — and so under WSLg
 * (ADR-0044) — which is what lets one entry cover both targets.
 */
export const SHORTCUT_SPECS: readonly ShortcutSpec[] = [
	{
		action: 'newSession',
		label: 'New session in the active project',
		defaultHotkey: 'Mod+N',
		overTerminal: true,
	},
	{
		action: 'focusSidebarSearch',
		label: 'Focus the sidebar search',
		defaultHotkey: 'Mod+K',
		overTerminal: true,
	},
	{
		// One action, two meanings, decided by focus: find inside the viewer, and
		// focus the sidebar search anywhere else. Two actions would put two rows
		// in settings that can never both be reachable at once.
		//
		// **Not over the terminal**, and that is the honest answer rather than the
		// tidy one: there is no terminal find bar to open — `SearchAddon` is
		// loaded and has no UI — so the chord stays xterm's while the terminal has
		// focus, which is also what stops it yanking focus to the sidebar out from
		// under someone typing to Claude.
		action: 'findOrSearch',
		label: 'Find here, or focus the sidebar search',
		defaultHotkey: 'Mod+F',
		overTerminal: false,
	},
	{
		// Q15 deferred this binding to exactly this feature. `Ctrl+B` is
		// readline's back-a-char and tmux's prefix; `Mod+J` is worse than it looks,
		// because on Linux `Mod` is Control and `Ctrl+J` is a literal line feed.
		// No readline binding uses Ctrl+Shift+letter.
		action: 'toggleFilePanel',
		label: 'Toggle the file panel',
		defaultHotkey: 'Mod+Shift+E',
		overTerminal: true,
	},
	{
		// **Over the terminal, on both platforms — corrected 2026-09-15 on user
		// feedback.** It shipped suppressed there, on the reasoning that `Ctrl+W`
		// is readline's delete-previous-word and taking it would break a key used
		// inside Claude's prompt. That reasoning is sound and the result was still
		// wrong: the terminal holds focus nearly all the time, so the binding was
		// unreachable exactly when you want it, and a shortcut that works only
		// where you are not looking reads as broken rather than as careful.
		//
		// What makes this affordable is that it is a *default*: somebody who wants
		// readline's `Ctrl+W` back moves this row in settings, which is the point
		// of the map. What is not affordable is a key nobody can press.
		action: 'closeFocusedTab',
		label: 'Close the focused tab',
		defaultHotkey: 'Mod+W',
		overTerminal: true,
	},
	{
		// **Page keys rather than brackets or `Ctrl+Tab`.** `Mod+Shift+[` / `]` is
		// the editor convention and needs AltGr on a French layout, which makes it
		// a two-hand gesture for half the people who would use it. `Ctrl+Tab` is
		// the browser one, and Tab is how you accept a completion in Claude's
		// prompt, so it reads as risky even where it works. The page keys mean the
		// same thing in every editor and are in the same place on every layout;
		// xterm binds only `Shift+PageUp` / `Shift+PageDown`, so scrolling the
		// terminal is untouched.
		action: 'nextTab',
		label: 'Next tab',
		defaultHotkey: 'Mod+PageDown',
		overTerminal: true,
	},
	{
		action: 'previousTab',
		label: 'Previous tab',
		defaultHotkey: 'Mod+PageUp',
		overTerminal: true,
	},
	{
		// **Mod+9 is the last tab, not the ninth** — the browser convention, and
		// the only way to reach the end of a strip longer than nine. Session
		// tabs only, whatever has focus: the file strip keeps the page keys.
		action: 'switchToTab',
		label: 'Switch to tab 1–9 (9 is the last tab)',
		defaultHotkey: 'Mod+1',
		overTerminal: true,
		digits: true,
	},
	{
		action: 'openSettings',
		label: 'Open settings',
		defaultHotkey: 'Mod+,',
		overTerminal: true,
	},
	{
		action: 'quit',
		label: 'Quit factorai',
		defaultHotkey: 'Mod+Q',
		overTerminal: true,
		linuxOnly: true,
	},
] as const;

/** Every action's binding. `null` is bound to nothing, which is a state a user
 *  is allowed to choose and a state a late-arriving action can start in. */
export type Keymap = Record<ShortcutAction, Hotkey | null>;

/**
 * What the user changed, and **only** what the user changed.
 *
 * Persisting the difference rather than the whole table is what lets a default
 * we change in a later release actually reach somebody who has saved once. A
 * key present with a `null` value is "deliberately unbound" — a different state
 * from absent, which is "never touched".
 */
export type KeymapOverrides = Partial<Record<ShortcutAction, Hotkey | null>>;

const ACTIONS = SHORTCUT_SPECS.map((s) => s.action);

function isShortcutAction(value: string): value is ShortcutAction {
	return (ACTIONS as string[]).includes(value);
}

/** The shipped map, before any override. */
export function defaultKeymap(): Keymap {
	const map = {} as Keymap;
	for (const spec of SHORTCUT_SPECS) map[spec.action] = spec.defaultHotkey;
	return map;
}

/**
 * Defaults, then overrides, then one conflict pass — the whole merge.
 *
 * **The user's override outranks a default that ships later.** When a future
 * feature's default is a chord this user has already taken, the override stays
 * and the arriving action comes up unbound, which settings shows as a blank row.
 * Quietly removing a key somebody chose, to make room for one they have never
 * seen, is the alternative.
 *
 * An override naming an action that no longer exists is dropped rather than
 * carried, so deleting an action cannot leave a chord registered to nothing.
 */
export function mergeKeymap(overrides: KeymapOverrides): Keymap {
	const map = defaultKeymap();
	const claimed = new Map<Hotkey, ShortcutAction>();

	for (const [action, hotkey] of Object.entries(overrides)) {
		if (!isShortcutAction(action)) continue;
		map[action] = hotkey;
		if (hotkey) for (const chord of chordsOf(action, hotkey)) claimed.set(chord, action);
	}

	for (const action of ACTIONS) {
		const hotkey = map[action];
		if (!hotkey) continue;
		const chords = chordsOf(action, hotkey);
		// A digit row is all nine or nothing: one chord held elsewhere unbinds
		// the whole row rather than leaving a run with a hole in it.
		if (chords.some((c) => (claimed.get(c) ?? action) !== action)) {
			map[action] = null;
			continue;
		}
		for (const chord of chords) claimed.set(chord, action);
	}

	return map;
}

/**
 * Assign a chord in the settings draft, **stealing** it from whichever action
 * held it.
 *
 * Refusing instead would make swapping two bindings impossible without a
 * three-step dance through unbind, and a row that visibly empties says what
 * happened better than an error naming a row you were not looking at. Safe
 * because this is a draft: Q24's Save commits it and Cancel discards it.
 */
export function assignHotkey(map: Keymap, action: ShortcutAction, hotkey: Hotkey): Keymap {
	const next: Keymap = { ...map, [action]: hotkey };
	const taken = new Set(chordsOf(action, hotkey));
	for (const other of ACTIONS) {
		const held = next[other];
		if (other === action || !held) continue;
		if (chordsOf(other, held).some((c) => taken.has(c))) next[other] = null;
	}
	return next;
}

/**
 * The action that stops this assignment, or `null` when it may go ahead.
 *
 * **A digit row is the one exception to stealing** (ADR-0074). Taking one of
 * its nine chords would leave `Mod+1`–`Mod+9` with a hole in it, and moving it
 * onto a modifier where another action holds a digit would do the same from the
 * other side. Both are refused, and the row that would have lost says why.
 * Every other collision still steals, as ADR-0046 decided.
 */
export function blockingAction(
	map: Keymap,
	action: ShortcutAction,
	hotkey: Hotkey,
): ShortcutAction | null {
	const taken = new Set(chordsOf(action, hotkey));
	for (const other of ACTIONS) {
		const held = map[other];
		if (other === action || !held) continue;
		if (!isDigitsAction(action) && !isDigitsAction(other)) continue;
		if (chordsOf(other, held).some((c) => taken.has(c))) return other;
	}
	return null;
}

/** Unbind one action — what the `×` on a settings row does. */
export function clearHotkey(map: Keymap, action: ShortcutAction): Keymap {
	return { ...map, [action]: null };
}

/**
 * The draft as overrides: only what differs from the shipped map.
 *
 * An action bound to its default is *absent* rather than stored, which is what
 * keeps a later change to that default reaching this user.
 */
export function overridesFrom(map: Keymap): KeymapOverrides {
	const overrides: KeymapOverrides = {};
	for (const spec of SHORTCUT_SPECS) {
		if (map[spec.action] !== spec.defaultHotkey) overrides[spec.action] = map[spec.action];
	}
	return overrides;
}

/** Is this row showing something other than what the app shipped? Drives the
 *  per-row reset, which exists only while there is something to reset to. */
export function isOverridden(map: Keymap, action: ShortcutAction): boolean {
	const spec = SHORTCUT_SPECS.find((s) => s.action === action);
	return spec !== undefined && map[action] !== spec.defaultHotkey;
}

/**
 * The chords xterm must **not** swallow, from the map that is actually in force.
 *
 * Derived rather than listed, because a hand-kept second list is how the
 * pass-through and the bindings drift apart — and the symptom of that drift is a
 * key that works everywhere except where the user is typing.
 */
export function hotkeysOverTerminal(map: Keymap): Hotkey[] {
	const out: Hotkey[] = [];
	for (const spec of SHORTCUT_SPECS) {
		const hotkey = map[spec.action];
		if (hotkey && spec.overTerminal && spec.digits !== true) out.push(hotkey);
	}
	return out;
}

/** The specs this platform actually has. macOS drops the Linux-only rows, so
 *  settings never shows a binding that the menu owns and the webview cannot
 *  see. */
export function specsFor(platform: 'mac' | 'linux'): readonly ShortcutSpec[] {
	if (platform === 'mac') return SHORTCUT_SPECS.filter((s) => s.linuxOnly !== true);
	return SHORTCUT_SPECS;
}

/**
 * The tab one step away, wrapping at both ends (F28).
 *
 * **It wraps**, which is the decision here: a strip of two is the ordinary case
 * in this app, and a next-tab that stops at the end turns a repeated keystroke
 * into "check where you are first". Both tab strips step through this, so they
 * cannot disagree about what the last tab's next is.
 *
 * Returns `null` when there is nothing to move to — an empty strip, or a
 * current tab the list does not contain, which is what a just-closed tab looks
 * like for one render.
 */
export function stepTab<T>(items: readonly T[], current: T, delta: 1 | -1): T | null {
	if (items.length === 0) return null;
	const from = items.indexOf(current);
	if (from < 0) return null;
	const to = (from + delta + items.length) % items.length;
	return items[to] ?? null;
}

/** The digits a digit row covers, in order. */
const TAB_DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

function isDigitsAction(action: ShortcutAction): boolean {
	return SHORTCUT_SPECS.some((s) => s.action === action && s.digits === true);
}

/** `Mod+1` with its key swapped for another. Only ever called on a digit
 *  row's binding, whose key is a single digit, so the last `+` is the split. */
function withKey(hotkey: Hotkey, key: string): Hotkey {
	const at = hotkey.lastIndexOf('+');
	return `${at < 0 ? '' : hotkey.slice(0, at + 1)}${key}` as Hotkey;
}

/** Every chord one binding occupies: itself, or nine for a digit row. */
export function chordsOf(action: ShortcutAction, hotkey: Hotkey): Hotkey[] {
	if (!isDigitsAction(action)) return [hotkey];
	return TAB_DIGITS.map((d) => withKey(hotkey, String(d)));
}

/** A physical digit key, from `KeyboardEvent.code`: the top row or the keypad. */
function digitOfCode(code: string): number | null {
	const match = /^(?:Digit|Numpad)([0-9])$/.exec(code);
	return match ? Number(match[1]) : null;
}

/**
 * The recorder's chord with a digit key spelled as the digit it physically is.
 *
 * The recorder reads `KeyboardEvent.key`, so `Ctrl+1` on AZERTY records as
 * `Mod+&` and `Ctrl+2` as `Mod+é`. The bindings themselves fire by physical key,
 * so a row has to be stored the same way or its conflict checks look at the
 * wrong chord.
 */
export function withPhysicalDigit(hotkey: Hotkey, code: string): Hotkey {
	const digit = digitOfCode(code);
	return digit === null ? hotkey : withKey(hotkey, String(digit));
}

/**
 * What a digit row stores for a recorded chord: its modifiers on `1`, or
 * `null` when the chord cannot stand for nine.
 *
 * It needs a digit key, any of them — pressing `Alt+3` means "use Alt". And it
 * needs a modifier other than Shift alone, because a bare or shifted digit is
 * typing, and this row takes its chords from the terminal.
 */
export function digitsBinding(
	recorded: Hotkey,
	code: string,
	platform: 'mac' | 'linux',
): Hotkey | null {
	if (digitOfCode(code) === null) return null;
	const parsed = parseHotkey(recorded, platform);
	if (!parsed.ctrl && !parsed.alt && !parsed.meta) return null;
	return withKey(recorded, '1');
}

/**
 * The digit a keystroke selects under a digit row's binding, or `null`.
 *
 * **By physical key, not by character.** The library falls back to
 * `KeyboardEvent.code` for some layouts, not for keys that produce a letter —
 * and AZERTY's digit row gives `é`, `è`, `ç` and `à` unshifted, so `Ctrl+2` would
 * never match there. Modifiers must match exactly, as they do for every chord.
 */
export function tabDigitOf(
	hotkey: Hotkey,
	event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>,
	platform: 'mac' | 'linux',
): number | null {
	const want = parseHotkey(hotkey, platform);
	if (event.ctrlKey !== want.ctrl || event.shiftKey !== want.shift) return null;
	if (event.altKey !== want.alt || event.metaKey !== want.meta) return null;
	const digit = digitOfCode(event.code);
	return digit !== null && digit >= 1 ? digit : null;
}

/** Does this keystroke belong to an over-terminal digit row? The digit half of
 *  xterm's pass-through, beside `hotkeysOverTerminal`'s chords. */
export function isDigitsOverTerminal(
	map: Keymap,
	event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>,
	platform: 'mac' | 'linux',
): boolean {
	return SHORTCUT_SPECS.some((spec) => {
		const hotkey = map[spec.action];
		return (
			spec.digits === true &&
			spec.overTerminal &&
			hotkey !== null &&
			tabDigitOf(hotkey, event, platform) !== null
		);
	});
}

/** A binding as a person reads it: `⌘ 1–9` for a digit row, the chord itself
 *  for any other. */
export function displayChord(
	action: ShortcutAction,
	hotkey: Hotkey,
	platform: 'mac' | 'linux',
): string {
	const shown = formatForDisplay(hotkey, { platform });
	return isDigitsAction(action) ? `${shown}–9` : shown;
}

/**
 * The tab a digit selects: `1`–`8` by position, `9` the last, whatever the
 * count. `null` when the strip has no tab there.
 */
export function tabAtDigit<T>(items: readonly T[], digit: number): T | null {
	if (digit === 9) return items.at(-1) ?? null;
	return items[digit - 1] ?? null;
}
