import type { AgentId } from '@factorai/types';
import { cn } from '@factorai/ui';
import type { SVGProps } from 'react';
import IconClaude from '~icons/simple-icons/claude';
import IconOpenAI from '~icons/simple-icons/openai';
import { agentName } from '@lib/agents';

/**
 * The monochrome mark for an agent (F30 § "What the human sees").
 *
 * The vendors' own marks from `simple-icons`, the set the commit graph already
 * uses for forges (ADR-0006): Anthropic's sunburst for Claude Code, OpenAI's
 * knot for Codex. Drawn in `currentColor` and nothing else — a mark that names
 * whose CLI is running, sized like the icons beside it, never recoloured and
 * never given a background, so it reads as chrome rather than as a logo.
 */
export function AgentMark({
	agent,
	className,
	...rest
}: { agent: AgentId } & Omit<SVGProps<SVGSVGElement>, 'ref'>) {
	const Icon = agent === 'codex' ? IconOpenAI : IconClaude;
	return (
		<Icon
			aria-label={agentName(agent)}
			role="img"
			data-agent={agent}
			className={cn('size-3.5 shrink-0', className)}
			{...rest}
		/>
	);
}
