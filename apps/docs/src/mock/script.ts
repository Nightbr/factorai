/**
 * The app mock's screenplay (roadmap item 58): one project in a fabricated
 * workspace, three sessions, and a few minutes of a real afternoon compressed
 * into a loop — an agent edits, tests and commits; a second one stops to ask;
 * the Changes panel fills and empties; the graph stacks. Every step is a
 * mutation of the mock's state at a time offset; the loop restarts from the
 * first frame. Names are invented; behaviour is the app's.
 */

export type Status = 'working' | 'waiting' | 'stopped';

interface Tab {
	id: string;
	name: string;
	status: Status;
}

interface TermLine {
	id: number;
	kind: 'tool' | 'out' | 'ok' | 'ask' | 'user';
	text: string;
}

interface Change {
	path: string;
	add: number;
	del: number;
	staged?: boolean;
}

interface Commit {
	id: string;
	message: string;
	author: string;
	when: string;
	lane: 0 | 1;
	merge?: boolean;
	head?: boolean;
}

export interface MockState {
	tabs: Tab[];
	active: string;
	term: TermLine[];
	changes: Change[];
	commits: Commit[];
	panel: 'files' | 'changes' | 'graph';
	sidebarStatus: Record<string, Status | undefined>;
}

export const INITIAL: MockState = {
	tabs: [
		{ id: 'a', name: 'fix flaky e2e on CI', status: 'working' },
		{ id: 'b', name: 'migrate settings to SQLite', status: 'working' },
		{ id: 'c', name: 'write release notes', status: 'stopped' },
	],
	active: 'a',
	term: [],
	changes: [],
	commits: [
		{
			id: 'c1',
			message: 'feat: session tabs come back on launch',
			author: 'agent',
			when: '2h',
			lane: 0,
			head: true,
		},
		{
			id: 'c2',
			message: 'fix: graph lanes keep their colour across pages',
			author: 'agent',
			when: '3h',
			lane: 0,
		},
		{ id: 'c3', message: 'chore: bump tauri to 2.11', author: 'you', when: '5h', lane: 0 },
		{
			id: 'c4',
			message: 'feat: routines fire without a tab',
			author: 'agent',
			when: '1d',
			lane: 0,
		},
	],
	panel: 'changes',
	sidebarStatus: { 'billing-api': 'working' },
};

let seq = 0;
const line = (kind: TermLine['kind'], text: string): TermLine => ({ id: ++seq, kind, text });

type Step = [number, (s: MockState) => MockState];

const push = (s: MockState, l: TermLine): MockState => ({ ...s, term: [...s.term, l].slice(-9) });
const tab = (s: MockState, id: string, status: Status): MockState => ({
	...s,
	tabs: s.tabs.map((t) => (t.id === id ? { ...t, status } : t)),
	sidebarStatus: {
		...s.sidebarStatus,
		'billing-api': status === 'waiting' ? 'waiting' : s.sidebarStatus['billing-api'],
	},
});

/** Time offsets in ms from the start of the loop. */
export const SCRIPT: Step[] = [
	[
		300,
		(s) =>
			push(s, line('user', 'the login e2e is flaky on CI, only there. find out why and fix it')),
	],
	[1400, (s) => push(s, line('tool', 'Bash  pnpm e2e --grep login --repeat-each 5'))],
	[
		2600,
		(s) => push(s, line('out', '  4 passed, 1 failed  ·  expected cookie "session" to be set')),
	],
	[3600, (s) => push(s, line('tool', 'Read  tests/e2e/login.spec.ts'))],
	[4700, (s) => push(s, line('tool', 'Edit  tests/e2e/login.spec.ts'))],
	[4750, (s) => ({ ...s, changes: [{ path: 'tests/e2e/login.spec.ts', add: 6, del: 2 }] })],
	[5600, (s) => push(s, line('tool', 'Edit  playwright.config.ts'))],
	[
		5650,
		(s) => ({ ...s, changes: [...s.changes, { path: 'playwright.config.ts', add: 1, del: 1 }] }),
	],
	// The second session stops to ask; its dot and its project's go amber.
	[6400, (s) => tab(s, 'b', 'waiting')],
	[7000, (s) => push(s, line('tool', 'Bash  pnpm e2e --grep login --repeat-each 5'))],
	[8300, (s) => push(s, line('ok', '  5 passed'))],
	[
		9200,
		(s) =>
			push(
				s,
				line(
					'tool',
					'Bash  git add -A && git commit -m "fix: wait for the session cookie before asserting"',
				),
			),
	],
	[
		9900,
		(s) => ({
			...s,
			changes: [],
			panel: 'graph',
			commits: [
				{
					id: `n${seq}`,
					message: 'fix: wait for the session cookie before asserting',
					author: 'agent',
					when: 'now',
					lane: 0 as const,
					head: true,
				},
				...s.commits.map((c) => ({ ...c, head: false })),
			].slice(0, 6),
		}),
	],
	[
		10600,
		(s) =>
			push(
				s,
				line(
					'ok',
					'Done. The cookie was read before the redirect finished; the test now waits for it.',
				),
			),
	],
	[11200, (s) => tab(s, 'a', 'waiting')],
	// You switch to the session that asked.
	[12200, (s) => ({ ...s, active: 'b', term: [] })],
	[
		12400,
		(s) =>
			push(
				s,
				line(
					'ask',
					'Migration 0016 drops settings.json. Keep a backup of the file before removing it?  (y/n)',
				),
			),
	],
	[13600, (s) => push(s, line('user', 'y'))],
	[13700, (s) => tab(s, 'b', 'working')],
	[14300, (s) => push(s, line('tool', 'Edit  src-tauri/src/db/migrations/0016_settings.sql'))],
	[
		14350,
		(s) => ({
			...s,
			panel: 'changes',
			changes: [{ path: 'src-tauri/src/db/migrations/0016_settings.sql', add: 24, del: 0 }],
		}),
	],
	[15300, (s) => push(s, line('tool', 'Edit  src/store/prefsStore.ts'))],
	[
		15350,
		(s) => ({
			...s,
			changes: [...s.changes, { path: 'src/store/prefsStore.ts', add: 31, del: 58 }],
		}),
	],
	[16400, (s) => push(s, line('tool', 'Bash  cargo test migrations'))],
	[17600, (s) => push(s, line('ok', '  test result: ok. 12 passed'))],
	[
		18500,
		(s) =>
			push(s, line('tool', 'Bash  git commit -am "feat: settings live in SQLite, migration 0016"')),
	],
	[
		19200,
		(s) => ({
			...s,
			changes: [],
			panel: 'graph',
			commits: [
				{
					id: `n${seq}b`,
					message: 'feat: settings live in SQLite, migration 0016',
					author: 'agent',
					when: 'now',
					lane: 1 as const,
					merge: true,
					head: true,
				},
				...s.commits.map((c) => ({ ...c, head: false })),
			].slice(0, 6),
		}),
	],
	[20000, (s) => tab(s, 'b', 'waiting')],
	[
		20800,
		(s) =>
			push(
				s,
				line(
					'ok',
					'Committed. settings.json is backed up as settings.json.bak; the store reads SQLite from here on.',
				),
			),
	],
	// The third session wakes up for a release.
	[22000, (s) => tab(s, 'c', 'working')],
	[23800, (s) => tab(s, 'c', 'waiting')],
];

export const LOOP_MS = 26000;
