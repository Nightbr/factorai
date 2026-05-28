import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
		clearMocks: true,
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
