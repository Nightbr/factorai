#!/usr/bin/env node
/**
 * Refuse a tracked text file that contains bytes text does not have.
 *
 * **Why this exists.** On 2026-09-09 a `DiffView.tsx` was committed—nearly—with
 * a literal U+0000 in a template literal, where a separator was meant.
 * Every other check passed: biome formats it, `tsc` parses it, 605 unit tests
 * and 273 smoke tests ran against it. Git classified the file as binary (a NUL
 * in the first 8000 bytes is git's whole test), so `git diff` showed
 * `Bin 10692 -> 19617 bytes` instead of a diff — and factorai's own viewer,
 * which asks the same question of the same bytes, drew the binary card for one
 * of its own source files. A human spotted the `bin` badge in the Changes list.
 * Nothing else would have.
 *
 * That is the failure shape this catches: a file that is source to every tool
 * that parses it and opaque to every tool that reads it as text — diffs, code
 * review, grep, and the app itself.
 *
 * **Stricter than git on purpose.** Git looks for a NUL in the first 8000
 * bytes; this looks for any control byte anywhere. A NUL at offset 9000 is the
 * same bug with a quieter blast radius, and "git happened not to notice" is not
 * a property worth depending on.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * The three control bytes text is made of. Everything else below 0x20, plus
 * DEL, is what this rejects.
 *
 * Form feed (0x0c) is deliberately *not* here. It is a legitimate page break in
 * some old C, and it appears in nothing this repo has ever written; letting it
 * through to be safe would mean the check has an exception nobody can point at
 * a file for. If one ever arrives, that is a conversation, not a silent pass.
 */
const ALLOWED = new Set([0x09, 0x0a, 0x0d]);

/**
 * Extensions whose files are *supposed* to be bytes.
 *
 * An explicit list rather than a sniff, and it **fails closed**: add a new kind
 * of binary asset and this check goes red until the extension is named here,
 * which is a two-line commit and a deliberate statement. The inverse — guessing
 * which files are text — is how the one file that mattered would have been
 * guessed wrong.
 */
const BINARY_EXTENSIONS = new Set([
	'png',
	'jpg',
	'jpeg',
	'gif',
	'webp',
	'ico',
	'icns',
	'pdf',
	'woff',
	'woff2',
	'ttf',
	'otf',
	'eot',
	'wasm',
	'zip',
	'gz',
	'br',
	'dmg',
	'snap',
	'appimage',
	'node',
	'dylib',
	'so',
	'dll',
	'exe',
	'keystore',
	'jks',
	'mp4',
	'webm',
	'mov',
	'mp3',
	'wav',
	'ogg',
]);

/** The name a byte goes by in the report, because `0x0` says less than `NUL`. */
const NAMES = new Map([
	[0x00, 'NUL'],
	[0x07, 'BEL'],
	[0x08, 'BS'],
	[0x0b, 'VT'],
	[0x0c, 'FF'],
	[0x1b, 'ESC'],
	[0x7f, 'DEL'],
]);

function extensionOf(path) {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Tracked files only. Untracked ones are nobody's problem yet, and ignored
 *  ones — `target/`, `node_modules/` — are full of legitimate bytes. */
function trackedFiles() {
	const out = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 << 20 });
	return out.split('\0').filter(Boolean);
}

/** Where a byte offset lands, in the terms an editor uses. */
function positionOf(buf, offset) {
	let line = 1;
	let lineStart = 0;
	for (let i = 0; i < offset; i++) {
		if (buf[i] === 0x0a) {
			line++;
			lineStart = i + 1;
		}
	}
	return { line, column: offset - lineStart + 1 };
}

/** The text either side, with the offender spelled out rather than printed —
 *  printing it is how it got this far. */
function contextOf(buf, offset) {
	const before = buf.subarray(Math.max(0, offset - 40), offset).toString('utf8');
	const after = buf.subarray(offset + 1, offset + 41).toString('utf8');
	const name = NAMES.get(buf[offset]) ?? `0x${buf[offset].toString(16).padStart(2, '0')}`;
	return `${before}⟪${name}⟫${after}`.replaceAll('\n', '⏎');
}

const findings = [];
for (const path of trackedFiles()) {
	if (BINARY_EXTENSIONS.has(extensionOf(path))) continue;
	let buf;
	try {
		buf = readFileSync(path);
	} catch (e) {
		// A tracked path with no file is a broken symlink or a case-collision on
		// a case-insensitive checkout. Neither is this check's business.
		if (e.code === 'ENOENT' || e.code === 'EISDIR') continue;
		throw e;
	}
	for (let i = 0; i < buf.length; i++) {
		const byte = buf[i];
		if (byte >= 0x20 && byte !== 0x7f) continue;
		if (ALLOWED.has(byte)) continue;
		const { line, column } = positionOf(buf, i);
		findings.push({ path, line, column, context: contextOf(buf, i) });
		// One per file. The second occurrence is almost always the same mistake,
		// and a wall of them buries which files are affected.
		break;
	}
}

if (findings.length === 0) {
	console.log(`No control bytes in ${trackedFiles().length} tracked text files.`);
	process.exit(0);
}

console.error('Control bytes in tracked text files:\n');
for (const f of findings) {
	console.error(`  ${f.path}:${f.line}:${f.column}`);
	console.error(`    ${f.context}\n`);
}
console.error(
	'A file carrying one of these is binary to git, to `git diff`, to code review\n' +
		"and to factorai's own viewer, whatever its extension says.\n\n" +
		'Write the escape (`\\u0000`, `\\t`) rather than the byte. If the file really\n' +
		'is binary, add its extension to BINARY_EXTENSIONS in this script.',
);
process.exit(1);
