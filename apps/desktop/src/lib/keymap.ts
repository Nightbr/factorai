import type { Hotkey } from '@tanstack/react-hotkeys';

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
		if (hotkey) claimed.set(hotkey, action);
	}

	for (const action of ACTIONS) {
		const hotkey = map[action];
		if (!hotkey) continue;
		const owner = claimed.get(hotkey);
		if (owner === undefined) {
			claimed.set(hotkey, action);
			continue;
		}
		if (owner !== action) map[action] = null;
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
	for (const other of ACTIONS) {
		if (other !== action && next[other] === hotkey) next[other] = null;
	}
	return next;
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
		if (hotkey && spec.overTerminal) out.push(hotkey);
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
