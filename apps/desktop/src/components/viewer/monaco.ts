/**
 * Monaco setup, isolated so the rest of the app never imports Monaco directly
 * (ADR-0007). Everything here is pulled in through the lazy viewer chunk.
 *
 * Five import choices, each one deliberate:
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
 * - **The find widget is a *contribution*, and contributions are opt-in.** This
 *   is the same trap JSON fell into, one level up: `editor.api` registers the
 *   editor and its API and *no* contributions, so `Cmd/Ctrl+F` did nothing at
 *   all until the import below was added — for a year F7 and ADR-0007 both said
 *   otherwise. `features/find/register` is the entry point to use rather than
 *   `contrib/find/browser/findController` directly: it registers the same
 *   contribution and carries an upstream patch that takes the widget's controls
 *   out of the tab order while it is hidden. Every service the controller asks
 *   for — hover, clipboard, quick input, storage, accessibility — is already
 *   registered by `standaloneServices`, so unlike JSON's full mode this one
 *   costs nothing but its own weight.
 * - **The widget needs its icon font, and that is a second import.**
 *   `features/codicon/register` is CSS only — the `@font-face` for
 *   `codicon.ttf` and one class per glyph. Without it the find widget draws
 *   and works, and every one of its buttons is a tofu box: the glyphs are
 *   private-use codepoints, so a missing font is not a missing icon, it is
 *   nine identical rectangles. Anything else that grows a Monaco widget wants
 *   this too, which is why it sits beside the API import rather than inside
 *   the find block.
 * - No `@monaco-editor/react`: it loads Monaco from a CDN by default, which is
 *   a non-starter in a webview with no network. Pointing it at the local
 *   package is about as much code as calling the API directly.
 */

// Paths look short because monaco's exports map is `"./*": "./esm/vs/*.js"` —
// `monaco-editor/editor/editor.api` resolves to esm/vs/editor/editor.api.js.
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/basic-languages/monaco.contribution';
import 'monaco-editor/features/find/register';
// The icon font every Monaco widget draws its glyphs from. `editor.api` does
// not carry it, so the find widget's buttons rendered as the tofu boxes a
// private-use codepoint gets with no font behind it (found in the real window,
// 2026-09-09). CSS-only: an `@font-face` plus one class per glyph.
import 'monaco-editor/features/codicon/register';
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

			// **The find widget, restated in the app's palette** (DESIGN.md §
			// Colors). Unthemed it is vs-dark's: a `#313131` slab with a
			// `#0078d4` focus ring and orange matches, which is another
			// product's chrome sitting in the middle of ours. Colours only —
			// these are documented theme keys, where the widget's internal
			// class names are not API, so its geometry stays Monaco's (see
			// DESIGN.md § Inputs).
			//
			// The ladder is the one the editor colours above already use:
			// `#14171c` ground, `#1a1e24` a surface over it, `#23272e` and
			// `#2b3038` the two hairline steps, `#8b919c` metadata,
			// `#d4d4d8` text.
			'editorWidget.background': '#1a1e24',
			'editorWidget.foreground': '#d4d4d8',
			'editorWidget.border': '#2b3038',
			'editorWidget.resizeBorder': '#2b3038',
			// A surface that appears over the app and will be dismissed gets a
			// shadow and no tonal step of its own — The Flat-By-Default Rule.
			'widget.shadow': '#00000059',
			// App-ground fill, hairline border, amber ring on focus: the field
			// rule every input in the app follows.
			'input.background': '#14171c',
			'input.foreground': '#d4d4d8',
			'input.border': '#2b3038',
			focusBorder: '#ffb020',
			// Aa / ab / .* pressed. Amber at 16% behind, the hue itself as
			// text — the chip treatment, which is what these toggles are.
			'inputOption.activeBackground': '#ffb02029',
			'inputOption.activeForeground': '#ffb020',
			'inputOption.activeBorder': '#ffb02066',
			// "No results", which Monaco renders as input validation.
			'inputValidation.errorBackground': '#2a1418',
			'inputValidation.errorBorder': '#df202e',
			'inputValidation.errorForeground': '#f0f2f4',
			errorForeground: '#df202e',
			// The current match carries the accent at full strength with the
			// hue as its border; every other match is the same tint at 16%, so
			// "where I am" and "where else it is" are one colour at two weights
			// and the syntax underneath still reads through both.
			'editor.findMatchBackground': '#ffb02057',
			'editor.findMatchBorder': '#ffb020',
			'editor.findMatchHighlightBackground': '#ffb02029',
			'editor.findMatchHighlightBorder': '#ffb0204d',
			// Find-in-selection dims everything outside the scope rather than
			// tinting the scope amber, which would compete with the matches.
			'editor.findRangeHighlightBackground': '#8b919c1a',
			'editorOverviewRuler.findMatchForeground': '#ffb020b3',
			'toolbar.hoverBackground': '#23272e',
			'icon.foreground': '#8b919c',
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

