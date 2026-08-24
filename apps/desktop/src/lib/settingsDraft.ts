import type { Prefs } from '@store/prefsStore';

/**
 * The settings modal's draft, and what is different about it (F11).
 *
 * Pure on purpose. An explicit Save makes two things load-bearing — the button
 * is the unsaved-changes indicator, and a dot marks which nav section holds an
 * edit — and both are answers to "how does this draft differ from what is
 * saved". That question is worth pinning in vitest rather than discovering in a
 * browser, so the modal keeps the state and this file does the thinking.
 */

/** The nav, in order. Appearance (theme) and Advanced (release channel) are
 *  deliberately absent until they have content: an empty section reads as a
 *  bug. */
export const SETTINGS_SECTIONS = ['claude', 'editor', 'confirmations', 'sessions'] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** Validates `?settings=`, so a hand-edited URL cannot open a section that
 *  doesn't exist — the same rule `?file=`'s `diff` mode follows. */
export function isSettingsSection(value: unknown): value is SettingsSection {
	return typeof value === 'string' && SETTINGS_SECTIONS.includes(value as SettingsSection);
}

/**
 * Everything the modal edits: the renderer's preferences plus the one value
 * that lives in SQLite because Rust reads it.
 *
 * `claudeBinary` is the text field verbatim, empty for "no override" — see
 * `binaryOverride` for why empty is not the same as a value.
 */
export interface SettingsValues extends Prefs {
	claudeBinary: string;
}

/** Which section each value belongs to. A `Record` over the keys rather than a
 *  list per section, so a preference added to `SettingsValues` and not placed
 *  in a section is a type error rather than a row nobody can find. */
export const SECTION_FOR: Record<keyof SettingsValues, SettingsSection> = {
	claudeBinary: 'claude',
	diffInline: 'editor',
	frontmatterOpen: 'editor',
	confirmCloseSession: 'confirmations',
	confirmCloseMiddleClick: 'confirmations',
	restoreTabs: 'sessions',
};

/**
 * What the override field means once the whitespace is taken off: a path, or
 * `null` for "keep probing".
 *
 * **`null` rather than `''`**, because that is the distinction `set_setting`
 * turns into a deleted row. An empty string would be a *set* value that happens
 * to be empty, and the three-tier probe would never run again.
 */
export function binaryOverride(text: string): string | null {
	const trimmed = text.trim();
	return trimmed === '' ? null : trimmed;
}

/**
 * The sections holding an edit, in nav order.
 *
 * The override is compared **normalised**, so trailing whitespace in a text
 * field is not a change — otherwise a cursor left in the wrong place enables
 * Save and writes a path with a space on the end.
 */
export function dirtySections(
	saved: SettingsValues,
	draft: SettingsValues,
): readonly SettingsSection[] {
	const dirty = new Set<SettingsSection>();
	for (const key of Object.keys(SECTION_FOR) as (keyof SettingsValues)[]) {
		if (!sameValue(saved, draft, key)) dirty.add(SECTION_FOR[key]);
	}
	return SETTINGS_SECTIONS.filter((section) => dirty.has(section));
}

/** Anything at all changed — what enables Save, and what makes click-outside
 *  refuse to dismiss. */
export function isDirty(saved: SettingsValues, draft: SettingsValues): boolean {
	return dirtySections(saved, draft).length > 0;
}

function sameValue(
	saved: SettingsValues,
	draft: SettingsValues,
	key: keyof SettingsValues,
): boolean {
	if (key === 'claudeBinary') {
		return binaryOverride(saved.claudeBinary) === binaryOverride(draft.claudeBinary);
	}
	return saved[key] === draft[key];
}
