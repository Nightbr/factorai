import { useQuery } from '@tanstack/react-query';
import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { ProjectIcon } from '@components/layout/ProjectIcon';
import { Input } from '@factorai/ui';
import { cmd } from '@lib/tauri';
import { queryKeys } from '@lib/queryKeys';
import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { rootRoute } from './__root';

function SearchView() {
	const { q, focus } = searchRoute.useSearch();
	const query = (q ?? '').trim();
	const navigate = useNavigate();

	// **This page has a field of its own** (F1, ADR-0038). It used to have none:
	// `q` arrived from the sidebar's box and this view only rendered results,
	// which is unreachable the moment the sidebar is a 48px rail with no box in
	// it — the rail's search icon routes here, so here is where you type.
	const [term, setTerm] = useState(q ?? '');
	// Follows the URL when the URL changes from somewhere else — the sidebar's
	// own field while it is expanded, or a deep link — without fighting what is
	// being typed here, since a keystroke sets both.
	useEffect(() => {
		setTerm(q ?? '');
	}, [q]);

	// Same 250ms the sidebar's field uses: a search runs over every transcript,
	// and one per keystroke is a query per character.
	useEffect(() => {
		const next = term.trim();
		if (next === query) return;
		const t = setTimeout(
			() => void navigate({ to: '/search', search: { q: next || undefined }, replace: true }),
			250,
		);
		return () => clearTimeout(t);
	}, [term, query, navigate]);

	// **Focused on arrival from the rail, and only from there.** A deep link or a
	// reload lands on this route too, and stealing the caret from someone who
	// asked for neither is the failure this flag exists to avoid. The flag is
	// dropped from the URL as soon as it is spent, so a reload of what is now in
	// the address bar does not re-focus.
	const field = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (!focus) return;
		field.current?.focus();
		field.current?.select();
		void navigate({ to: '/search', search: { q: q || undefined }, replace: true });
	}, [focus, q, navigate]);

	const hitsQ = useQuery({
		queryKey: queryKeys.search(query, null),
		queryFn: () => cmd.searchSessions(query),
		enabled: query.length > 0,
	});

	const hits = hitsQ.data;

	return (
		<main className="flex h-full flex-col bg-background">
			<header className="flex items-center gap-3 border-b border-border px-4 py-3">
				<h2 className="shrink-0 font-semibold text-sm">Search</h2>
				<div className="relative min-w-0 max-w-md flex-1">
					<Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 size-3.5 text-muted-foreground" />
					<Input
						ref={field}
						type="search"
						value={term}
						onChange={(e) => setTerm(e.target.value)}
						placeholder="Search sessions…"
						data-testid="search-field"
						className="pl-7"
					/>
				</div>
				{hits && (
					<span className="ml-auto shrink-0 tabular-nums text-muted-foreground text-xs">
						{hits.length} {hits.length === 1 ? 'result' : 'results'}
					</span>
				)}
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto">
				{!query && (
					<p className="p-4 text-muted-foreground text-sm">
						Type above to search across all session content.
					</p>
				)}
				{query && hitsQ.isLoading && (
					<p className="p-4 text-muted-foreground text-sm">Searching…</p>
				)}
				{query && hits && hits.length === 0 && (
					<p className="p-4 text-muted-foreground text-sm">No matches for "{query}".</p>
				)}

				<ul className="divide-y divide-border">
					{hits?.map((h) => (
						<li key={`${h.sessionId}::${h.role}::${h.snippet}`}>
							<Link
								to="/projects/$projectId/sessions/$sessionId"
								params={{ projectId: h.projectId, sessionId: h.sessionId }}
								className="block px-4 py-3 transition-colors hover:bg-secondary/50"
							>
								<div className="flex items-center gap-2">
									{/* Project first, then session: a hit answers "which
									    conversation" only once you know which codebase it was
									    in, and across a workspace two projects routinely hold
									    sessions with the same title. Icon and name together
									    because the icon is what the sidebar and the tab strip
									    are already scanned by — same hue, same initials, hashed
									    from the same path. */}
									<ProjectIcon name={h.projectName} path={h.projectPath} size={16} />
									<span
										className="max-w-[10rem] shrink-0 truncate text-muted-foreground text-xs"
										title={h.projectPath}
									>
										{h.projectName}
									</span>
									<span className="min-w-0 flex-1 truncate font-medium text-sm">
										{h.title || h.sessionId}
									</span>
									<span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-muted-foreground text-xs">
										{h.role}
									</span>
								</div>
								<p className="mt-1 line-clamp-2 text-muted-foreground text-xs">{h.snippet}</p>
							</Link>
						</li>
					))}
				</ul>
			</div>
		</main>
	);
}

export const searchRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/search',
	// `q` is optional so that every route's search params are optional. That
	// uniformity is what lets route-agnostic navigation (the `?file=` viewer
	// param, and the tab system later) update search without knowing which
	// route it's on. The view normalises a missing `q` to ''.
	// `focus` is how the rail's search icon says "and put the caret in the
	// field" (F1, ADR-0038). A flag rather than route state: it is spent on
	// arrival and immediately dropped, so nothing about it survives a reload.
	validateSearch: (search: Record<string, unknown>): { q?: string; focus?: true } => ({
		q: typeof search.q === 'string' ? search.q : undefined,
		focus: search.focus === true || search.focus === 'true' ? true : undefined,
	}),
	component: SearchView,
});
