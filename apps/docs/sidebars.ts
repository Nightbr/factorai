import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

/** The guide, in the order a new user meets things (roadmap item 39). */
const sidebars: SidebarsConfig = {
	guide: [
		'installation',
		'agents',
		'projects',
		'sessions',
		'routines',
		{
			type: 'category',
			label: 'Files',
			link: { type: 'doc', id: 'files/index' },
			items: ['files/changes', 'files/graph'],
		},
		'terminal',
		{
			type: 'category',
			label: 'Advanced',
			items: ['advanced/profiles', 'advanced/worktrees', 'advanced/keyboard-shortcuts'],
		},
	],
};

export default sidebars;
