#!/usr/bin/env node
/**
 * Write the release metadata the About pane reads (specs/05-features.md F29).
 *
 * **Why a file rather than three more Vite defines** is ADR-0049. The short
 * version: two of these values are not the build machine's to know, and the
 * absence of the file is what tells the app it is not a release build — which a
 * define cannot express without inventing a date for a build nobody tagged.
 *
 * Run from `release.yml` after "Set version from tag" and before the frontend
 * build, so the version here is the tag's. Vite copies `public/` into `dist/`
 * and Tauri serves `dist/` from inside the bundle.
 *
 *   node scripts/write-build-info.mjs
 *
 * Environment:
 *   GITHUB_TOKEN   optional. Without it the contributor fetch is skipped rather
 *                  than failing — an unauthenticated call is rate-limited per
 *                  IP, and a shared runner IP is exactly where that bites.
 *   GITHUB_SHA     optional, the commit. Falls back to `git rev-parse`.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'apps/desktop/public/build-info.json');

const OWNER = 'Nightbr';
const REPO = 'factorai';

/** The repository author, who the licence line already names — a contributor
 *  list that repeats him is a duplicate, not a credit (F29). */
const AUTHOR_LOGINS = new Set(['nightbr']);

function version() {
	// The renderer's own version define reads this same file, and `release.yml`
	// rewrites it from the tag before either of us looks (ADR-0049).
	const pkg = JSON.parse(readFileSync(resolve(ROOT, 'apps/desktop/package.json'), 'utf8'));
	return pkg.version;
}

function commit() {
	if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
	try {
		return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
			cwd: ROOT,
			encoding: 'utf8',
		}).trim();
	} catch {
		// A build from a tarball has no git. The pane renders the date without a
		// SHA rather than refusing to render, and the parser treats the field as
		// optional for exactly this case.
		return null;
	}
}

/**
 * Everyone with a commit, commits descending, bots and the author removed.
 *
 * A failure here is not a failed release: the row simply does not render, which
 * is the same thing a dev build shows. Losing a credit list is worth less than
 * a release blocked by GitHub having a bad minute.
 */
async function contributors() {
	const token = process.env.GITHUB_TOKEN;
	if (!token) {
		console.warn('build-info: no GITHUB_TOKEN, skipping the contributor list');
		return [];
	}
	try {
		const response = await fetch(
			`https://api.github.com/repos/${OWNER}/${REPO}/contributors?per_page=100`,
			{
				headers: {
					accept: 'application/vnd.github+json',
					authorization: `Bearer ${token}`,
					'user-agent': `${REPO}-build-info`,
				},
			},
		);
		if (!response.ok) {
			console.warn(`build-info: contributors returned ${response.status}, skipping the list`);
			return [];
		}
		const people = await response.json();
		return (
			people
				// The API sorts by commits already; sorting again costs nothing and
				// makes the order a property of this file rather than of an endpoint.
				.sort((a, b) => (b.contributions ?? 0) - (a.contributions ?? 0))
				.filter((p) => p.type !== 'Bot' && !AUTHOR_LOGINS.has(String(p.login).toLowerCase()))
				.map((p) => ({ login: p.login, url: p.html_url }))
		);
	} catch (error) {
		console.warn(`build-info: contributor fetch failed (${error}), skipping the list`);
		return [];
	}
}

const info = {
	version: version(),
	builtAt: new Date().toISOString(),
	commit: commit(),
	contributors: await contributors(),
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(info, null, '\t')}\n`);
console.log(`build-info: wrote ${OUT}`);
console.log(
	`  ${info.version} · ${info.commit ?? 'no commit'} · ${info.builtAt} · ${info.contributors.length} contributors`,
);
