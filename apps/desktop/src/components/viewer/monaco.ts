/**
 * Monaco setup, isolated so the rest of the app never imports Monaco directly
 * (ADR-0007). Everything here is pulled in through the lazy viewer chunk.
 *
 * Two deliberate import choices:
 *
 * - `editor.api` + `basic-languages/monaco.contribution` rather than
 *   `editor.main`. That gives every Monarch grammar (~80 languages) for
 *   highlighting with **no web worker requirement**. The workers exist for the
 *   TS / JSON / CSS / HTML *language services* — IntelliSense, which a
 *   read-only viewer has no use for. `editor.worker` arrives with F8's diff
 *   editor, which needs it to compute diffs.
 * - No `@monaco-editor/react`: it loads Monaco from a CDN by default, which is
 *   a non-starter in a webview with no network. Pointing it at the local
 *   package is about as much code as calling the API directly.
 */

// Paths look short because monaco's exports map is `"./*": "./esm/vs/*.js"` —
// `monaco-editor/editor/editor.api` resolves to esm/vs/editor/editor.api.js.
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/basic-languages/monaco.contribution';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';

// The diff editor (F8/F13) computes its diff in a worker and throws without
// one — this is the wiring the plain file viewer deliberately shipped without.
// Vite's `?worker` import bundles it locally: no CDN, which a webview with no
// network requires. Only `editor.worker` is registered; the TS/JSON/CSS
// language-service workers stay out, since a read-only viewer has no use for
// IntelliSense.
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

export { monaco };

/** Matches the app's `--card` / `--foreground` so the editor doesn't sit in the
 *  modal as a differently-coloured slab. Monaco wants hex, not oklch. */
export const FACTORAI_DARK = 'factorai-dark';

let themeDefined = false;

export function ensureTheme(): void {
	if (themeDefined) return;
	themeDefined = true;
	monaco.editor.defineTheme(FACTORAI_DARK, {
		base: 'vs-dark',
		inherit: true,
		rules: [],
		colors: {
			'editor.background': '#14171c',
			'editor.foreground': '#d4d4d8',
			'editorLineNumber.foreground': '#4a4f58',
			'editorLineNumber.activeForeground': '#8b919c',
			'editor.selectionBackground': '#2b3038',
			'editor.lineHighlightBackground': '#1a1e24',
			'editorIndentGuide.background1': '#23272e',
		},
	});
}

/**
 * Monaco language id for a file name, resolved through Monaco's **own**
 * registry rather than a second hand-written extension table next to
 * `lib/fileIcon.ts`. Falls back to `plaintext`.
 */
export function languageForFile(fileName: string): string {
	const name = fileName.toLowerCase();
	const dot = name.lastIndexOf('.');
	const ext = dot > 0 ? name.slice(dot) : '';

	for (const lang of monaco.languages.getLanguages()) {
		if (ext && lang.extensions?.some((e) => e.toLowerCase() === ext)) return lang.id;
		// Extensionless files Monaco knows by name (Dockerfile, Makefile).
		if (lang.filenames?.some((f) => f.toLowerCase() === name)) return lang.id;
	}
	return 'plaintext';
}

/** Human label for the footer — Monaco's own alias, e.g. `rust` → `Rust`. */
export function languageLabel(languageId: string): string {
	const lang = monaco.languages.getLanguages().find((l) => l.id === languageId);
	return lang?.aliases?.[0] ?? languageId;
}
