import { loadMermaid } from '@components/viewer/mermaid';
import { Waypoints } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

/**
 * One ```mermaid fence in a rendered markdown document, drawn as a diagram
 * (F7, ADR-0021).
 *
 * Mermaid arrives through `loadMermaid`, so a document with no fence never
 * pays for it. Until it has, the fence renders as nothing rather than as a
 * spinner: these are local reads with no network behind them, and a
 * placeholder that reflows the page a frame later is worse than a beat of
 * nothing — the same call `LocalImage` makes.
 */

type State =
	| { kind: 'pending' }
	| { kind: 'ready'; svg: string }
	| { kind: 'failed'; message: string };

export function MermaidDiagram({ code }: { code: string }) {
	// `useId` is unique per instance and stable across re-renders, which is
	// exactly the requirement — mermaid uses the id to build CSS selectors and
	// `<marker>` references inside the SVG, so two diagrams sharing one would
	// steal each other's arrowheads. Its colons are not valid in a selector.
	const id = `mermaid-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
	const [state, setState] = useState<State>({ kind: 'pending' });
	const host = useRef<HTMLDivElement>(null);

	useEffect(() => {
		let live = true;
		setState({ kind: 'pending' });
		loadMermaid()
			.then((mermaid) => mermaid.render(id, code))
			.then(({ svg }) => {
				if (live) setState({ kind: 'ready', svg });
			})
			.catch((err: unknown) => {
				if (live) setState({ kind: 'failed', message: messageOf(err) });
			});
		return () => {
			live = false;
		};
	}, [code, id]);

	// The SVG is parsed and adopted rather than assigned as innerHTML. Mermaid
	// has already run its output through DOMPurify (`securityLevel: 'strict'`),
	// so this is not the sanitising step — it is how the markup becomes real
	// SVG nodes without reaching for `dangerouslySetInnerHTML`. Parsed as
	// `text/html`, not `image/svg+xml`: the HTML parser puts inline SVG in the
	// right namespace and tolerates the `<foreignObject>` markup mermaid emits
	// for labels, which is not always well-formed XML.
	useEffect(() => {
		const node = host.current;
		if (!node) return;
		if (state.kind !== 'ready') {
			node.replaceChildren();
			return;
		}
		const parsed = new DOMParser().parseFromString(state.svg, 'text/html');
		const svg = parsed.body.firstElementChild;
		if (svg) node.replaceChildren(document.importNode(svg, true));
		else node.replaceChildren();
	}, [state]);

	if (state.kind === 'failed') return <DiagramError message={state.message} code={code} />;

	return (
		<div
			ref={host}
			data-testid="mermaid-diagram"
			// `not-prose` because the SVG is a drawing, not typography: prose's
			// margins and its `svg { display: block }` reset both apply to what is
			// inside it otherwise.
			className="not-prose my-4 overflow-x-auto"
			// Only meaningful once the SVG lands; harmless before it does, and it
			// keeps the fence from collapsing the scroll position on the way.
			data-state={state.kind}
		/>
	);
}

function messageOf(err: unknown): string {
	if (err instanceof Error) return err.message;
	return typeof err === 'string' ? err : 'Could not render this diagram.';
}

/**
 * A diagram that would not parse.
 *
 * The source is kept, and shown: a fence that mermaid rejects is still the
 * thing the author wrote, and the reader has as much use for it as for a code
 * block. The dashed frame is `MissingImage`'s, for the same reason — something
 * was meant to be here.
 */
function DiagramError({ message, code }: { message: string; code: string }) {
	return (
		<div
			data-testid="mermaid-error"
			className="not-prose my-4 rounded border border-border border-dashed"
		>
			<div className="flex items-center gap-1.5 border-border/60 border-b px-3 py-1.5 text-muted-foreground text-xs">
				<Waypoints className="size-3.5 shrink-0" />
				{message.split('\n')[0] || 'Could not render this diagram.'}
			</div>
			<pre className="overflow-x-auto px-3 py-2 font-mono text-secondary-foreground text-xs">
				{code}
			</pre>
		</div>
	);
}
