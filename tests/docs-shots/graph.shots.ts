import { expect, type Page, test } from '@playwright/test';
import { installMockBridge, type TestFixture } from '../smoke/fixtures';
import { around, shot } from './capture';
import { HOME, IDS, world } from './world';

/**
 * The Graph tab with a commit open (guide: files/graph.md), in billing-api.
 */

const ROOT = `${HOME}/billing-api`;
const SESSION = `${IDS.billing.slice(0, 8)}-5e55-4000-8000-000000000001`;

type Graph = Required<TestFixture>['gitGraphs'][string];
type Commit = Graph['commits'][number];
type Ref = Commit['refs'][number];
type Detail = Required<TestFixture>['gitCommits'][string];

const HOUR = 3_600_000;

/** A recognisable forty-hex SHA per commit. */
function sha(n: number): string {
	return `${n.toString(16).padStart(2, '0')}c4e9a1b7d3f0`.repeat(4).slice(0, 40);
}

function ref(name: string, kind: Ref['kind'], over: Partial<Ref> = {}): Ref {
	return { name, kind, isHead: false, upstreamInSync: null, ...over };
}

const through0 = { fromLane: 0, toLane: 0, lane: 0, kind: 'through' as const };
const in0 = { fromLane: 0, toLane: 0, lane: 0, kind: 'incoming' as const };
const out0 = { fromLane: 0, toLane: 0, lane: 0, kind: 'outgoing' as const };

function commit(
	n: number,
	subject: string,
	author: string,
	agoHours: number,
	over: Partial<Commit> = {},
): Commit {
	const s = sha(n);
	const t = Date.now() - agoHours * HOUR;
	return {
		sha: s,
		shortSha: s.slice(0, 7),
		subject,
		authorName: author,
		authorTime: t,
		commitTime: t,
		parents: [sha(n + 1)],
		refs: [],
		lane: 0,
		edges: [in0, out0],
		...over,
	};
}

