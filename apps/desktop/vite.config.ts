import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import Icons from 'unplugin-icons/vite';
import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };
import { pdfjsAssets } from './vite/pdfjsAssets';

// Stamped into the bundle so the crash screen can name the build it came from
// (components/layout/ErrorBoundary.tsx). A build-time constant rather than a
// `getVersion()` call because the crash path must not depend on the Tauri
// bridge still working. Declared in src/vite-env.d.ts.
//
// **The version in this repo is deliberately never bumped.** The tag is the
// only source of truth: `release.yml`'s "Set version from tag" rewrites
// `package.json` before `beforeBuildCommand` runs, so a release build reads the
// real version here. Which means the untouched placeholder is precisely the
// signal for "nobody tagged this" — so say so, rather than letting every dev
// crash report claim to be 0.1.0.
const PLACEHOLDER = '0.1.0';
const APP_VERSION =
	pkg.version === PLACEHOLDER ? `${PLACEHOLDER} (untagged dev build)` : pkg.version;

export default defineConfig({
	define: {
		__APP_VERSION__: JSON.stringify(APP_VERSION),
	},
	// `Icons` compiles the `~icons/<collection>/<name>` imports in
	// lib/fileIcon.ts into React components at build time (ADR-0006). Only the
	// icons we import statically end up in the bundle — nothing is fetched at
	// runtime, which a Tauri app with no network access requires.
	// `pdfjsAssets` stages pdf.js's fonts, CMaps and WASM decoders into
	// `public/pdfjs/` — see that file for why they can't be left in
	// node_modules (ADR-0018).
	plugins: [tailwindcss(), react(), Icons({ compiler: 'jsx', jsx: 'react' }), pdfjsAssets()],
	clearScreen: false,
	optimizeDeps: {
		// Monaco arrives through a lazy chunk, so Vite would only discover it the
		// first time a file is opened — then prebundle and reload the page
		// mid-interaction. Listing it here gets that work done at server start.
		include: [
			'monaco-editor/editor/editor.api',
			'monaco-editor/basic-languages/monaco.contribution',
			// JSON's tokenizer, which the basic set leaves out — see the note in
			// components/viewer/monaco.ts. Same prebundle reasoning as the two
			// above: discovered lazily, it would reload the page the first time
			// someone opened a .json file.
			'monaco-editor/languages/features/json/tokenization',
			// pdf.js arrives through a lazier chunk still — only when a PDF is
			// opened — so it would otherwise prebundle and reload the page at
			// exactly that moment. Same reasoning as Monaco's three above.
			'pdfjs-dist',
		],
	},
	server: {
		port: 1420,
		strictPort: true,
		watch: {
			ignored: ['**/src-tauri/**'],
		},
	},
	resolve: {
		alias: {
			'@': resolve(__dirname, './src'),
			'@components': resolve(__dirname, './src/components'),
			'@hooks': resolve(__dirname, './src/hooks'),
			'@lib': resolve(__dirname, './src/lib'),
			'@store': resolve(__dirname, './src/store'),
			'@routes': resolve(__dirname, './src/routes'),
		},
	},
});
