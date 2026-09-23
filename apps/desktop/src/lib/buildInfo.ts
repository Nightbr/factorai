/**
 * The release metadata the About pane reads (specs/05-features.md F29).
 *
 * `build-info.json` is written by `scripts/write-build-info.mjs` in
 * `release.yml` and copied into the bundle by Vite. **Its absence is a state,
 * not a failure**: every local build, the browser-only dev loop and the
 * Playwright lane have no such file, and that is precisely how the app knows it
 * is not a release build (ADR-0049).
 *
 * So every function here is total. Nothing throws, nothing rejects, and a file
 * that is present but wrong is treated as a file that is absent — see
 * `parseBuildInfo`, which rejects the whole document rather than rendering a
 * pane with three blanks in it.
 */

/** One person with a commit in the release, as the script writes them. Not
 *  exported: `BuildInfo` is what a caller holds, and a second name for a row of
 *  it would be a second thing to keep in step with the script. */
interface Contributor {
	login: string;
	url: string;
}

export interface BuildInfo {
	version: string;
	/** ISO-8601 instant, UTC, from the build machine. */
	builtAt: string;
	/** Short SHA, or null for a build with no git available to ask. */
	commit: string | null;
	/** Commits descending, bots and the author already removed. May be empty —
	 *  the pane then renders no contributors row, the same as a dev build. */
	contributors: Contributor[];
}

/** Where Vite puts `public/`, and where Tauri serves it from inside the bundle. */
const BUILD_INFO_URL = '/build-info.json';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function parseContributors(value: unknown): Contributor[] | null {
	if (!Array.isArray(value)) return null;
	const people: Contributor[] = [];
	for (const person of value) {
		if (!isRecord(person)) return null;
		if (!nonEmptyString(person.login) || !nonEmptyString(person.url)) return null;
		people.push({ login: person.login, url: person.url });
	}
	return people;
}

/**
 * Validate a parsed `build-info.json`, or reject it whole.
 *
 * **Whole, deliberately.** A half-written file is a build that went wrong, and
 * the honest thing to show for it is the dev wording — which is a state the app
 * already has a design for — rather than a version with no date beside it, which
 * is a state nobody designed and everybody would read as a bug in the pane.
 */
export function parseBuildInfo(value: unknown): BuildInfo | null {
	if (!isRecord(value)) return null;
	if (!nonEmptyString(value.version)) return null;
	if (!nonEmptyString(value.builtAt) || Number.isNaN(Date.parse(value.builtAt))) return null;
	// The one optional field: a tarball build has no git to ask, and a date
	// without a SHA is still worth showing (F29).
	if (value.commit !== null && value.commit !== undefined && !nonEmptyString(value.commit)) {
		return null;
	}
	const contributors = parseContributors(value.contributors ?? []);
	if (!contributors) return null;

	return {
		version: value.version,
		builtAt: value.builtAt,
		commit: nonEmptyString(value.commit) ? value.commit : null,
		contributors,
	};
}

/**
 * Fetch it once. `null` means "not a release build", which is the common case
 * on a developer's machine and is never an error worth surfacing.
 *
 * The dev server answers an unknown path with `index.html` rather than a 404,
 * so the JSON parse is load-bearing rather than defensive: that is the branch
 * `pnpm vite:dev` actually takes.
 */
export async function fetchBuildInfo(): Promise<BuildInfo | null> {
	try {
		const response = await fetch(BUILD_INFO_URL, { cache: 'no-store' });
		if (!response.ok) return null;
		return parseBuildInfo(await response.json());
	} catch {
		return null;
	}
}

/**
 * The version the pane shows: the release's, or the build-time define — which
 * already says `0.49.0-dev` when no release workflow built this, and is the
 * one the crash screen reports (`vite.config.ts`).
 */
export function displayVersion(info: BuildInfo | null): string {
	return info?.version ?? __APP_VERSION__;
}

/** The day the build was made, in the reader's locale. A date rather than a
 *  timestamp: what is being placed is the release, not the minute it finished —
 *  which is also why this does not read `clock24`, having no clock in it. */
export function formatBuildDate(builtAt: string): string {
	const ms = Date.parse(builtAt);
	if (Number.isNaN(ms)) return '—';
	return new Date(ms).toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	});
}

/**
 * What clicking the version line copies (F29): enough to make a bug report
 * reproducible about *this build*, and nothing about the machine — naming that
 * would cost a platform plugin, and an issue template can ask.
 */
export function buildLine(info: BuildInfo | null): string {
	if (!info) return `factorai ${__APP_VERSION__}, built locally`;
	const commit = info.commit ? ` (${info.commit})` : '';
	return `factorai ${info.version}${commit}, built ${info.builtAt.slice(0, 10)}`;
}
