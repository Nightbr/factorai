import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	alphasToPrune,
	baseOf,
	compareVersions,
	newest,
	nextAlpha,
	nextMinor,
	parseVersion,
	prependChangelog,
	releaseNotes,
	touchesTheApp,
} from './lib.mjs';

describe('versions', () => {
	it('reads the two shapes this repo tags and nothing else', () => {
		assert.deepEqual(parseVersion('v0.49.0-alpha.3'), { major: 0, minor: 49, patch: 0, alpha: 3 });
		assert.deepEqual(parseVersion('0.48.2'), { major: 0, minor: 48, patch: 2, alpha: null });
		assert.equal(parseVersion('alpha-channel'), null);
		assert.equal(parseVersion('v0.49.0-beta.1'), null);
	});

	it('sorts an alpha below its own stable and above the previous one', () => {
		assert.ok(compareVersions('0.49.0-alpha.1', '0.48.2') > 0);
		assert.ok(compareVersions('0.49.0-alpha.9', '0.49.0') < 0);
		assert.ok(compareVersions('0.49.0-alpha.10', '0.49.0-alpha.9') > 0);
		assert.equal(compareVersions('v0.49.0', '0.49.0'), 0);
	});

	it('finds the newest of a kind, ignoring the pointer tag', () => {
		const tags = ['v0.48.2', 'v0.49.0-alpha.2', 'alpha-channel', 'v0.49.0-alpha.10', 'v0.48.10'];
		assert.equal(newest(tags, 'alpha'), 'v0.49.0-alpha.10');
		assert.equal(newest(tags, 'stable'), 'v0.48.10');
		assert.equal(newest(['v0.48.2'], 'alpha'), null);
	});

	it('numbers alphas from the tags of the same base', () => {
		assert.equal(nextAlpha('0.49.0', []), '0.49.0-alpha.1');
		assert.equal(
			nextAlpha('0.49.0', ['v0.49.0-alpha.1', 'v0.49.0-alpha.4', 'v0.48.0-alpha.9']),
			'0.49.0-alpha.5',
		);
	});

	it('bumps main to the next minor after a promote', () => {
		assert.equal(nextMinor('0.49.0'), '0.50.0');
		assert.equal(baseOf('v0.49.0-alpha.3'), '0.49.0');
	});
});

describe('touchesTheApp', () => {
	it('skips a push that only moved specs, the site or prose', () => {
		assert.equal(
			touchesTheApp(['specs/roadmap/TODO.md', 'apps/docs/docs/intro.mdx', 'README.md']),
			false,
		);
		assert.equal(touchesTheApp([]), false);
	});

	it('builds for anything else', () => {
		assert.equal(touchesTheApp(['specs/05-features.md', 'apps/desktop/src/App.tsx']), true);
		assert.equal(touchesTheApp(['.github/workflows/release.yml']), true);
	});
});

describe('releaseNotes', () => {
	const subjects = [
		'fix: wait for Codex version probe to exit cleanly',
		'docs: roadmap',
		'feat(site): the site counts page views',
		'refactor: tidy',
		'fix!: a Codex session keeps taking keystrokes',
	];

	it('groups feat and fix in landing order and drops the rest', () => {
		assert.equal(
			releaseNotes({ subjects }),
			[
				'### Features',
				'',
				'- the site counts page views',
				'',
				'### Fixes',
				'',
				'- a Codex session keeps taking keystrokes',
				'- wait for Codex version probe to exit cleanly',
				'',
			].join('\n'),
		);
	});

	it('puts a headline on top and says when nothing user-facing changed', () => {
		assert.equal(
			releaseNotes({ subjects: ['chore: x'], headline: '  Channels. ' }),
			'Channels.\n\nNo user-facing changes.\n',
		);
	});
});

describe('prependChangelog', () => {
	it('starts the file and then adds each stable on top of the last', () => {
		const first = prependChangelog('', { version: '0.49.0', date: '2026-09-23', notes: 'A.' });
		assert.equal(first, '# Changelog\n\n## 0.49.0 — 2026-09-23\n\nA.\n');
		const second = prependChangelog(first, {
			version: '0.50.0',
			date: '2026-10-01',
			notes: 'B.\n',
		});
		assert.equal(
			second,
			'# Changelog\n\n## 0.50.0 — 2026-10-01\n\nB.\n\n## 0.49.0 — 2026-09-23\n\nA.\n',
		);
	});

	it('keeps the preamble above the entries', () => {
		const seeded = '# Changelog\n\nIntro.\n';
		const once = prependChangelog(seeded, { version: '0.49.0', date: 'd1', notes: 'A.' });
		assert.equal(once, '# Changelog\n\nIntro.\n\n## 0.49.0 — d1\n\nA.\n');
		const twice = prependChangelog(once, { version: '0.50.0', date: 'd2', notes: 'B.' });
		assert.equal(twice, '# Changelog\n\nIntro.\n\n## 0.50.0 — d2\n\nB.\n\n## 0.49.0 — d1\n\nA.\n');
	});
});

describe('alphasToPrune', () => {
	it('keeps the promoted cycle and the one before, and no stable or pointer tag', () => {
		const tags = [
			'v0.47.0-alpha.1',
			'v0.48.0-alpha.1',
			'v0.48.0-alpha.2',
			'v0.49.0-alpha.1',
			'v0.49.0',
			'alpha-channel',
			'v0.48.0',
		];
		assert.deepEqual(alphasToPrune(tags, '0.49.0'), ['v0.47.0-alpha.1']);
		assert.deepEqual(alphasToPrune(tags.slice(3), '0.49.0'), []);
	});

	it('never prunes an alpha newer than what was promoted', () => {
		assert.deepEqual(
			alphasToPrune(['v0.48.0-alpha.1', 'v0.49.0-alpha.1', 'v0.50.0-alpha.1'], '0.49.0'),
			[],
		);
	});
});
