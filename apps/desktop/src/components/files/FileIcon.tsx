/**
 * Icon-key → SVG component map for the file tree (ADR-0006).
 *
 * Every import is static on purpose: `unplugin-icons` inlines exactly these
 * icons at build time, so the bundle carries no icon set we don't use and the
 * app never reaches the network for one. Adding a file type means adding a key
 * in `lib/fileIcon.ts` and one import here — the compiler catches a mismatch
 * because `BY_KEY` is typed as a total record over `IconKey`.
 */

import type { ComponentType, SVGProps } from 'react';
import DefaultFile from '~icons/vscode-icons/default-file';
import Audio from '~icons/vscode-icons/file-type-audio';
import Babel from '~icons/vscode-icons/file-type-babel';
import Biome from '~icons/vscode-icons/file-type-biome';
import C from '~icons/vscode-icons/file-type-c';
import Cargo from '~icons/vscode-icons/file-type-cargo';
import Cpp from '~icons/vscode-icons/file-type-cpp';
import CSharp from '~icons/vscode-icons/file-type-csharp';
import Css from '~icons/vscode-icons/file-type-css';
import Diff from '~icons/vscode-icons/file-type-diff';
import Docker from '~icons/vscode-icons/file-type-docker';
import DotEnv from '~icons/vscode-icons/file-type-dotenv';
import EditorConfig from '~icons/vscode-icons/file-type-editorconfig';
import Font from '~icons/vscode-icons/file-type-font';
import Git from '~icons/vscode-icons/file-type-git';
import Go from '~icons/vscode-icons/file-type-go';
import GraphQL from '~icons/vscode-icons/file-type-graphql';
import Html from '~icons/vscode-icons/file-type-html';
import Image from '~icons/vscode-icons/file-type-image';
import Ini from '~icons/vscode-icons/file-type-ini';
import Java from '~icons/vscode-icons/file-type-java';
import Js from '~icons/vscode-icons/file-type-js';
import JsConfig from '~icons/vscode-icons/file-type-jsconfig';
import Json from '~icons/vscode-icons/file-type-json';
import Jupyter from '~icons/vscode-icons/file-type-jupyter';
import Key from '~icons/vscode-icons/file-type-key';
import Kotlin from '~icons/vscode-icons/file-type-kotlin';
import License from '~icons/vscode-icons/file-type-license';
import Log from '~icons/vscode-icons/file-type-log';
import Lua from '~icons/vscode-icons/file-type-lua';
import Markdown from '~icons/vscode-icons/file-type-markdown';
import Npm from '~icons/vscode-icons/file-type-npm';
import Pdf from '~icons/vscode-icons/file-type-pdf2';
import Php from '~icons/vscode-icons/file-type-php';
import Pnpm from '~icons/vscode-icons/file-type-pnpm';
import Poetry from '~icons/vscode-icons/file-type-poetry';
import Pytest from '~icons/vscode-icons/file-type-pytest';
import Python from '~icons/vscode-icons/file-type-python';
import PythonConfig from '~icons/vscode-icons/file-type-pythonconfig';
import ReactJs from '~icons/vscode-icons/file-type-reactjs';
import ReactTs from '~icons/vscode-icons/file-type-reactts';
import Ruby from '~icons/vscode-icons/file-type-ruby';
import Ruff from '~icons/vscode-icons/file-type-ruff';
import Rust from '~icons/vscode-icons/file-type-rust';
import Sass from '~icons/vscode-icons/file-type-sass';
import Scss from '~icons/vscode-icons/file-type-scss';
import Shell from '~icons/vscode-icons/file-type-shell';
import Sql from '~icons/vscode-icons/file-type-sql';
import Sqlite from '~icons/vscode-icons/file-type-sqlite';
import Svelte from '~icons/vscode-icons/file-type-svelte';
import Svg from '~icons/vscode-icons/file-type-svg';
import Swift from '~icons/vscode-icons/file-type-swift';
import Text from '~icons/vscode-icons/file-type-text';
import Todo from '~icons/vscode-icons/file-type-todo';
import Toml from '~icons/vscode-icons/file-type-toml';
import TsConfig from '~icons/vscode-icons/file-type-tsconfig';
import TypeScript from '~icons/vscode-icons/file-type-typescript';
import Uv from '~icons/vscode-icons/file-type-uv';
import Video from '~icons/vscode-icons/file-type-video';
import Vite from '~icons/vscode-icons/file-type-vite';
import Vue from '~icons/vscode-icons/file-type-vue';
import Xml from '~icons/vscode-icons/file-type-xml';
import Yaml from '~icons/vscode-icons/file-type-yaml';
import Yarn from '~icons/vscode-icons/file-type-yarn';
import Zip from '~icons/vscode-icons/file-type-zip';
import { type IconKey, iconKeyFor } from '@lib/fileIcon';

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const BY_KEY: Record<IconKey, IconComponent> = {
	audio: Audio,
	babel: Babel,
	biome: Biome,
	c: C,
	cargo: Cargo,
	cpp: Cpp,
	csharp: CSharp,
	css: Css,
	default: DefaultFile,
	diff: Diff,
	docker: Docker,
	dotenv: DotEnv,
	editorconfig: EditorConfig,
	font: Font,
	git: Git,
	go: Go,
	graphql: GraphQL,
	html: Html,
	image: Image,
	ini: Ini,
	java: Java,
	js: Js,
	jsconfig: JsConfig,
	json: Json,
	jupyter: Jupyter,
	key: Key,
	kotlin: Kotlin,
	license: License,
	log: Log,
	lua: Lua,
	markdown: Markdown,
	npm: Npm,
	pdf: Pdf,
	php: Php,
	pnpm: Pnpm,
	poetry: Poetry,
	pytest: Pytest,
	python: Python,
	pythonconfig: PythonConfig,
	reactjs: ReactJs,
	reactts: ReactTs,
	ruby: Ruby,
	ruff: Ruff,
	rust: Rust,
	sass: Sass,
	scss: Scss,
	shell: Shell,
	sql: Sql,
	sqlite: Sqlite,
	svelte: Svelte,
	svg: Svg,
	swift: Swift,
	text: Text,
	todo: Todo,
	toml: Toml,
	tsconfig: TsConfig,
	typescript: TypeScript,
	uv: Uv,
	video: Video,
	vite: Vite,
	vue: Vue,
	xml: Xml,
	yaml: Yaml,
	yarn: Yarn,
	zip: Zip,
};

interface FileIconProps {
	fileName: string;
	className?: string;
}

/** The language/tool icon for a file name. Directories don't get one — their
 *  chevron carries the meaning. */
export function FileIcon({ fileName, className = 'size-4 shrink-0' }: FileIconProps) {
	const Icon = BY_KEY[iconKeyFor(fileName)];
	return <Icon className={className} aria-hidden="true" />;
}
