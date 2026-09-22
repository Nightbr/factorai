import type { AgentId } from '@factorai/types';

/**
 * The agents factorai knows, in the order the Agents section shows them
 * (F30, ADR-0060). A mirror of `agents::registry()` in Rust: the id is the
 * `agent` column value, the name is what the UI calls it.
 */
export const AGENTS: readonly { id: AgentId; name: string; binary: string }[] = [
	{ id: 'claude', name: 'Claude Code', binary: 'claude' },
	{ id: 'codex', name: 'Codex', binary: 'codex' },
];

export function agentName(id: AgentId | string | null | undefined): string {
	return AGENTS.find((a) => a.id === id)?.name ?? String(id ?? '');
}
