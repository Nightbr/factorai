import { Button } from '@factorai/ui';
import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { Play, Square } from 'lucide-react';
import { useState } from 'react';
import { StatusDot } from '@components/layout/StatusDot';
import { disposeTerminal, Terminal } from '@components/terminal/Terminal';
import { cmd } from '@lib/tauri';
import { queryKeys } from '@lib/queryKeys';
import { useTerminalStore } from '@store/terminalStore';
import { rootRoute } from './__root';

function SessionView() {
	const { sessionId, projectId } = sessionRoute.useParams();

	const projectsQ = useQuery({
		queryKey: queryKeys.projects(),
		queryFn: () => cmd.listProjects(),
	});
	const project = projectsQ.data?.find((p) => p.id === projectId);
	const projectCwd = project?.realPath ?? null;

	const live = useTerminalStore((s) => s.bySession[sessionId]);
	// Remounting the Terminal (new key) tears down the dead xterm and triggers
	// a fresh spawn — used to restart a stopped session.
	const [restartNonce, setRestartNonce] = useState(0);

	return (
		<main className="flex h-full flex-col bg-[#0c0e12]">
			<header className="flex items-center gap-3 border-b border-border bg-card px-4 py-2">
				<StatusDot status={live?.status ?? 'stopped'} />
				<span className="truncate text-foreground text-sm">
					{project?.displayName ?? projectId}
				</span>
				<span className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs">
					{sessionId}
				</span>
				{live ? (
					<Button
						size="sm"
						variant="outline"
						className="h-7 gap-1.5"
						onClick={() => cmd.terminalKill(live.terminalId)}
					>
						<Square className="size-3" /> Stop
					</Button>
				) : (
					<Button
						size="sm"
						variant="outline"
						className="h-7 gap-1.5"
						onClick={() => {
							// Drop the dead pooled terminal, then remount to spawn fresh.
							disposeTerminal(sessionId);
							setRestartNonce((n) => n + 1);
						}}
					>
						<Play className="size-3" /> Restart
					</Button>
				)}
			</header>
			<div className="min-h-0 flex-1">
				<Terminal
					key={restartNonce}
					sessionId={sessionId}
					projectId={projectId}
					projectCwd={projectCwd}
				/>
			</div>
		</main>
	);
}

export const sessionRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/projects/$projectId/sessions/$sessionId',
	component: SessionView,
});
