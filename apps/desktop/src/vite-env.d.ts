/// <reference types="vite/client" />
/// <reference types="unplugin-icons/types/react" />

declare module '*.css';

/** The app version, stamped in by Vite's `define` from package.json. Used by
 *  the crash screen; see vite.config.ts. */
declare const __APP_VERSION__: string;

/**
 * JSON's standalone tokenizer. monaco-editor ships a `.d.ts` only for the
 * feature's `register` entry point, not for this module — and `register` is
 * the one thing we must not import (see components/viewer/monaco.ts). Typing
 * it here is the alternative to an `as any` at the call site.
 *
 * `monaco-editor` is pinned exactly, so if this internal path moves, the build
 * fails rather than silently losing JSON highlighting.
 */
declare module 'monaco-editor/languages/features/json/tokenization' {
	// An inline `import type` rather than an import statement: biome reads the
	// latter as unused inside an ambient module declaration, and the rule is not
	// one to silence with an ignore comment.
	export function createTokenizationSupport(
		supportComments: boolean,
	): import('monaco-editor/editor/editor.api').languages.TokensProvider;
}
