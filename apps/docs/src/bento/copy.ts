/**
 * The bento's words (roadmap item 58). Written fresh for the page rather than
 * cut from the README; each cell is one label, one title, one sentence, and
 * nothing here claims evidence the product does not have.
 */
interface CellCopy {
	id: string;
	label: string;
	title: string;
	line: string;
	/** Grid columns out of twelve. */
	span: 8 | 6 | 4 | 3;
}

export const HEADING = 'You supervise, decide, review, and set the rules. Agents do the rest.';

export const CELLS: CellCopy[] = [
	{
		id: 'sessions',
		label: 'sessions',
		title: 'Run several agents at once',
		line: 'One tab per agent, each a real claude CLI in a real terminal. Give every one a task, switch between them as they work in parallel, and get more done in a day than one pair of hands could.',
		span: 8,
	},
	{
		id: 'routines',
		label: 'routines',
		title: 'Agents on a schedule',
		line: 'A prompt with a cron behind it. It fires without taking a tab, and catches up what it missed while you were away.',
		span: 4,
	},
	{
		id: 'search',
		label: 'search',
		title: 'Every message, every session',
		line: 'Full text across your whole transcript history, read straight from ~/.claude. Nothing imported, nothing copied.',
		span: 4,
	},
	{
		id: 'changes',
		label: 'audit',
		title: 'Audit whenever you choose',
		line: 'Agents commit as they go; nothing waits on you. Changes shows what was touched, the graph shows what landed, and every line is traced, ready for you on your own schedule.',
		span: 8,
	},
	{
		id: 'sidebar',
		label: 'workspace',
		title: 'Arranged the way you think',
		line: 'Drag projects into groups you name. Dozens of projects and hundreds of sessions is the normal case, not the edge.',
		span: 3,
	},
	{
		id: 'viewer',
		label: 'files',
		title: 'Read, edit, decrypt',
		line: 'A tree with git decorations, a Monaco viewer, Markdown and PDF rendered, SOPS files opened in place.',
		span: 3,
	},
	{
		id: 'worktrees',
		label: 'parallel',
		title: 'One agent per checkout',
		line: 'Worktrees give each session its own checkout; profiles keep several Claude configurations apart.',
		span: 3,
	},
	{
		id: 'local',
		label: 'local',
		title: 'Nothing leaves your machine',
		line: 'No telemetry, no account, no server. Quitting confirms, then kills every agent. No orphans, ever.',
		span: 3,
	},
];