function fixture(): TestFixture {
	const commits: Commit[] = [
		commit(1, 'fix: key invoices on the webhook event id', 'Ada Kerr', 0.3, {
			refs: [ref('fix/duplicate-invoices', 'localBranch', { isHead: true })],
			edges: [out0],
		}),
		commit(2, 'test: a retried delivery writes one invoice', 'Ada Kerr', 1),
		commit(3, "Merge branch 'feat/proration-preview'", 'Tomás Reyes', 20, {
			parents: [sha(4), sha(5)],
			refs: [
				ref('main', 'localBranch', { upstreamInSync: 'origin/main' }),
				ref('origin/main', 'remoteBranch'),
				ref('v2.8.0', 'tag'),
			],
			edges: [in0, out0, { fromLane: 0, toLane: 1, lane: 1, kind: 'outgoing' }],
		}),
		commit(4, 'docs: the runbook covers replaying events', 'Mei Lin', 26, {
			parents: [sha(6)],
			edges: [in0, out0, { fromLane: 1, toLane: 1, lane: 1, kind: 'through' }],
		}),
		commit(5, 'feat: preview the proration before a plan change', 'Tomás Reyes', 30, {
			parents: [sha(6)],
			lane: 1,
			refs: [ref('feat/proration-preview', 'localBranch')],
			edges: [
				through0,
				{ fromLane: 1, toLane: 1, lane: 1, kind: 'incoming' },
				{ fromLane: 1, toLane: 1, lane: 1, kind: 'outgoing' },
			],
		}),
		commit(6, 'chore: bump stripe to 17.4', 'Mei Lin', 50, {
			edges: [in0, { fromLane: 1, toLane: 0, lane: 1, kind: 'incoming' }, out0],
		}),
		commit(7, 'fix: retry failed webhooks with backoff', 'Ada Kerr', 74, {
			refs: [ref('v2.7.1', 'tag')],
		}),
		commit(8, 'feat: invoices carry the customer tax id', 'Mei Lin', 98),
		commit(9, 'test: seed one customer per spec', 'Tomás Reyes', 122),
		commit(10, 'ci: cache the pnpm store between runs', 'Ada Kerr', 146, {
			refs: [ref('v2.7.0', 'tag')],
		}),
		commit(11, 'refactor: one Stripe client, not three', 'Mei Lin', 170),
		commit(12, 'feat: a monthly usage summary per customer', 'Tomás Reyes', 194),
		commit(13, 'fix: a refund no longer reopens a paid invoice', 'Ada Kerr', 218),
		commit(14, 'docs: say which events are safe to replay', 'Mei Lin', 242),
		commit(15, 'chore: drop the unused ledger table', 'Tomás Reyes', 266, {
			refs: [ref('v2.6.0', 'tag')],
		}),
		commit(16, 'feat: dunning emails after the third failed charge', 'Ada Kerr', 290, {
			parents: [],
			edges: [in0],
		}),
	];

	const feat = commits[4];
	const file = (rel: string, kind: Detail['files'][number]['kind'], a: number, d: number) => ({
		path: `${ROOT}/${rel}`,
		relPath: rel,
		kind,
		oldRelPath: null,
		additions: a,
		deletions: d,
		isBinary: false,
	});
	const detail: Detail = {
		sha: feat.sha,
		shortSha: feat.shortSha,
		subject: feat.subject,
		body: 'Customers asked what a switch would cost before making it. The preview\nruns the same proration Stripe will, without creating the invoice.',
		authorName: 'Tomás Reyes',
		authorEmail: 'tomas@example.com',
		authorTime: feat.authorTime,
		committerName: 'Tomás Reyes',
		commitTime: feat.commitTime,
		parents: [sha(6)],
		diffParent: sha(6),
		files: [
			file('src/invoices/proration.ts', 'modified', 48, 6),
			file('src/routes/plans.ts', 'modified', 21, 2),
			file('src/routes/plans.preview.ts', 'added', 64, 0),
			file('tests/proration.test.ts', 'added', 88, 0),
		],
		total: 4,
		truncated: false,
	};

	return {
		...world(),
		gitStatuses: {
			[ROOT]: {
				repoRoot: ROOT,
				branch: 'fix/duplicate-invoices',
				head: sha(1),
				changes: [
					{
						path: `${ROOT}/src/invoices/retry.ts`,
						relPath: 'src/invoices/retry.ts',
						group: 'unstaged',
						kind: 'modified',
						oldRelPath: null,
						additions: 11,
						deletions: 3,
						isBinary: false,
					},
					{
						path: `${ROOT}/tests/retry.test.ts`,
						relPath: 'tests/retry.test.ts',
						group: 'unstaged',
						kind: 'untracked',
						oldRelPath: null,
						additions: 42,
						deletions: 0,
						isBinary: false,
					},
				],
				total: 2,
				truncated: false,
			},
		},
		gitGraphs: {
			[ROOT]: {
				repoRoot: ROOT,
				commits,
				laneCount: 2,
				refsDigest: 'docs0000docs0000',
				hasMore: true,
			},
		},
		gitCommits: { [feat.sha]: detail },
	};
}

/** Drag the panel's own edge left, so the refs have room beside the subjects. */
async function widenPanel(page: Page, by: number) {
	const sep = await page.getByRole('separator', { name: 'Resize file tree' }).boundingBox();
	if (!sep) throw new Error('no separator');
	const x = sep.x + sep.width / 2;
	const y = sep.y + sep.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x - by / 2, y, { steps: 5 });
	await page.mouse.move(x - by, y, { steps: 5 });
	await page.mouse.up();
}

test('graph: branches and tags, with a commit open', async ({ page }) => {
	await installMockBridge(page, fixture());
	await page.goto(`/#/projects/${IDS.billing}/sessions/${SESSION}`);
	await expect(page.locator('.xterm').first()).toBeVisible();
	await page.getByRole('button', { name: 'Toggle file tree' }).click();
	await page.getByRole('tab', { name: 'Graph' }).click();
	await expect(page.getByTestId('commit-row')).toHaveCount(16);
	await widenPanel(page, 200);
	await page.getByTestId('commit-row').nth(4).click();
	const detail = page.getByTestId('commit-detail');
	await expect(detail).toContainText('proration.ts');
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await page.mouse.move(-10, -10);
	await shot(page, 'graph-commit', await around([page.getByTestId('file-tree-panel')], 0));
});
