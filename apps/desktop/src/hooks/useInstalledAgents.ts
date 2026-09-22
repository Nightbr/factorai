import type { AgentId } from '@factorai/types';
import { useQueries } from '@tanstack/react-query';
import { AGENTS } from '@lib/agents';
import { queryKeys } from '@lib/queryKeys';
import { cmd } from '@lib/tauri';

/**
 * Which agents this machine can start (F30 § "An agent that is not installed").
 *
 * The same probe the Agents section shows, so the launch menu and the
 * settings card can never disagree about what is installed. Cached forever
 * per session; saving an override invalidates the key. Until the probes
 * answer, the list is what a fresh install has: Claude — so the single-agent
 * UI is what paints first and a second agent's affordances appear rather than
 * flicker away.
 */
export function useInstalledAgents(): readonly AgentId[] {
	const results = useQueries({
		queries: AGENTS.map(({ id }) => ({
			queryKey: queryKeys.agentCli(id),
			queryFn: () => cmd.checkAgentCli(id),
			staleTime: Number.POSITIVE_INFINITY,
			retry: false,
		})),
	});
	const installed = AGENTS.filter((_, i) => results[i]?.data?.installed).map((a) => a.id);
	return installed.length === 0 && results.some((r) => r.isPending) ? ['claude'] : installed;
}
