import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import Icons from 'unplugin-icons/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	// `Icons` compiles the `~icons/<collection>/<name>` imports in
	// lib/fileIcon.ts into React components at build time (ADR-0006). Only the
	// icons we import statically end up in the bundle — nothing is fetched at
	// runtime, which a Tauri app with no network access requires.
	plugins: [tailwindcss(), react(), Icons({ compiler: 'jsx', jsx: 'react' })],
	clearScreen: false,
	optimizeDeps: {
		// Monaco arrives through a lazy chunk, so Vite would only discover it the
		// first time a file is opened — then prebundle and reload the page
		// mid-interaction. Listing it here gets that work done at server start.
		include: [
			'monaco-editor/editor/editor.api',
			'monaco-editor/basic-languages/monaco.contribution',
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
