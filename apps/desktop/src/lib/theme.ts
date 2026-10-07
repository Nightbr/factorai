/**
 * The app theme: which palette is on screen, and who repaints when it moves
 * (specs/04-frontend.md § Theming, roadmap item 32 (#28)).
 *
 * **The CSS already knows both themes.** `@factorai/ui`'s stylesheet holds the
 * dark palette on `:root` and the light one on `[data-theme="light"]`, so for
 * everything Tailwind draws, theming is one attribute on `<html>`. This module
 * writes that attribute.
 *
 * **Three things cannot read CSS, and they listen here instead**: Monaco wants a
 * named theme of hex values, xterm wants an options object, and both keep what
 * they were handed until they are told otherwise. Mermaid needs nothing from
 * this module — it watches `data-theme` itself (`viewer/mermaid.ts`).
 */

/** What the human chose in Settings → Appearance. */
export type ThemePref = 'system' | 'light' | 'dark';
/** What is on screen: `system` resolved against the OS appearance. */
export type Theme = 'light' | 'dark';

export const THEME_PREFS: readonly { id: ThemePref; label: string }[] = [
	{ id: 'system', label: 'System' },
	{ id: 'light', label: 'Light' },
	{ id: 'dark', label: 'Dark' },
];

/** A stored or selected value narrowed to a preference. Anything unknown is
 *  `system`, which is also the default: a value from a newer build, read by an
 *  older one, follows the OS rather than picking a side. */
export function themePrefOf(value: unknown): ThemePref {
	return value === 'light' || value === 'dark' ? value : 'system';
}

export function resolveTheme(pref: ThemePref, systemDark: boolean): Theme {
	if (pref === 'system') return systemDark ? 'dark' : 'light';
	return pref;
}

/** The slice of `MediaQueryList` used here, so a test can stand one in. */
export interface ThemeMedia {
	readonly matches: boolean;
	addEventListener(type: 'change', listener: () => void): void;
	removeEventListener(type: 'change', listener: () => void): void;
}

interface ThemeDeps {
	getPref: () => ThemePref;
	/** Called on every preference write; the handler re-reads `getPref`. */
	subscribePref: (listener: () => void) => () => void;
	/** `prefers-color-scheme: dark`. */
	media: ThemeMedia;
	root: { setAttribute(name: string, value: string): void };
}

export interface ThemeHandle {
	current(): Theme;
	/** Called with the new theme whenever the palette on screen changes — and
	 *  only then: a preference change that resolves to the same theme repaints
	 *  nothing. */
	onChange(listener: (theme: Theme) => void): () => void;
}

/**
 * Module state rather than state inside `installTheme`, because **imports run
 * first**: `Terminal.tsx` subscribes when it is evaluated, which is before the
 * body of `main.tsx` installs anything. A listener added then must still hear
 * the changes that come after.
 *
 * Dark until installed — in a unit test, or for a module evaluated ahead of
 * `main.tsx` — which is what the CSS shows with no attribute.
 */
const listeners = new Set<(theme: Theme) => void>();
let theme: Theme = 'dark';

/** The theme on screen now. */
export function currentTheme(): Theme {
	return theme;
}

/** Subscribe to palette changes; returns the unsubscribe. */
export function onThemeChange(listener: (theme: Theme) => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/**
 * Apply the theme and keep it applied.
 *
 * Called from `main.tsx` **before the first render**: `prefsStore` hydrates
 * synchronously from localStorage, so the attribute is on `<html>` before React
 * paints anything, and a light-theme user never sees one frame of dark.
 */
export function installTheme(deps: ThemeDeps): ThemeHandle {
	const apply = (next: Theme, notify: boolean) => {
		const changed = next !== theme;
		theme = next;
		deps.root.setAttribute('data-theme', theme);
		if (notify && changed) for (const listener of listeners) listener(theme);
	};
	apply(resolveTheme(deps.getPref(), deps.media.matches), true);

	const update = () => apply(resolveTheme(deps.getPref(), deps.media.matches), true);
	// Both are app-lifetime: the media query and the store outlive every
	// component, so neither is ever removed.
	deps.media.addEventListener('change', update);
	deps.subscribePref(update);

	return { current: currentTheme, onChange: onThemeChange };
}