/**
 * The find controller, structurally.
 *
 * `FindController` is a contribution rather than exported API, so there is no
 * type to import. Its **id and `getState()` are stable** — the id is what
 * `getContribution` takes and what every VS Code keybinding refers to — while
 * the class is not, so this describes only the three members used below rather
 * than casting the contribution to something it might not be.
 */
interface FindController extends monaco.editor.IEditorContribution {
	getState(): {
		readonly isRevealed: boolean;
		readonly searchString: string;
		/** `moveCursor` false: restoring a search must not move the caret the
		 *  view state just put back. */
		change(values: { searchString: string }, moveCursor: boolean): void;
	};
}

const FIND_CONTROLLER = 'editor.contrib.findController';
/** Monaco's own id for the action `Cmd/Ctrl+F` is bound to. */
const FIND_ACTION = 'actions.find';

/** What the find widget was showing, or null when it was closed.
 *
 *  Only the query: the toggles ride Monaco's own storage service, which is why
 *  `Aa` stays pressed across a new editor without anything here. */
export interface FindState {
	searchString: string;
}

/**
 * Open the find widget and focus its input, from outside the editor.
 *
 * The keybinding Monaco registers only fires when the editor has focus, and the
 * viewer has a tab strip and a header above it — see `ViewerPane`, which
 * forwards the key so it means the same thing anywhere in the pane.
 */
export function openFind(editor: monaco.editor.ICodeEditor): void {
	void editor.getAction(FIND_ACTION)?.run();
}

/** True while the find widget is on screen. What the expand modal asks before
 *  deciding whether `Escape` is the widget's or its own. */
export function findIsRevealed(editor: monaco.editor.ICodeEditor): boolean {
	return editor.getContribution<FindController>(FIND_CONTROLLER)?.getState().isRevealed ?? false;
}

/** The search to hand to the next editor, or null if none was open. */
export function saveFindState(editor: monaco.editor.ICodeEditor): FindState | null {
	const state = editor.getContribution<FindController>(FIND_CONTROLLER)?.getState();
	return state?.isRevealed ? { searchString: state.searchString } : null;
}

/**
 * Put a saved search back, on an editor that has just been created.
 *
 * **Monaco's own view state does not carry this.** `FindController` contributes
 * `saveViewState`, but what it saves is the widget's view zone geometry — not
 * whether the widget is open, and not the query. So an agent saving the file
 * you were searching would take the search away with the editor, which is the
 * same fault F7 fixed for scroll and selection.
 *
 * The query is set *after* the action, not before: `_start` seeds the field from
 * the selection, and the restored view state has a selection in it.
 */
export async function restoreFindState(
	editor: monaco.editor.ICodeEditor,
	state: FindState | null,
): Promise<void> {
	if (!state) return;
	await editor.getAction(FIND_ACTION)?.run();
	// The editor can be disposed while that await is in flight — a second save
	// landing on the file is exactly the case this restore exists for. A
	// disposed editor has no model.
	if (!editor.getModel()) return;
	editor
		.getContribution<FindController>(FIND_CONTROLLER)
		?.getState()
		.change({ searchString: state.searchString }, false);
}
