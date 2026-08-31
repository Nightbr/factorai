import { splitFrontmatter } from '@components/viewer/frontmatter';
import { FrontmatterPanel } from '@components/viewer/FrontmatterPanel';
import { MermaidDiagram } from '@components/viewer/MermaidDiagram';
import { iconKeyFor } from '@lib/fileIcon';
import { queryKeys } from '@lib/queryKeys';
import { cmd, openExternally } from '@lib/tauri';
import { REREAD_ON_OPEN } from '@lib/viewerQuery';
import type { FileContents, ImageContents } from '@factorai/types';
import { usePrefsStore } from '@store/prefsStore';
import { useQuery } from '@tanstack/react-query';
import { ImageOff } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Rendered markdown for the file viewer (F7).
 *
 * `react-markdown` does **not** render raw HTML unless explicitly told to, so
 * a README that embeds a `<script>` stays inert text. We keep it that way — no
 * `rehype-raw`.
 */

/**
 * A hast node, structurally — enough of one to read a fenced code block out of.
 *
 * Written out here rather than imported from `hast`: `@types/hast` is
 * react-markdown's dependency and not ours, and the shape this needs is four
 * fields deep. The `node` react-markdown hands a component satisfies it.
 */
interface HastNode {
	type: string;
	tagName?: string;
	value?: string;
	properties?: { className?: unknown };
	children?: HastNode[];
}

function classNames(node: HastNode): string[] {
	const raw = node.properties?.className;
	if (Array.isArray(raw)) return raw.map(String);
	return typeof raw === 'string' ? raw.split(/\s+/) : [];
}

/**
 * The diagram source in a ```mermaid fence, or null if this `<pre>` is an
 * ordinary code block.
 *
 * Read off the hast node rather than off React children: `children` here is
 * an already-rendered `<code>` element whose own children may have been split
 * by the highlighter or the parser, and reassembling text out of that is how
 * a diagram loses a line break. The node still has the literal.
 *
 * The language comes from the fence's info string, which remark turns into a
 * `language-*` class. Only `mermaid` counts — a fence labelled `mmd`, or one
 * with no label at all, is a code block and stays one.
 */
export function mermaidSource(node: HastNode | undefined): string | null {
	if (!node || node.tagName !== 'pre') return null;
	const elements = (node.children ?? []).filter((child) => child.type === 'element');
	const [code] = elements;
	if (elements.length !== 1 || !code || code.tagName !== 'code') return null;
	if (!classNames(code).includes('language-mermaid')) return null;

	const text = (code.children ?? [])
		.filter((child) => child.type === 'text')
		.map((child) => child.value ?? '')
		.join('');
	// Remark keeps the newline that closes the fence; mermaid does not care, but
	// an all-whitespace fence is nothing to draw and would fail as a parse error
	// rather than as the empty block it is.
	return text.trim() ? text : null;
}

/**
 * Resolve a relative markdown link or image against the file it appears in.
 *
 * A leading `/` is a **filesystem** path, not a site root: there is no site
 * here, and a document that writes `/home/me/diagram.png` means that file.
 */
export function resolveRelative(fromFile: string, href: string): string {
	const dir = href.startsWith('/') ? '' : fromFile.slice(0, fromFile.lastIndexOf('/'));
	const segments = `${dir}/${href}`.split('/');
	const out: string[] = [];
	for (const segment of segments) {
		if (segment === '' || segment === '.') continue;
		if (segment === '..') out.pop();
		else out.push(segment);
	}
	return `/${out.join('/')}`;
}

/**
 * The local file an image `src` points at, or null if it doesn't point at one.
 *
 * Null covers both halves of "not ours": a remote URL, which the webview can
 * fetch by itself, and an empty string, which is what react-markdown's URL
 * sanitiser leaves behind for a `data:` or `file:` src (we keep that default).
 *
 * The fragment and query are dropped and percent-escapes decoded, because a
 * `src` is a URL and a path on disk is not — `![](my%20logo.png)` is a file
 * with a space in its name.
 */
