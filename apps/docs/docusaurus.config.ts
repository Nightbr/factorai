import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type * as Preset from '@docusaurus/preset-classic';
import type { Config, Plugin } from '@docusaurus/types';

// Visit counts for the site, and only the site (ADR-0063). Umami's tracker is
// fetched at build time and served from our own origin under a neutral name,
// because blockers drop `cloud.umami.is/script.js` by URL. The beacon still
// goes to Umami's gateway — the hosted script's default when `data-host-url`
// is absent — so a blocker that lists that domain still drops the events.
// `data-domains` keeps `docusaurus serve` and the Pages default address out of
// the numbers.
const umami = {
	source: 'https://cloud.umami.is/script.js',
	servedAt: 'js/site.js',
	websiteId: 'cc580669-ba13-46e8-b4ab-7f94a6c492f0',
	domains: 'factorai.build',
};

function umamiPlugin(): Plugin {
	return {
		name: 'factorai-umami',
		injectHtmlTags() {
			return {
				headTags: [
					{
						tagName: 'script',
						attributes: {
							defer: true,
							src: `${baseUrl}${umami.servedAt}`,
							'data-website-id': umami.websiteId,
							'data-domains': umami.domains,
						},
					},
				],
			};
		},
		// Only `docusaurus build` runs this, so `start` never fetches and the
		// dev server answers the tag with a 404 that tracks nothing. A failed
		// fetch fails the build rather than deploying a tag with nothing behind it.
		async postBuild({ outDir }) {
			const response = await fetch(umami.source);
			if (!response.ok) {
				throw new Error(`fetching ${umami.source}: HTTP ${response.status}`);
			}
			const target = join(outDir, umami.servedAt);
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, await response.text());
		},
	};
}

// The site: roadmap item 39 (one Docusaurus build, the guide under /docs) with
// item 58's hero as its index. `url` is the custom domain of ADR-0055, so
// `baseUrl` is the root and `static/CNAME` rides in the build output.
// `headTags` hrefs are written out verbatim — unlike `favicon` or
// `themeConfig.image`, Docusaurus does not prepend the base URL to them, so
// they are built from this rather than written by hand.
const baseUrl = '/';

const config: Config = {
	title: 'factorai',
	tagline: 'Agentic Development Environment (ADE) for the AI era',
	favicon: 'img/factorai-icon.svg',
	url: 'https://factorai.build',
	baseUrl,
	organizationName: 'Nightbr',
	projectName: 'factorai',
	trailingSlash: false,
	onBrokenLinks: 'throw',
	// `favicon` above is the SVG master, which modern browsers prefer. These two
	// are for the ones that do not ask for it: the crawler that indexes a
	// 32px raster, and iOS, which wants an opaque square of its own
	// (specs/09-branding.md B5b).
	headTags: [
		{
			tagName: 'link',
			attributes: { rel: 'icon', type: 'image/x-icon', href: `${baseUrl}img/favicon.ico` },
		},
		{
			tagName: 'link',
			attributes: {
				rel: 'apple-touch-icon',
				sizes: '180x180',
				href: `${baseUrl}img/apple-touch-icon.png`,
			},
		},
		// Docusaurus emits og:image, twitter:image and the card type from
		// `themeConfig.image`; these are what it leaves out, and a scraper that
		// knows the shape up front lays the card out without fetching it first.
		{ tagName: 'meta', attributes: { property: 'og:image:width', content: '1200' } },
		{ tagName: 'meta', attributes: { property: 'og:image:height', content: '630' } },
		{
			tagName: 'meta',
			attributes: {
				property: 'og:image:alt',
				content:
					'The factorai mark seated on a circuit board, over the wordmark and the line "Agentic Development Environment (ADE) for the AI era"',
			},
		},
		{ tagName: 'meta', attributes: { property: 'og:site_name', content: 'factorai' } },
	],
	markdown: {
		hooks: {
			onBrokenMarkdownLinks: 'throw',
		},
	},
	i18n: {
		defaultLocale: 'en',
		locales: ['en'],
	},
	plugins: [umamiPlugin],
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
		// The social card: seq 05 of the hero, captured (specs/09-branding.md
		// B5b). Docusaurus makes the URL absolute from `url` + `baseUrl`, which
		// is what every scraper needs.
		image: 'img/factorai-social.png',
		// The hero is drawn on the app's dark ground (DESIGN.md); one theme.
		colorMode: {
			defaultMode: 'dark',
			disableSwitch: true,
			respectPrefersColorScheme: false,
		},
		navbar: {
			logo: {
				alt: 'factorai',
				src: 'img/factorai-icon.svg',
			},
			items: [
				{
					// The wordmark set the app's way (B8): bold, -0.04em, `ai` in amber.
					type: 'html',
					position: 'left',
					value: '<a class="navbar-wordmark" href="/">factor<span>ai</span></a>',
				},
				{
					// Opens the platform dialog on the index (Download.tsx listens for
					// the class); the query opens it on arrival from any other page.
					to: '/?modal=download',
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
						{ label: 'Download', to: '/?modal=download', className: 'open-download' },
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
			copyright: 'Built with agents, supervised by human',
		},
	} satisfies Preset.ThemeConfig,
};

export default config;
