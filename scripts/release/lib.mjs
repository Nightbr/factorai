/**
 * The release process's decisions, as pure functions (ADR-0064).
 *
 * Everything the workflows decide — which alpha number is next, whether a push
 * changed the app, what the notes say, which alphas to prune — lives here so it
 * can be tested with `node --test` rather than discovered on a release. The
 * workflows call these through `cli.mjs` and do no arithmetic of their own.
 */

/**
 * `v0.49.0-alpha.3` or `0.49.0` as parts, or null for anything else — including
 * `alpha-channel`, the pointer release's tag, which is not a version.
 */
export function parseVersion(text) {
	const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-alpha\.(\d+))?$/.exec(text);
	if (!m) return null;
	return {
		major: Number(m[1]),
		minor: Number(m[2]),
		patch: Number(m[3]),
		alpha: m[4] === undefined ? null : Number(m[4]),
	};
}

/** `0.49.0` for `v0.49.0-alpha.3` — the stable an alpha is heading for. */
export function baseOf(text) {
	const v = parseVersion(text);
	if (!v) throw new Error(`not a version: ${text}`);
	return `${v.major}.${v.minor}.${v.patch}`;
}

/**
 * SemVer order for the two shapes this repo tags. An alpha sorts below the
 * stable of the same base, which is what keeps `0.50.0` an update for a
 * `0.50.0-alpha.2` install (ADR-0064 consequence 1).
 */
export function compareVersions(a, b) {
	const x = parseVersion(a);
	const y = parseVersion(b);
	if (!x || !y) throw new Error(`cannot compare ${a} and ${b}`);
	for (const key of ['major', 'minor', 'patch']) {
		if (x[key] !== y[key]) return x[key] - y[key];
	}
	if (x.alpha === y.alpha) return 0;
	if (x.alpha === null) return 1;
	if (y.alpha === null) return -1;
	return x.alpha - y.alpha;
}

export function isAlpha(tag) {
	return parseVersion(tag)?.alpha != null;
}

function isStable(tag) {
	const v = parseVersion(tag);
	return v !== null && v.alpha === null;
}

/** The newest tag of one kind, or null. Tags that are not versions are ignored. */
export function newest(tags, kind) {
	const keep = kind === 'alpha' ? isAlpha : isStable;
	const matching = tags.filter(keep);
	if (matching.length === 0) return null;
	return matching.reduce((best, tag) => (compareVersions(tag, best) > 0 ? tag : best));
}

/**
 * The next alpha of `base`: one past the highest `v<base>-alpha.N` already
 * tagged, starting at 1. Counted from the tags rather than a run number, so a
 * re-run or a pruned history can never reuse or skip a number that shipped.
 */
export function nextAlpha(base, tags) {
	let highest = 0;
	for (const tag of tags) {
		const v = parseVersion(tag);
		if (v?.alpha == null) continue;
		if (`${v.major}.${v.minor}.${v.patch}` !== base) continue;
		highest = Math.max(highest, v.alpha);
	}
	return `${base}-alpha.${highest + 1}`;
}

/** What `main` holds after `version` is promoted: the next minor. Patch
 *  versions are unused while hotfixes go forward only (ADR-0064 consequence 2). */
export function nextMinor(version) {
	const v = parseVersion(version);
	if (!v) throw new Error(`not a version: ${version}`);
	return `${v.major}.${v.minor + 1}.0`;
}

/**
 * Paths whose change is never worth an alpha: the specs, the site and prose.
 * The site has its own deployment (`pages.yml`); an alpha built for a roadmap
 * edit would be an 80MB download that changes nothing.
 */
const NOT_THE_APP = [/^specs\//, /^apps\/docs\//, /\.md$/];

export function touchesTheApp(paths) {
	return paths.some((path) => path !== '' && !NOT_THE_APP.some((re) => re.test(path)));
}

/**
 * `feat: x` / `fix(scope)!: y` as a section and a line, or null for every other
 * prefix — refactors, tests, docs and chores are not what a user reads notes for.
 */
function classify(subject) {
	const m = /^(feat|fix)(?:\([^)]*\))?!?:\s*(.+)$/.exec(subject.trim());
	if (!m) return null;
	return { section: m[1], text: m[2].trim() };
}

/**
 * The release notes: an optional headline, then Features and Fixes from the
 * commit subjects since the previous release on the same channel. Written once
 * here and used for both the GitHub release and `CHANGELOG.md`, so nothing is
 * written twice (roadmap item 31a).
 */
export function releaseNotes({ subjects, headline }) {
	const features = [];
	const fixes = [];
	// `git log` lists newest first; notes read in the order things landed.
	for (const subject of [...subjects].reverse()) {
		const entry = classify(subject);
		if (!entry) continue;
		(entry.section === 'feat' ? features : fixes).push(`- ${entry.text}`);
	}
	const parts = [];
	const lead = headline?.trim();
	if (lead) parts.push(lead);
	if (features.length) parts.push(['### Features', '', ...features].join('\n'));
	if (fixes.length) parts.push(['### Fixes', '', ...fixes].join('\n'));
	if (!features.length && !fixes.length) parts.push('No user-facing changes.');
	return `${parts.join('\n\n')}\n`;
}

/**
 * `CHANGELOG.md` with one stable's notes added above the previous stable. The
 * file's preamble — everything before the first `## ` entry — stays on top.
 * Stable only: alphas' notes live on their prereleases and never enter the
 * file (ADR-0064).
 */
export function prependChangelog(existing, { version, date, notes }) {
	const entry = `## ${version} — ${date}\n\n${notes.trim()}\n`;
	const text = existing.trim() === '' ? '# Changelog\n' : existing;
	const first = text.search(/^## /m);
	if (first === -1) return `${text.trimEnd()}\n\n${entry}`;
	return `${text.slice(0, first)}${entry}\n${text.slice(first)}`;
}

/**
 * The alpha tags to delete once `promoted` ships: every alpha whose base is
 * older than the two newest cycles at or below it. Keeping the cycle just
 * promoted and the one before leaves enough to bisect a regression (ADR-0064
 * consequence 3).
 */
export function alphasToPrune(tags, promoted) {
	const atOrBelow = (tag) => compareVersions(baseOf(tag), promoted) <= 0;
	const candidates = tags.filter((tag) => isAlpha(tag) && atOrBelow(tag));
	const bases = [...new Set(candidates.map(baseOf))].sort(compareVersions);
	const kept = new Set(bases.slice(-2));
	return candidates.filter((tag) => !kept.has(baseOf(tag)));
}
