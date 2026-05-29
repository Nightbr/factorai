/**
 * Helpers for installing a settable mock Tauri bridge into the renderer
 * before the page loads.
 *
 * Tolaria-style: install via `page.addInitScript` so the global lands on
 * `window` before any module runs. The renderer's `lib/tauri.ts`
 * mockInvoke() reads from `window.__FACTORAI_TEST__`.
 */

import type { Page } from '@playwright/test';
import type { Project, SearchHit, SessionPage, SessionSummary, TerminalId } from '@factorai/types';

export interface TestFixture {
	projects?: Project[];
	sessionsByProject?: Record<string, SessionSummary[]>;
	sessionPages?: Record<string, SessionPage>;
	terminalSpawnId?: TerminalId;
	searchHits?: SearchHit[];
}

/**
 * Install `window.__FACTORAI_TEST__` before the renderer boots. Call
 * before `page.goto(...)`.
 */
export async function installMockBridge(page: Page, fixture: TestFixture): Promise<void> {
	await page.addInitScript((fx) => {
		(window as unknown as { __FACTORAI_TEST__: typeof fx }).__FACTORAI_TEST__ = fx;
	}, fixture);
}

/** Small fixture factory for the common "one project, one session" shape. */
export function fixtureOneProjectOneSession(): TestFixture {
	const project: Project = {
		id: '-home-alice-code-foo',
		realPath: '/home/alice/code/foo',
		displayName: 'foo',
		lastSessionAt: Date.now() - 60_000,
		sessionCount: 1,
		pinned: false,
	};
	const session: SessionSummary = {
		id: 'session-uuid-001',
		projectId: project.id,
		title: 'Refactor the auth middleware',
		createdAt: Date.now() - 3_600_000,
		updatedAt: Date.now() - 60_000,
		turnCount: 42,
		cwd: project.realPath,
	};
	return {
		projects: [project],
		sessionsByProject: { [project.id]: [session] },
		sessionPages: {
			[session.id]: {
				id: session.id,
				events: [],
				offset: 0,
				limit: 100,
				total: 42,
			},
		},
	};
}

/** Same base shape plus a couple of search hits for the /search route. */
export function fixtureWithSearchHits(): TestFixture {
	const base = fixtureOneProjectOneSession();
	const projectId = base.projects?.[0]?.id ?? '';
	const sessionId = base.sessionsByProject?.[projectId]?.[0]?.id ?? '';
	const searchHits: SearchHit[] = [
		{
			sessionId,
			projectId,
			title: 'Refactor the auth middleware',
			role: 'user',
			snippet: 'please refactor the auth middleware to use jwt …',
		},
	];
	return { ...base, searchHits };
}
