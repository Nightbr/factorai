import type * as Preset from '@docusaurus/preset-classic';
import type { Config } from '@docusaurus/types';

// The site: roadmap item 39 (one Docusaurus build, the guide under /docs) with
// item 58's hero as its index. `url` and `baseUrl` are the GitHub Pages default
// until the custom-domain question in item 39 is settled.
const config: Config = {
	title: 'factorai',
	tagline: 'Agentic Development Environment (ADE) for the AI era',
	favicon: 'img/factorai-icon.svg',
	url: 'https://nightbr.github.io',
	baseUrl: '/factorai/',
	organizationName: 'Nightbr',
	projectName: 'factorai',
	trailingSlash: false,
	onBrokenLinks: 'throw',
	markdown: {
		hooks: {
			onBrokenMarkdownLinks: 'throw',
		},
	},
	i18n: {
		defaultLocale: 'en',
		locales: ['en'],
	},
	presets: [
		[
			'classic',
			{
				// The guide (item 39) is not written yet; pages only until it is.
				docs: false,
				blog: false,
				theme: {
					customCss: './src/css/custom.css',
				},
			} satisfies Preset.Options,
		],
	],
	themeConfig: {
		// The hero is drawn on the app's dark ground (DESIGN.md); one theme.
		colorMode: {
			defaultMode: 'dark',
			disableSwitch: true,
			respectPrefersColorScheme: false,
		},
		navbar: {
			title: 'factorai',
			logo: {
				alt: 'factorai',
				src: 'img/factorai-icon.svg',
			},
			items: [
				{
					href: 'https://github.com/Nightbr/factorai/releases/latest',
					label: 'Download',
					position: 'right',
				},
				{
					href: 'https://github.com/Nightbr/factorai',
					label: 'GitHub',
					position: 'right',
				},
			],
		},
		footer: {
			style: 'dark',
			links: [
				{
					title: 'factorai',
					items: [
						{ label: 'Download', href: 'https://github.com/Nightbr/factorai/releases/latest' },
						{ label: 'All releases', href: 'https://github.com/Nightbr/factorai/releases' },
					],
				},
				{
					title: 'source',
					items: [
						{ label: 'GitHub', href: 'https://github.com/Nightbr/factorai' },
						{ label: 'Issues', href: 'https://github.com/Nightbr/factorai/issues' },
						{
							label: 'Roadmap',
							href: 'https://github.com/Nightbr/factorai/blob/main/specs/roadmap/',
						},
					],
				},
				{
					title: 'needs',
					items: [{ label: 'Claude Code CLI', href: 'https://claude.com/claude-code' }],
				},
			],
			copyright: 'MIT licence · alpha · built with agents, supervised by a human',
		},
	} satisfies Preset.ThemeConfig,
};

export default config;
