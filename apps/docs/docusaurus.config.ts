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
				// The guide (item 39), under /docs. One site, one deployment.
				docs: {
					routeBasePath: 'docs',
					sidebarPath: './sidebars.ts',
					editUrl: 'https://github.com/Nightbr/factorai/edit/main/apps/docs/',
					showLastUpdateTime: false,
				},
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
					// Opens the platform dialog on the index (Download.tsx listens for
					// the class); the hash is where it lands on any other page.
					to: '/#download',
					label: 'Download',
					position: 'right',
					className: 'open-download',
					// A route of `/` would otherwise read as active on every page.
					activeBaseRegex: '^$',
				},
				{ to: '/docs/installation', label: 'Docs', position: 'right' },
				{
					href: 'https://github.com/Nightbr/factorai',
					label: 'Star on GitHub',
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
						// Opens the platform dialog on the index (Download.tsx listens for
						// the class); the hash is where it lands on any other page.
						{ label: 'Download', to: '/#download', className: 'open-download' },
						{ label: 'Docs', to: '/docs/installation' },
						{ label: 'All releases', href: 'https://github.com/Nightbr/factorai/releases' },
					],
				},
				{
					title: 'source',
					items: [
						{ label: 'Star on GitHub', href: 'https://github.com/Nightbr/factorai' },
						{ label: 'Issues', href: 'https://github.com/Nightbr/factorai/issues' },
						{
							label: 'Roadmap',
							href: 'https://github.com/Nightbr/factorai/blob/main/specs/roadmap/',
						},
					],
				},
			],
			copyright: 'MIT licence · open source · built with agents, supervised by a human',
		},
	} satisfies Preset.ThemeConfig,
};

export default config;
