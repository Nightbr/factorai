import { describe, expect, it } from 'vitest';
import { ICON_KEYS, iconKeyFor } from './fileIcon';

describe('iconKeyFor', () => {
	it('maps common extensions', () => {
		expect(iconKeyFor('main.rs')).toBe('rust');
		expect(iconKeyFor('app.tsx')).toBe('reactts');
		expect(iconKeyFor('index.ts')).toBe('typescript');
		expect(iconKeyFor('setup.py')).toBe('python');
		expect(iconKeyFor('notes.md')).toBe('markdown');
		expect(iconKeyFor('data.yml')).toBe('yaml');
	});

	it('is case-insensitive', () => {
		expect(iconKeyFor('README.MD')).toBe('markdown');
		expect(iconKeyFor('Main.RS')).toBe('rust');
	});

	it('prefers an exact filename over its extension', () => {
		// Cargo.toml is a crate manifest first, TOML second.
		expect(iconKeyFor('Cargo.toml')).toBe('cargo');
		expect(iconKeyFor('other.toml')).toBe('toml');
		expect(iconKeyFor('pyproject.toml')).toBe('pythonconfig');
		expect(iconKeyFor('package.json')).toBe('npm');
		expect(iconKeyFor('tsconfig.json')).toBe('tsconfig');
		expect(iconKeyFor('settings.json')).toBe('json');
		expect(iconKeyFor('conftest.py')).toBe('pytest');
	});

	it('handles extensionless names', () => {
		expect(iconKeyFor('Dockerfile')).toBe('docker');
		expect(iconKeyFor('LICENSE')).toBe('license');
		expect(iconKeyFor('Makefile')).toBe('default');
	});

	it('treats a leading dot as part of the name', () => {
		expect(iconKeyFor('.gitignore')).toBe('git');
		expect(iconKeyFor('.dockerignore')).toBe('docker');
		expect(iconKeyFor('.editorconfig')).toBe('editorconfig');
		// `.foo` has no extension to key on, so it falls back.
		expect(iconKeyFor('.mysteryrc')).toBe('default');
	});

	it('recognises env files with a suffix', () => {
		expect(iconKeyFor('.env')).toBe('dotenv');
		expect(iconKeyFor('.env.local')).toBe('dotenv');
		expect(iconKeyFor('.env.production')).toBe('dotenv');
	});

	it('resolves tool config files by their tool', () => {
		expect(iconKeyFor('vite.config.ts')).toBe('vite');
		expect(iconKeyFor('vitest.config.ts')).toBe('vite');
		expect(iconKeyFor('babel.config.js')).toBe('babel');
		// An unknown tool keeps the language icon rather than guessing.
		expect(iconKeyFor('tailwind.config.ts')).toBe('typescript');
	});

	it('maps lockfiles to their package manager', () => {
		expect(iconKeyFor('pnpm-lock.yaml')).toBe('pnpm');
		expect(iconKeyFor('yarn.lock')).toBe('yarn');
		expect(iconKeyFor('uv.lock')).toBe('uv');
		expect(iconKeyFor('Cargo.lock')).toBe('cargo');
	});

	it('falls back to default for anything unknown', () => {
		expect(iconKeyFor('mystery.qqq')).toBe('default');
		expect(iconKeyFor('')).toBe('default');
		expect(iconKeyFor('.')).toBe('default');
		expect(iconKeyFor('..')).toBe('default');
		expect(iconKeyFor('trailing.')).toBe('default');
	});

	it('only ever returns a declared key', () => {
		const keys = new Set<string>(ICON_KEYS);
		const samples = [
			'a.py',
			'b.unknown',
			'Dockerfile',
			'.env.test',
			'vite.config.mts',
			'x.tar.gz',
			'weird..name..ts',
		];
		for (const s of samples) {
			expect(keys.has(iconKeyFor(s))).toBe(true);
		}
	});
});
