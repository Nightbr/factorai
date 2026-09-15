import { type UseHotkeyDefinition, formatForDisplay, useHotkeys } from '@tanstack/react-hotkeys';
import { useMemo, useRef } from 'react';
import { type Keymap, type ShortcutAction, SHORTCUT_SPECS, mergeKeymap } from '@lib/keymap';
import { isMacOS } from '@lib/platform';
import { usePrefsStore } from '@store/prefsStore';
import { useRecordingStore } from '@store/recordingStore';

/** The bindings in force: what the app ships, with the user's overrides
 *  applied (F28). Every call site reads this rather than a literal chord, which
 *  is what makes a rebind take effect everywhere at once. */
export function useKeymap(): Keymap {
	const overrides = usePrefsStore((s) => s.keymapOverrides);
	return useMemo(() => mergeKeymap(overrides), [overrides]);
}

/** What a call site does when its action fires. Absent means "not mine" — a
 *  handler map is a subset, so the shell and the tab strip can each claim the
 *  actions they own without knowing about the other's. */
type ShortcutHandlers = Partial<Record<ShortcutAction, () => void>>;

interface ShortcutOptions {
	/** Only fire while this element, or something inside it, has focus. How a
	 *  context-dependent binding is expressed — the library has no named scopes
	 *  (ADR-0046). */
	target?: React.RefObject<HTMLElement | null>;
	/** Registered but suppressed while false. The registration stays, so
	 *  toggling this does not churn the manager. */
	enabled?: boolean;
}

/**
 * Register the actions this component owns, at the bindings currently in force.
 *
 * **Unbound actions are simply not registered.** An action the user cleared has
 * no chord to register, and there is no sentinel standing in for one.
 *
 * `ignoreInputs` comes from the action's own `overTerminal`, so the rule that
 * protects typing to Claude is declared once, in the map, and read here and by
 * xterm's pass-through alike. `conflictBehavior: 'error'` is about a different
 * conflict than the user's: two call sites claiming one chord is a programming
 * mistake, and it should be loud rather than a console warning (ADR-0046).
 */
export function useShortcuts(handlers: ShortcutHandlers, options: ShortcutOptions = {}): void {
	const keymap = useKeymap();
	const mac = isMacOS();
	const { target, enabled } = options;
	// Nothing fires while the settings section is capturing a chord: the
	// recorder needs the raw keystroke, and `Mod+W` on its way into a row must
	// not close the tab behind the modal.
	const recording = useRecordingStore((s) => s.active);

	// The handlers object is a fresh literal at every call site on every render.
	// Rebuilding the definitions from it would re-register the lot each time, so
	// the callbacks go through a ref and the list is rebuilt only when the
	// bindings or the set of claimed actions actually change.
	const handlersRef = useRef(handlers);
	handlersRef.current = handlers;
	const claimed = Object.keys(handlers).sort().join(',');

	const definitions = useMemo<UseHotkeyDefinition[]>(() => {
		const owned = new Set(claimed.split(','));
		const defs: UseHotkeyDefinition[] = [];
		for (const spec of SHORTCUT_SPECS) {
			if (!owned.has(spec.action)) continue;
			// macOS takes Quit from the app menu, before the webview sees the key.
			if (spec.linuxOnly === true && mac) continue;
			const hotkey = keymap[spec.action];
			if (!hotkey) continue;
			defs.push({
				hotkey,
				callback: () => handlersRef.current[spec.action]?.(),
				options: { ignoreInputs: !spec.overTerminal },
			});
		}
		return defs;
	}, [claimed, keymap, mac]);

	useHotkeys(definitions, {
		conflictBehavior: 'error',
		...(target ? { target } : {}),
		enabled: enabled !== false && !recording,
	});
}

/**
 * A control's tooltip with its chord appended — "Settings (⌘,)".
 *
 * Reads the same map the binding does, so a rebind shows up on the button at
 * once. It is also how anybody finds out the key exists: nobody opens settings
 * to learn a shortcut is there. An unbound action gets the plain title back,
 * with no empty brackets.
 */
export function useChordTitle(title: string, action: ShortcutAction): string {
	const keymap = useKeymap();
	const mac = isMacOS();
	const hotkey = keymap[action];
	if (!hotkey) return title;
	return `${title} (${formatForDisplay(hotkey, { platform: mac ? 'mac' : 'linux' })})`;
}
