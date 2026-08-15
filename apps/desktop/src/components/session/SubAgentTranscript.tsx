import type { ContentBlock, SessionMessage, SessionPage } from '@factorai/types';
import { Button } from '@factorai/ui';
import { cmd } from '@lib/tauri';
import { useQuery } from '@tanstack/react-query';
import { ChevronUp } from 'lucide-react';
import { useState } from 'react';

/**
 * Read-only transcript view for a sub-agent session.
 *
 * A sub-agent's transcript (`<session>/subagents/agent-*.jsonl`) can be read
 * but never resumed: `claude --resume` looks for a top-level transcript under
 * the project directory, and an agent id has none — resuming would spawn a
 * *new* claude under the agent's id. So the session view swaps the terminal
 * for this paged, stateless rendering of the same `get_session` data search
 * already reads.
 *
 * Plain rows, no per-event components: the v1 JSONL event viewer was removed
 * for freezing WebKitGTK under 100+ stateful components (specs/05-features.md
 * F3), and nothing here reintroduces that. Pages of 100 events, expanded
 * backwards with one button.
 */

const PAGE = 100;

/** A message body flattened to text, the way the indexer flattens for FTS —
 *  same shapes, same order, tool_use blocks rendered as their name.
 *
 *  Probed with `typeof` rather than narrowed on `type`: `ContentBlock`'s
 *  catch-all variant (`{ type: string; [extra: string]: unknown }`) overlaps
 *  every literal, so discriminated narrowing never sheds `unknown` — and
 *  probing is the same tolerance the JSONL parser takes with unknown shapes.
 */
function blockText(block: ContentBlock): string {
	const b = block as Record<string, unknown>;
	if (typeof b.text === 'string') return b.text;
	if (block.type === 'tool_use') return typeof b.name === 'string' ? `[tool: ${b.name}]` : '';
	if (block.type === 'thinking' && typeof b.thinking === 'string') return b.thinking;
	if (block.type === 'tool_result') {
		if (typeof b.content === 'string') return b.content;
		if (Array.isArray(b.content)) return b.content.map(blockText).join('\n');
	}
	return '';
}

function messageText(content: SessionMessage['content']): string {
	if (typeof content === 'string') return content;
	return content.map(blockText).filter(Boolean).join('\n');
}

interface Row {
	role: string;
	text: string;
	timestamp?: string;
}

/** Reduce a page of events to conversational rows — meta events
 *  (`ai-title`, `file-history-snapshot`, …) are skipped, not rendered.
 *
 *  Exported for its colocated test. */
export function toRows(events: SessionPage['events']): Row[] {
	const rows: Row[] = [];
	for (const ev of events) {
		if (!ev.message) continue;
		const text = messageText(ev.message.content).trim();
		if (!text) continue;
		rows.push({ role: ev.message.role, text, timestamp: ev.timestamp });
	}
	return rows;
}

export function SubAgentTranscript({ sessionId }: { sessionId: string }) {
	// A growing tail window: start at the last PAGE events — the end is the
	// agent's result, the part you open a transcript for — and each "show
	// earlier" widens it by another PAGE. One command (`get_session_tail`),
	// one cache entry per width, so widening never refetches what's shown.
	const [width, setWidth] = useState(PAGE);
	const { data, isLoading, isError, error } = useQuery({
		queryKey: ['subagent-transcript', sessionId, width],
		queryFn: () => cmd.getSessionTail(sessionId, width),
	});

	if (isLoading) {
		return <p className="text-muted-foreground p-4 text-sm">Loading transcript…</p>;
	}
	if (isError) {
		return (
			<p className="text-destructive p-4 text-sm">Could not read transcript: {String(error)}</p>
		);
	}
	if (!data || data.total === 0) {
		return <p className="text-muted-foreground p-4 text-sm">This sub-agent recorded nothing.</p>;
	}

	const rows = toRows(data.events);
	const hasEarlier = data.offset > 0;

	return (
		<div className="min-h-0 flex-1 overflow-y-auto bg-[#0c0e12] px-4 py-3">
			{hasEarlier && (
				<Button
					variant="outline"
					size="sm"
					className="mb-3"
					onClick={() => setWidth(width + PAGE)}
				>
					<ChevronUp className="size-3.5" /> Show earlier ({data.offset} events hidden)
				</Button>
			)}
			<ul className="flex flex-col gap-3" data-testid="subagent-transcript">
				{rows.map((row, i) => (
					<li key={`${data.offset + i}`} className="max-w-3xl">
						<div className="flex items-baseline gap-2">
							<span
								className={`shrink-0 font-medium text-xs uppercase ${
									row.role === 'user' ? 'text-primary' : 'text-muted-foreground'
								}`}
							>
								{row.role}
							</span>
							{row.timestamp && (
								<span className="text-muted-foreground/60 text-xs">{row.timestamp}</span>
							)}
						</div>
						<p className="mt-0.5 font-mono text-foreground/90 text-xs whitespace-pre-wrap">
							{row.text}
						</p>
					</li>
				))}
			</ul>
			{rows.length === 0 && (
				<p className="text-muted-foreground text-sm">Nothing conversational in this window.</p>
			)}
		</div>
	);
}
