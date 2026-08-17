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
 * - **JSON is the one exception, and it is registered by hand below.** `json`
 *   is the only common language with *no* entry in `basic-languages` — css,
 *   html, javascript and typescript all register a Monarch grammar there, but
 *   JSON ships solely as a language *service*. With only the basic set
 *   imported, `.json` was absent from Monaco's registry entirely,
 *   `languageForFile` fell through to `plaintext`, and every JSON file
 *   rendered unhighlighted with `Plain Text` in the footer.
 * - No `@monaco-editor/react`: it loads Monaco from a CDN by default, which is
 *   a non-starter in a webview with no network. Pointing it at the local
 *   package is about as much code as calling the API directly.
 */

// Paths look short because monaco's exports map is `"./*": "./esm/vs/*.js"` —
// `monaco-editor/editor/editor.api` resolves to esm/vs/editor/editor.api.js.
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/basic-languages/monaco.contribution';
// Only the *tokenizer* from JSON's language feature — see registerJson below
// for why not the whole thing. Untyped upstream; declared in src/vite-env.d.ts.
import { createTokenizationSupport } from 'monaco-editor/languages/features/json/tokenization';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';

// The diff editor (F8/F13) computes its diff in a worker and throws without
// one — this is the wiring the plain file viewer deliberately shipped without.
// Vite's `?worker` import bundles it locally: no CDN, which a webview with no
// network requires. Still only `editor.worker`: nothing here runs a language
// service, so no service worker is ever asked for.
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

/**
 * Register `json` — the language `basic-languages` leaves out.
 *
 * **The obvious route does not work, and the failure is loud.** Importing
 * `languages/features/json/register` registers the language *and* installs the
 * full mode, whose `jsonMode.js` statically imports the code-action, hover and
 * completion providers. Those pull editor contributions that `editor.api` does
 * not carry services for, and the viewer dies on open with
 * `[createInstance] CodeActionController depends on UNKNOWN service
 * actionWidgetService`. Switching the features off through
 * `setModeConfiguration` does **not** help: ESM imports are static, so the
 * modules load whether or not their providers are used. (Found by opening a
 * `.json` file in the dev app — typecheck and the smoke suite were both green.)
 *
 * So take the one piece that is free of the editor's DI graph. `tokenization`
 * imports nothing but `jsonc-parser` and returns a plain `TokensProvider`,
 * which is precisely and only the syntax highlighting we wanted. No worker, no
 * IntelliSense, no squiggles on a file the reader cannot edit anyway.
 *
 * `supportComments: true` so `.jsonc` — and a `tsconfig` with comments in it —
 * tokenises its comments as comments rather than as errors.
 */
function registerJson(): void {
	monaco.languages.register({
		id: 'json',
		// Monaco's own list, plus the two dialects it omits — `.jsonc` is what
		// this repo's `knip.jsonc` is, and both are JSON as far as the eye is
		// concerned. Registering them here rather than in a lookup table beside
		// `languageForFile` keeps one source of truth: Monaco's registry.
		extensions: [
			'.json',
			'.jsonc',
			'.json5',
			'.bowerrc',
			'.jshintrc',
			'.jscsrc',
			'.eslintrc',
			'.babelrc',
			'.har',
		],
		aliases: ['JSON', 'json'],
		mimetypes: ['application/json'],
	});
	monaco.languages.setTokensProvider('json', createTokenizationSupport(true));
}

registerJson();

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
