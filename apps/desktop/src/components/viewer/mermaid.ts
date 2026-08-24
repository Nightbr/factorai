import {
	type DiagramPalette,
	diagramPalette,
	mermaidThemeVariables,
} from '@components/viewer/mermaidTheme';

/**
 * The one place mermaid is loaded and configured (ADR-0021).
 *
 * Mermaid is ~2.5MB of grammars and layout engines — larger than Monaco — and
 * the overwhelming majority of markdown files carry no diagram at all. So it
 * lives behind a dynamic `import()` that runs only when a document actually
 * has a mermaid fence in it, one level lazier than the viewer's own chunk.
 * See `MermaidDiagram`.
 */

type MermaidApi = typeof import('mermaid').default;

let loading: Promise<MermaidApi> | null = null;
/** The palette the loaded instance was configured with, so a theme change is
 *  noticed without re-importing the module. */
let configuredFor: string | null = null;

function paletteKey(palette: DiagramPalette, fontFamily: string): string {
	return `${JSON.stringify(palette)}|${fontFamily}`;
}

/** Read a CSS custom property off `<html>`. Empty string when unset. */
function rootToken(name: string): string {
	return getComputedStyle(document.documentElement).getPropertyValue(name);
}

function currentFontFamily(): string {
	return getComputedStyle(document.body).fontFamily || 'Inter, system-ui, sans-serif';
}

/**
 * Load mermaid, configured against the current palette.
 *
 * Configuration is re-applied whenever the palette has moved rather than only
 * once: `mermaid.initialize` is idempotent and cheap, and the alternative is a
 * theme switch (roadmap item 32) leaving the next diagram drawn for the old
 * one.
 */
export async function loadMermaid(): Promise<MermaidApi> {
	if (!loading) {
		loading = import('mermaid').then((m) => m.default);
	}
	const mermaid = await loading;

	const palette = diagramPalette(rootToken);
	const fontFamily = currentFontFamily();
	const key = paletteKey(palette, fontFamily);
	if (key !== configuredFor) {
		mermaid.initialize({
			// Nothing on the page is a `<div class="mermaid">` for mermaid to find
			// by itself — every diagram is rendered explicitly, into a node React
			// owns.
			startOnLoad: false,
			// The default, kept deliberately: labels are sanitised and a `click`
			// directive that would run script or navigate is inert. The same stance
			// F7 already takes by not adding `rehype-raw` — a document in the
			// repository the reader opened is not trusted input.
			securityLevel: 'strict',
			// Mermaid's own error diagram is a bomb glyph appended into the DOM,
			// with nothing to say which fence produced it. Off, so `render` throws
			// and cleans up after itself and the failure is reported beside the
			// source that caused it.
			suppressErrorRendering: true,
			theme: 'base',
			themeVariables: mermaidThemeVariables(palette, fontFamily),
			// Let the SVG shrink to the column rather than carrying the pixel width
			// its layout happened to come out at.
			flowchart: { useMaxWidth: true },
			sequence: { useMaxWidth: true },
			gantt: { useMaxWidth: true },
		});
		configuredFor = key;
	}
	return mermaid;
}
