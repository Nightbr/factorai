import type { Project, SessionSummary, SidebarRow } from '@factorai/types';
import type { TestFixture } from '../smoke/fixtures';

/**
 * The invented workspace every guide image is taken in (ADR-0066).
 *
 * The same names as `scripts/qa/fixture-workspace.py` and the site's mock —
 * four repositories, two groups, the same session titles — so the hero, the
 * README and the guide show one world. Nothing here is anyone's real work, so
 * nothing in a picture needs blurring.
 *
 * A factory, because every shot mutates its copy into the state it needs.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const IDS = {
	billing: 'p0000b11-0000-4000-8000-000000000001',
	docs: 'p0000d0c-0000-4000-8000-000000000002',
	homelab: 'p00004a1-0000-4000-8000-000000000003',
	recipes: 'p0000ec1-0000-4000-8000-000000000004',
	pro: 'g0000001-0000-4000-8000-0000000000a1',
	side: 'g0000002-0000-4000-8000-0000000000a2',
} as const;

export const HOME = '/home/ada/code';

function project(id: string, name: string, lastAgo: number, count: number, order: number): Project {
	return {
		id,
		realPath: `${HOME}/${name}`,
		displayName: name,
		lastSessionAt: Date.now() - lastAgo,
		sessionCount: count,
		sortOrder: order,
		missing: false,
		profileId: null,
		profileName: null,
		agent: 'claude',
	};
}

function session(
	p: Project,
	n: number,
	title: string,
	updatedAgo: number,
	over: Partial<SessionSummary> = {},
): SessionSummary {
	return {
		id: `${p.id.slice(0, 8)}-5e55-4000-8000-${String(n).padStart(12, '0')}`,
		projectId: p.id,
		title,
		createdAt: Date.now() - updatedAgo - 2 * HOUR,
		updatedAt: Date.now() - updatedAgo,
		turnCount: 12 + n * 7,
		cwd: p.realPath,
		subagentOf: null,
		worktree: null,
		lastCwd: null,
		touchedPaths: [],
		routineId: null,
		routineName: null,
		routineStartedAt: null,
		pinned: false,
		profileName: 'Default',
		agent: 'claude',
		...over,
	};
}

export function world(): TestFixture & {
	projects: Project[];
	sessionsByProject: Record<string, SessionSummary[]>;
	sidebar: SidebarRow[];
} {
	const billing = project(IDS.billing, 'billing-api', 12 * MIN, 3, 0);
	const docs = project(IDS.docs, 'docs-site', 3 * HOUR, 2, 1);
	const homelab = project(IDS.homelab, 'homelab', 2 * DAY, 2, 2);
	const recipes = project(IDS.recipes, 'recipes', 6 * DAY, 1, 3);

	const sessionsByProject: Record<string, SessionSummary[]> = {
		[billing.id]: [
			session(billing, 1, 'Stripe retries are duplicating invoices', 12 * MIN),
			session(billing, 2, 'Flaky e2e on CI: the checkout spec', 5 * HOUR),
			session(billing, 3, 'Proration on mid-cycle plan changes', 3 * DAY),
		],
		[docs.id]: [
			session(docs, 1, 'Write the install page for both platforms', 3 * HOUR),
			session(docs, 2, "The guide's anchors break on every rename", 2 * DAY),
		],
		[homelab.id]: [
			session(homelab, 1, 'Move Jellyfin behind the reverse proxy', 2 * DAY),
			session(homelab, 2, 'The nightly backup keeps waking the NAS', 9 * DAY),
		],
		[recipes.id]: [session(recipes, 1, 'Scale the sourdough to two loaves', 6 * DAY)],
	};

	const row = (p: Project) => ({ rowId: `row-${p.id}`, project: p });
	return {
		projects: [billing, docs, homelab, recipes],
		sessionsByProject,
		sidebar: [
			{ kind: 'group', rowId: IDS.pro, name: 'Pro', children: [row(billing), row(docs)] },
			{
				kind: 'group',
				rowId: IDS.side,
				name: 'Side projects',
				children: [row(homelab), row(recipes)],
			},
		],
		claudeCli: { installed: true, binaryPath: '/home/ada/.local/bin/claude', version: '2.1.4' },
		codexCli: { installed: true, binaryPath: '/home/ada/.local/bin/codex', version: '0.44.0' },
	};
}