export function localImageSrc(fromFile: string, src: string): string | null {
	const url = src.trim();
	if (!url || /^[a-z][a-z0-9+.-]*:/i.test(url)) return null;
	const bare = url.replace(/[?#].*$/, '');
	if (!bare) return null;
	let decoded = bare;
	try {
		decoded = decodeURI(bare);
	} catch {
		// A stray `%` is a literal `%` in a filename, not a broken escape.
	}
	return resolveRelative(fromFile, decoded);
}

function basename(path: string): string {
	const i = path.lastIndexOf('/');
	return i >= 0 ? path.slice(i + 1) : path;
}

/** The `data:` URL for a local image, or null if the bytes aren't displayable. */
function dataUrl(read: ImageContents | FileContents): string | null {
	// `read_image` answers with bytes and a MIME type it sniffed; `read_file`
	// answers with text, which is only an image at all because it is SVG.
	if ('base64' in read) return `data:${read.mime};base64,${read.base64}`;
	if (read.isBinary || read.contents.length === 0) return null;
	// `encodeURIComponent`, not base64: `btoa` throws on anything outside
	// Latin-1, and an SVG with an accent in a label is ordinary. Same reasoning
	// as `SvgPreview` in `FileView`.
	return `data:image/svg+xml,${encodeURIComponent(read.contents)}`;
}

interface MarkdownViewProps {
	source: string;
	/** Absolute path of the file, used to resolve relative links. */
	path: string;
	/** Follow a link to another file — opens it in the viewer. */
	onOpenPath: (path: string) => void;
}

export function MarkdownView({ source, path, onOpenPath }: MarkdownViewProps) {
	// **The frontmatter is taken off before remark sees it.** react-markdown has
	// no frontmatter plugin, so the fences parsed as markdown and every field ran
	// together into one paragraph. Split here rather than in a remark plugin
	// because the block is not being rendered as markdown at all — it becomes a
	// panel of its own above the document.
	const { frontmatter, body } = splitFrontmatter(source);
	const frontmatterOpen = usePrefsStore((s) => s.frontmatterOpen);

	return (
		<div className="h-full overflow-auto px-8 py-6" data-testid="markdown-view">
			<div
				className="prose prose-invert prose-sm mx-auto max-w-3xl
					prose-headings:font-semibold
					prose-h1:mt-0 prose-h1:border-b prose-h1:border-border prose-h1:pb-2
					prose-h2:border-b prose-h2:border-border prose-h2:pb-1.5
					prose-a:text-primary prose-a:no-underline hover:prose-a:underline
					prose-code:rounded prose-code:bg-secondary prose-code:px-1 prose-code:py-0.5
					prose-code:font-normal prose-code:before:content-none prose-code:after:content-none
					prose-pre:border prose-pre:border-border prose-pre:bg-secondary/40
					prose-table:text-sm prose-th:border-b prose-th:border-border prose-th:text-left
					prose-td:border-b prose-td:border-border/60
					prose-img:rounded prose-hr:border-border"
			>
				{frontmatter && (
					// Keyed by path so the disclosure starts from the preference again
					// on the next document, rather than inheriting the state of the
					// one before it.
					<FrontmatterPanel key={path} frontmatter={frontmatter} defaultOpen={frontmatterOpen} />
				)}
				<Markdown
					remarkPlugins={[remarkGfm]}
					components={{
						a: ({ href, children }) => (
							<a
								href={href}
								onClick={(e) => {
									e.preventDefault();
									if (!href) return;
									if (/^https?:|^mailto:/.test(href)) {
										// External link: hand it to the browser, never navigate
										// the webview itself out of the app.
										void openExternally(href);
									} else if (href.startsWith('#')) {
										// In-document anchor: nothing to open.
									} else {
										// A relative path — open that file in the viewer. If it
										// doesn't exist, read_file's NotFound card explains why.
										onOpenPath(resolveRelative(path, href));
									}
								}}
							>
								{children}
							</a>
						),
						img: ({ src, alt, title }) => (
							<MarkdownImage src={src ?? ''} alt={alt ?? ''} title={title} from={path} />
						),
						// A ```mermaid fence is a diagram; every other fence is a code
						// block and renders as one. Overriding `pre` rather than `code`
						// because the diagram replaces the whole block — returning it
						// from `code` would leave it wrapped in a `<pre>`, which is
						// styled as a code block and may not contain flow content.
						pre: ({ node, children, ...props }) => {
							const diagram = mermaidSource(node);
							if (diagram !== null) return <MermaidDiagram code={diagram} />;
							return <pre {...props}>{children}</pre>;
						},
					}}
				>
					{body}
				</Markdown>
			</div>
		</div>
	);
}

/**
 * An image in a markdown document.
 *
 * A relative `src` is a path on disk, and the webview cannot load one: it has
 * no filesystem origin to resolve against, so `![logo](logo.png)` renders as a
 * broken image no matter how correct the markdown is. So local images go
 * through the same commands the image viewer uses and arrive as a `data:` URL,
 * which is also the reason there is no second route into the filesystem here
 * (see F7's "base64 through a command, not the asset protocol").
 *
 * A remote `src` is left alone — that one the webview can fetch, and a badge in
 * a README is the common case.
 */
function MarkdownImage({
	src,
	alt,
	title,
	from,
}: {
	src: string;
	alt: string;
	title?: string;
	from: string;
}) {
	const local = localImageSrc(from, src);
	if (local) return <LocalImage path={local} alt={alt} title={title} />;
	// Nothing to load and nothing to fetch: an `<img src="">` re-requests the
	// document itself, so say what is missing instead.
	if (!src) return <MissingImage label={alt} />;
	return <img src={src} alt={alt} title={title} />;
}

function LocalImage({ path, alt, title }: { path: string; alt: string; title?: string }) {
	// SVG is the one image that is also text: it has no magic bytes, so
	// `read_image` refuses it and `read_file` is the way in. Same split the
	// viewer already makes between `ImageView` and `SvgPreview`.
	const isSvg = iconKeyFor(basename(path)) === 'svg';

	const imageQ = useQuery({
		queryKey: isSvg ? queryKeys.file(path, false) : queryKeys.image(path),
		queryFn: (): Promise<ImageContents | FileContents> =>
			isSvg ? cmd.readFile(path) : cmd.readImage(path),
		// A document open in the viewer is a snapshot, like the text around it,
		// and re-read on open with it — an edited diagram is the common case.
		...REREAD_ON_OPEN,
		retry: false,
	});

	// Nothing while it loads: these are local reads, and a placeholder that
	// reflows the paragraph a frame later is worse than a beat of nothing.
	if (imageQ.isPending) return null;

	const url = imageQ.data ? dataUrl(imageQ.data) : null;
	// Missing, or the extension lied and the backend refused the bytes. Either
	// way the reader gets the alt text rather than a silent gap.
	if (!url) return <MissingImage label={alt || basename(path)} />;

	return <img src={url} alt={alt} title={title} data-testid="markdown-image" />;
}

function MissingImage({ label }: { label: string }) {
	return (
		<span
			data-testid="markdown-image-missing"
			className="not-prose inline-flex items-center gap-1.5 rounded border border-border border-dashed px-2 py-1 align-middle text-muted-foreground text-xs"
		>
			<ImageOff className="size-3.5 shrink-0" />
			{label || 'image'}
		</span>
	);
}
