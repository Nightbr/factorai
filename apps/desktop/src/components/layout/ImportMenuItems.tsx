import { DropdownMenuItem } from '@factorai/ui';
import { useInstalledAgents } from '@hooks/useInstalledAgents';
import { AGENTS } from '@lib/agents';
import { AgentMark } from './AgentMark';
import { useAddProjectStore } from '@store/addProjectStore';

/**
 * One import item per agent, for any menu that offers the import door (F1 §
 * "Import"): the sidebar's header menu and the first-run hero's. Every agent
 * factorai knows is listed whether or not it is installed — a door that
 * appears when a probe answers moves the menu under the cursor. One that is
 * not installed says so but stays enabled: the dialog reads the agent's store
 * on disk, not its binary, and history outlives an uninstall or a CLI that is
 * simply not on this `PATH`.
 *
 * `label` is the item's text for an agent: the header menu names the act
 * ("Import from Codex…"), the hero's menu hangs under a button that already
 * does ("Codex").
 */
export function ImportMenuItems({ label }: { label: (name: string) => string }) {
	const installed = useInstalledAgents();
	const openImport = useAddProjectStore((s) => s.openImport);
	return AGENTS.map(({ id, name }) => {
		const present = installed.includes(id);
		return (
			<DropdownMenuItem
				key={id}
				// `open-import` stays Claude's: it predates the second agent.
				data-testid={id === 'claude' ? 'open-import' : `open-import-${id}`}
				onSelect={() => openImport(id)}
			>
				<AgentMark agent={id} aria-hidden />
				<span className="flex-1">{label(name)}</span>
				{!present && <span className="text-muted-foreground text-xs">not installed</span>}
			</DropdownMenuItem>
		);
	});
}
