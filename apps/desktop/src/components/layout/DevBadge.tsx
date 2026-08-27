import { CHIP_SHAPE } from '@lib/gitGraph';

/**
 * Marks the window as a development build.
 *
 * A release factorai sits open all day beside the dev one — it is where the
 * agents building this app actually run — and the two are otherwise identical
 * on screen. Getting that wrong costs a live Claude session, so the marker is
 * violet, the one hue the palette reserves for nothing else.
 *
 * **It is a chip, not a sticker** (changed 2026-08-19 on user feedback). It was
 * a solid violet block of bold 10px mono with widened tracking — loud, but loud
 * in a vocabulary nothing else in the app speaks, so it read as a debug
 * artefact rather than as part of the header. It now borrows F18's ref chips
 * exactly: `CHIP_SHAPE` for the border, radius, padding and 12px text, and the
 * same `border-X/30 bg-X/12 text-X` tint the graph gives a branch, with `--dev`
 * as the X. Same shape as every other chip in the app, one hue nothing else
 * uses — which is the loudness that was actually doing the work.
 *
 * The caps stayed, in the app's usual `uppercase tracking-wider` voice for a
 * status mark (`PROJECTS`, the changes headers). A chip's label is normally a
 * name — a branch, a tag — and lower-case `dev` read as one. `DEV` is also what
 * the window title says, and the two markers are worth spelling identically.
 *
 * `CHIP_SHAPE` is imported rather than copied for the reason its own comment
 * gives: a chip that picks its own geometry is a chip that drifts.
 *
 * It renders nothing in a bundled build: `pnpm tauri build` puts the renderer
 * through `vite:build`, where `import.meta.env.DEV` is false. `pnpm dev` and
 * browser-only `pnpm vite:dev` both show it.
 *
 * The window title carries the same marker (`src-tauri/src/lib.rs`), so the
 * two are also distinguishable from the window switcher, where the header
 * isn't visible.
 *
 * **`VITE_FACTORAI_SCREENSHOT=1` hides it**, and that is the only thing the flag
 * does. Documentation images are taken from a dev build against real projects —
 * a release build has no `~/.claude` history worth photographing beyond the
 * author's own — so the badge would appear in every README shot while being
 * absent from the product a reader downloads. Hiding it makes the picture more
 * accurate, not less.
 *
 * The flag is deliberately narrow. It does **not** touch the window title, so a
 * dev window is still identifiable in the switcher — which is where the mistake
 * this badge exists to prevent actually happens. Leaving it set costs a marker
 * in a header, not the safety property.
 */
export function DevBadge() {
	if (!import.meta.env.DEV) return null;
	if (import.meta.env.VITE_FACTORAI_SCREENSHOT) return null;

	return (
		<span
			data-testid="dev-badge"
			title="Development build — not your installed factorai"
			className={`${CHIP_SHAPE} shrink-0 border-dev/30 bg-dev/12 text-dev uppercase tracking-wider`}
		>
			dev
		</span>
	);
}
