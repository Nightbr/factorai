import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import type { SessionEvent } from '@factorai/types';
import { useState } from 'react';
import { EventLog } from '@components/sessions/EventLog';
import { Terminal } from '@components/terminal/Terminal';
import { cmd } from '@lib/tauri';
import { queryKeys } from '@lib/queryKeys';
import { rootRoute } from './__root';

const PAGE_SIZE = 100;

function SessionView() {
	const { sessionId, projectId } = sessionRoute.useParams();

	// Initial load: the *tail* of the session — the last PAGE_SIZE events,
	// because that's what the user actually wants to see when they open a
	// long-running session. Mounting 1872 EventCards in one render freezes
	// the renderer.
	const tailQ = useQuery({
		queryKey: queryKeys.sessionTail(sessionId, PAGE_SIZE),
		queryFn: () => cmd.getSessionTail(sessionId, PAGE_SIZE),
	});

	// Older pages, fetched on demand via "Show earlier".
	const [earlierPages, setEarlierPages] = useState<SessionEvent[][]>([]);
	const [loadingEarlier, setLoadingEarlier] = useState(false);

	const tailOffset = tailQ.data?.offset ?? 0;
	const total = tailQ.data?.total ?? 0;
	const eventsShown =
		(earlierPages.reduce((acc, p) => acc + p.length, 0) ?? 0) +
		(tailQ.data?.events.length ?? 0);

	const earliestLoadedOffset = tailOffset - earlierPages.reduce((acc, p) => acc + p.length, 0);
	const hasMoreEarlier = earliestLoadedOffset > 0;

	const loadEarlier = async () => {
		if (loadingEarlier || !hasMoreEarlier) return;
		setLoadingEarlier(true);
		try {
			const limit = Math.min(PAGE_SIZE, earliestLoadedOffset);
			const offset = earliestLoadedOffset - limit;
			const page = await cmd.getSession(sessionId, offset, limit);
			setEarlierPages((prev) => [page.events, ...prev]);
		} finally {
			setLoadingEarlier(false);
		}
	};

	const projectsQ = useQuery({
		queryKey: queryKeys.projects(),
		queryFn: () => cmd.listProjects(),
	});
	const projectCwd = projectsQ.data?.find((p) => p.id === projectId)?.realPath ?? null;

	const allEvents: SessionEvent[] = [
		...earlierPages.flat(),
		...(tailQ.data?.events ?? []),
	];

	return (
		<main className="flex h-full flex-col">
			<header className="border-b border-border bg-card px-6 py-3">
				<h2 className="font-mono text-xs text-muted-foreground">{sessionId}</h2>
				{tailQ.data && (
					<p className="text-muted-foreground text-xs">
						{eventsShown} of {total} turn{total === 1 ? '' : 's'}
					</p>
				)}
			</header>
			<div className="grid flex-1 grid-rows-[1fr_320px] overflow-hidden">
				<div className="overflow-auto">
					{tailQ.isLoading && (
						<p className="p-6 text-muted-foreground text-sm">Loading…</p>
					)}
					{tailQ.error && (
						<p className="p-6 text-destructive text-sm">
							Failed to load session: {String(tailQ.error)}
						</p>
					)}
					{tailQ.data && hasMoreEarlier && (
						<div className="px-6 pt-4">
							<button
								type="button"
								onClick={loadEarlier}
								disabled={loadingEarlier}
								className="w-full rounded border border-border bg-card px-3 py-2 text-muted-foreground text-sm transition-colors hover:bg-secondary disabled:opacity-50"
							>
								{loadingEarlier
									? 'Loading…'
									: `Show earlier ${Math.min(PAGE_SIZE, earliestLoadedOffset)} turns (${earliestLoadedOffset} remaining)`}
							</button>
						</div>
					)}
					{tailQ.data && <EventLog events={allEvents} />}
				</div>
				<div className="border-t border-border bg-[#0c0e12]">
					<Terminal sessionId={sessionId} projectCwd={projectCwd} />
				</div>
			</div>
		</main>
	);
}

export const sessionRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/projects/$projectId/sessions/$sessionId',
	component: SessionView,
});
