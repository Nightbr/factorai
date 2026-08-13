/**
 * Filename → icon key for the file tree (F11).
 *
 * Pure strings only, no icon imports, so it unit-tests without the Vite icon
 * plugin (same split as `lib/icon.ts`). The keys are resolved to actual SVG
 * components in `components/files/FileIcon.tsx` — that file holds the static
 * `~icons/vscode-icons/*` imports (ADR-0006).
 *
 * Keys match the vscode-icons collection minus its `file-type-` prefix, so
 * adding one is: add the key here, add the matching import there.
 */

export const ICON_KEYS = [
	'audio',
	'babel',
	'biome',
	'c',
	'cargo',
	'cpp',
	'csharp',
	'css',
	'diff',
	'docker',
	'dotenv',
	'editorconfig',
	'font',
	'git',
	'go',
	'graphql',
	'html',
	'image',
	'ini',
	'java',
	'js',
	'json',
	'jsconfig',
	'jupyter',
	'key',
	'kotlin',
	'license',
	'log',
	'lua',
	'markdown',
	'npm',
	'php',
	'pnpm',
	'poetry',
	'pytest',
	'python',
	'pythonconfig',
	'reactjs',
	'reactts',
	'ruby',
	'ruff',
	'rust',
	'sass',
	'scss',
	'shell',
	'sql',
	'sqlite',
	'svelte',
	'svg',
	'swift',
	'text',
	'todo',
	'toml',
	'tsconfig',
	'typescript',
	'uv',
	'video',
	'vite',
	'vue',
	'xml',
	'yaml',
	'yarn',
	'zip',
	/** Fallback — vscode-icons calls this one `default-file`. */
	'default',
] as const;

export type IconKey = (typeof ICON_KEYS)[number];

/**
 * Exact filenames, lowercased. Checked before extensions so `Cargo.toml` gets
 * the crate icon rather than the generic TOML one — the specific thing a file
 * *is* beats what it's written in.
 */
const BY_NAME: Record<string, IconKey> = {
	'.dockerignore': 'docker',
	'.editorconfig': 'editorconfig',
	'.gitattributes': 'git',
	'.gitignore': 'git',
	'.gitmodules': 'git',
	'.npmrc': 'npm',
	'.nvmrc': 'npm',
	'.ruff.toml': 'ruff',
	'biome.json': 'biome',
	'biome.jsonc': 'biome',
	'cargo.lock': 'cargo',
	'cargo.toml': 'cargo',
	'conftest.py': 'pytest',
	dockerfile: 'docker',
	'jsconfig.json': 'jsconfig',
	license: 'license',
	'license.md': 'license',
	'license.txt': 'license',
	'package-lock.json': 'npm',
	'package.json': 'npm',
	'pnpm-lock.yaml': 'pnpm',
	'pnpm-workspace.yaml': 'pnpm',
	'poetry.lock': 'poetry',
	'pyproject.toml': 'pythonconfig',
	'ruff.toml': 'ruff',
	'todo.md': 'todo',
	'tsconfig.json': 'tsconfig',
	'uv.lock': 'uv',
	'yarn.lock': 'yarn',
};

/** Extension (no dot), lowercased. */
const BY_EXT: Record<string, IconKey> = {
	aac: 'audio',
	bash: 'shell',
	bmp: 'image',
	c: 'c',
	cc: 'cpp',
	cfg: 'ini',
	cjs: 'js',
	cpp: 'cpp',
	cs: 'csharp',
	css: 'css',
	db: 'sqlite',
	diff: 'diff',
	env: 'dotenv',
	fish: 'shell',
	flac: 'audio',
	gif: 'image',
	gql: 'graphql',
	graphql: 'graphql',
	go: 'go',
	gz: 'zip',
	h: 'c',
	hpp: 'cpp',
	htm: 'html',
	html: 'html',
	ico: 'image',
	ini: 'ini',
	ipynb: 'jupyter',
	java: 'java',
	jpeg: 'image',
	jpg: 'image',
	js: 'js',
	json: 'json',
	json5: 'json',
	jsonc: 'json',
	jsx: 'reactjs',
	key: 'key',
	kt: 'kotlin',
	kts: 'kotlin',
	log: 'log',
	lua: 'lua',
	md: 'markdown',
	mdx: 'markdown',
	mjs: 'js',
	mkv: 'video',
	mp3: 'audio',
	mp4: 'video',
	otf: 'font',
	patch: 'diff',
	pem: 'key',
	php: 'php',
	png: 'image',
	py: 'python',
	pyi: 'python',
	rb: 'ruby',
	rs: 'rust',
	sass: 'sass',
	scss: 'scss',
	sh: 'shell',
	sql: 'sql',
	sqlite: 'sqlite',
	sqlite3: 'sqlite',
	svelte: 'svelte',
	svg: 'svg',
	swift: 'swift',
	tar: 'zip',
	toml: 'toml',
	ts: 'typescript',
	tsx: 'reactts',
	ttf: 'font',
	txt: 'text',
	vue: 'vue',
	wav: 'audio',
	webm: 'video',
	webp: 'image',
	woff: 'font',
	woff2: 'font',
	xml: 'xml',
	yaml: 'yaml',
	yml: 'yaml',
	zip: 'zip',
	zsh: 'shell',
};

/** Filenames matching `<name>.config.<js|ts|…>` that get a tool-specific icon. */
const BY_CONFIG_PREFIX: Record<string, IconKey> = {
	babel: 'babel',
	vite: 'vite',
	vitest: 'vite',
};

/**
 * Pick the icon key for a file name. Never throws and never returns undefined —
 * unknown files get `'default'`.
 */
export function iconKeyFor(fileName: string): IconKey {
	const name = fileName.toLowerCase();

	const exact = BY_NAME[name];
	if (exact) return exact;

	// `vite.config.ts`, `babel.config.js` — the tool matters more than the
	// language it's configured in.
	const configMatch = /^([a-z0-9-]+)\.config\.[a-z]+$/.exec(name);
	if (configMatch) {
		const tool = BY_CONFIG_PREFIX[configMatch[1]];
		if (tool) return tool;
	}

	// A leading dot is part of the name, not an extension: `.env` is handled
	// above, `.env.local` should still read as an env file.
	if (name.startsWith('.env')) return 'dotenv';

	const dot = name.lastIndexOf('.');
	// No dot, or a name that is only a dot-prefix (`.foo`) — nothing to key on.
	if (dot <= 0) return 'default';

	return BY_EXT[name.slice(dot + 1)] ?? 'default';
}
