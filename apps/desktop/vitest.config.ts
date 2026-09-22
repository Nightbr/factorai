import { resolve } from 'node:path';
import Icons from 'unplugin-icons/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	// The same compiler `vite.config.ts` runs, so a test that imports a component
	// drawing a `~icons/<collection>/<name>` mark — `AgentMark` under the sidebar
	// (F30) — resolves it instead of failing to load the whole file.
	plugins: [Icons({ compiler: 'jsx', jsx: 'react' })],
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
		clearMocks: true,
	},
	// `lib/buildInfo.ts` falls back to the version define when there is no
	// release metadata (F29), which is the branch a test machine takes — and a
	// define that only exists in `vite.config.ts` is a `ReferenceError` here.
	// The placeholder rather than the real value: a unit test asserting a
	// version string would fail on the day someone tags a release.
	define: {
		__APP_VERSION__: JSON.stringify('0.0.0-test'),
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
