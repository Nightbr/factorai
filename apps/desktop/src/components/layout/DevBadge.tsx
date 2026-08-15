/**
 * Marks the window as a development build.
 *
 * A release factorai sits open all day beside the dev one — it is where the
 * agents building this app actually run — and the two are otherwise identical
 * on screen. Getting that wrong costs a live Claude session, so the marker is
 * loud (violet, the one hue the palette reserves for nothing else) rather than
 * tasteful.
 *
 * It renders nothing in a bundled build: `pnpm tauri build` puts the renderer
 * through `vite:build`, where `import.meta.env.DEV` is false. `pnpm dev` and
 * browser-only `pnpm vite:dev` both show it.
 *
 * The window title carries the same marker (`src-tauri/src/lib.rs`), so the
 * two are also distinguishable from the window switcher, where the header
 * isn't visible.
 */
export function DevBadge() {
	if (!import.meta.env.DEV) return null;

	return (
		<span
			data-testid="dev-badge"
			title="Development build — not your installed factorai"
			// Padding is asymmetric on purpose: the tracking adds a space after
			// the V that the left edge has no counterpart for, so the right side
			// gives that width back.
			className="rounded-sm bg-dev py-px pr-1 pl-1.5 font-bold font-mono text-[10px] text-dev-foreground uppercase leading-none tracking-widest"
		>
			dev
		</span>
	);
}
