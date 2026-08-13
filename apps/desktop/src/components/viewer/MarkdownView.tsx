import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { openExternally } from '@lib/tauri';

/**
 * Rendered markdown for the file viewer (F7).
 *
 * `react-markdown` does **not** render raw HTML unless explicitly told to, so
 * a README that embeds a `<script>` stays inert text. We keep it that way — no
 * `rehype-raw`.
 */

/** Resolve a relative markdown link against the directory of the file it's in. */
export function resolveRelative(fromFile: string, href: string): string {
	const dir = fromFile.slice(0, fromFile.lastIndexOf('/'));
	const segments = `${dir}/${href}`.split('/');
	const out: string[] = [];
	for (const segment of segments) {
		if (segment === '' || segment === '.') continue;
		if (segment === '..') out.pop();
		else out.push(segment);
	}
	return `/${out.join('/')}`;
}

interface MarkdownViewProps {
	source: string;
	/** Absolute path of the file, used to resolve relative links. */
	path: string;
	/** Follow a link to another file — opens it in the viewer. */
	onOpenPath: (path: string) => void;
}

export function MarkdownView({ source, path, onOpenPath }: MarkdownViewProps) {
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
					}}
				>
					{source}
				</Markdown>
			</div>
		</div>
	);
}
