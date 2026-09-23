#!/usr/bin/env node
/**
 * The release workflows' one entry point into `lib.mjs` (ADR-0064). Each
 * command reads git or the repo, asks `lib.mjs`, and prints the answer for a
 * workflow step to capture. Nothing here decides anything `lib.mjs` does not.
 *
 *   node scripts/release/cli.mjs set-version <version>
 *   node scripts/release/cli.mjs repo-version
 *   node scripts/release/cli.mjs base <alpha-tag>
 *   node scripts/release/cli.mjs next-alpha
 *   node scripts/release/cli.mjs newest <alpha|stable>
 *   node scripts/release/cli.mjs touches-app <from> <to>
 *   node scripts/release/cli.mjs notes <from|-> <to> [headline]
 *   node scripts/release/cli.mjs bump-after <version> <notes-file>
 *   node scripts/release/cli.mjs prune <promoted>
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	alphasToPrune,
	baseOf,
	isAlpha,
	newest,
	nextAlpha,
	nextMinor,
	parseVersion,
	prependChangelog,
	releaseNotes,
	touchesTheApp,
} from './lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PACKAGE_JSON = 'apps/desktop/package.json';
const TAURI_CONF = 'apps/desktop/src-tauri/tauri.conf.json';
const CARGO_TOML = 'apps/desktop/src-tauri/Cargo.toml';
const CARGO_LOCK = 'Cargo.lock';
const CHANGELOG = 'CHANGELOG.md';

function git(...args) {
	return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function lines(text) {
	return text.split('\n').filter(Boolean);
}

function read(path) {
	return readFileSync(resolve(ROOT, path), 'utf8');
}

function write(path, text) {
	writeFileSync(resolve(ROOT, path), text);
}

function tags() {
	return lines(git('tag', '--list', 'v*'));
}

function repoVersion() {
	return JSON.parse(read(PACKAGE_JSON)).version;
}

/**
 * All four places the version lives. `Cargo.lock` too, so the bump commit
 * leaves a tree where a plain `cargo build` changes nothing. JSON is rewritten
 * with tabs because that is how the formatter leaves these files.
 */
function setVersion(version) {
	if (!parseVersion(version)) throw new Error(`not a version: ${version}`);
	for (const path of [PACKAGE_JSON, TAURI_CONF]) {
		const json = JSON.parse(read(path));
		json.version = version;
		write(path, `${JSON.stringify(json, null, '\t')}\n`);
	}
	const line = /^version = ".*"$/m;
	const cargo = read(CARGO_TOML);
	// Test the pattern rather than comparing before and after: rewriting to the
	// version already there is a legitimate no-op.
	if (!line.test(cargo)) throw new Error(`${CARGO_TOML} has no [package] version line`);
	write(CARGO_TOML, cargo.replace(line, `version = "${version}"`));
	const lock = read(CARGO_LOCK);
	const entry = /(\[\[package\]\]\nname = "factorai"\nversion = )"[^"]*"/;
	if (!entry.test(lock)) throw new Error(`${CARGO_LOCK} has no factorai package entry`);
	write(CARGO_LOCK, lock.replace(entry, `$1"${version}"`));
}

function subjects(from, to) {
	const range = from && from !== '-' ? `${from}..${to}` : to;
	return lines(git('log', '--format=%s', range));
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
	case 'set-version':
		setVersion(args[0]);
		console.log(args[0]);
		break;

	case 'repo-version':
		console.log(repoVersion());
		break;

	case 'base': {
		// Refuses anything that is not an alpha tag, so a mistyped promote input
		// fails here rather than tagging something odd.
		if (!isAlpha(args[0] ?? '')) {
			console.error(`not an alpha tag: ${args[0] ?? '(none)'}`);
			process.exit(1);
		}
		console.log(baseOf(args[0]));
		break;
	}

	case 'next-alpha':
		console.log(nextAlpha(baseOf(repoVersion()), tags()));
		break;

	case 'newest':
		console.log(newest(tags(), args[0]) ?? '');
		break;

	case 'touches-app': {
		const [from, to] = args;
		// No previous alpha is the first alpha, and the first alpha is always
		// worth building.
		if (!from) {
			console.log('true');
			break;
		}
		console.log(String(touchesTheApp(lines(git('diff', '--name-only', from, to)))));
		break;
	}

	case 'notes': {
		const [from, to, headline] = args;
		process.stdout.write(releaseNotes({ subjects: subjects(from, to), headline }));
		break;
	}

	case 'bump-after': {
		// After a promote: CHANGELOG.md gains the stable's notes, and the repo
		// moves to the next minor. One commit, made by the workflow.
		const [version, notesFile] = args;
		const existing = existsSync(resolve(ROOT, CHANGELOG)) ? read(CHANGELOG) : '';
		const date = new Date().toISOString().slice(0, 10);
		write(
			CHANGELOG,
			prependChangelog(existing, { version, date, notes: readFileSync(notesFile, 'utf8') }),
		);
		const next = nextMinor(version);
		setVersion(next);
		console.log(next);
		break;
	}

	case 'prune':
		for (const tag of alphasToPrune(tags(), args[0])) console.log(tag);
		break;

	default:
		console.error(`unknown command: ${command ?? '(none)'}`);
		process.exit(2);
}
