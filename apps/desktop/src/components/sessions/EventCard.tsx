import type { ContentBlock, SessionEvent } from '@factorai/types';
import { useState } from 'react';
import { Bot, ChevronDown, ChevronRight, User, Wrench } from 'lucide-react';

interface EventCardProps {
	event: SessionEvent;
}

export function EventCard({ event }: EventCardProps) {
	const role = event.message?.role;
	const blocks = normalizeContent(event.message?.content);

	if (event.type === 'summary') {
		return (
			<li className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-muted-foreground text-xs italic">
				<span className="mr-2 rounded bg-secondary px-1.5 py-0.5 not-italic font-medium text-xs">
					summary
				</span>
				{extractText(blocks) || '(no body)'}
			</li>
		);
	}

	const isUser = role === 'user';
	const isAssistant = role === 'assistant';

	return (
		<li
			className={`rounded-md border bg-card ${
				isUser
					? 'border-primary/30'
					: isAssistant
						? 'border-border'
						: 'border-dashed border-muted'
			}`}
		>
			<header className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5 text-xs">
				{isUser && <User className="size-3.5 text-primary" />}
				{isAssistant && <Bot className="size-3.5 text-foreground/80" />}
				{!isUser && !isAssistant && <Wrench className="size-3.5 text-muted-foreground" />}
				<span className="font-medium">{role ?? event.type}</span>
				<span className="ml-auto font-mono text-muted-foreground">
					{formatTime(event.timestamp)}
				</span>
			</header>
			<div className="flex flex-col gap-2 p-3 text-sm">
				{blocks.map((b, i) => (
					<ContentBlockView key={`${b.type}-${i}`} block={b} />
				))}
				{blocks.length === 0 && (
					<RawJsonBlock value={event.extra ?? {}} fallback="(no content)" />
				)}
			</div>
		</li>
	);
}

function ContentBlockView({ block }: { block: ContentBlock }) {
	if (isTextBlock(block)) {
		return <p className="whitespace-pre-wrap break-words">{block.text}</p>;
	}
	if (isThinkingBlock(block)) {
		return (
			<details>
				<summary className="cursor-pointer text-muted-foreground text-xs">thinking</summary>
				<pre className="mt-1 whitespace-pre-wrap break-words text-muted-foreground text-xs">
					{block.thinking}
				</pre>
			</details>
		);
	}
	if (isToolUseBlock(block)) {
		return (
			<Collapsible
				header={
					<>
						<Wrench className="size-3.5" />
						<span className="font-mono text-xs">{block.name}</span>
					</>
				}
			>
				<RawJsonBlock value={block.input ?? {}} />
			</Collapsible>
		);
	}
	if (isToolResultBlock(block)) {
		const inner = normalizeContent(block.content);
		return (
			<Collapsible header={<span className="font-mono text-xs">tool_result</span>}>
				<div className="flex flex-col gap-2 text-xs">
					{inner.map((b, i) => (
						<ContentBlockView key={`${b.type}-${i}`} block={b} />
					))}
				</div>
			</Collapsible>
		);
	}
	return <RawJsonBlock value={block} />;
}

function isTextBlock(b: ContentBlock): b is { type: 'text'; text: string } {
	return b.type === 'text' && typeof (b as { text?: unknown }).text === 'string';
}

function isThinkingBlock(b: ContentBlock): b is { type: 'thinking'; thinking: string } {
	return b.type === 'thinking' && typeof (b as { thinking?: unknown }).thinking === 'string';
}

function isToolUseBlock(
	b: ContentBlock,
): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } {
	return b.type === 'tool_use' && typeof (b as { name?: unknown }).name === 'string';
}

function isToolResultBlock(
	b: ContentBlock,
): b is { type: 'tool_result'; tool_use_id: string; content: string | ContentBlock[] } {
	return b.type === 'tool_result' && 'content' in b;
}

function Collapsible({
	header,
	children,
}: {
	header: React.ReactNode;
	children: React.ReactNode;
}) {
	const [open, setOpen] = useState(false);
	return (
		<div className="rounded border border-border/60 bg-secondary/30">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="flex w-full items-center gap-1.5 px-2 py-1 text-left transition-colors hover:bg-secondary"
			>
				{open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
				{header}
			</button>
			{open && <div className="border-t border-border/60 px-2 py-1.5">{children}</div>}
		</div>
	);
}

function RawJsonBlock({ value, fallback }: { value: unknown; fallback?: string }) {
	const json = JSON.stringify(value, null, 2);
	if (!json || json === '{}' || json === '[]') {
		return <p className="text-muted-foreground text-xs">{fallback ?? '(empty)'}</p>;
	}
	return (
		<pre className="overflow-auto whitespace-pre-wrap break-words font-mono text-muted-foreground text-xs">
			{json}
		</pre>
	);
}

function normalizeContent(
	content: string | ContentBlock[] | undefined,
): ContentBlock[] {
	if (!content) return [];
	if (typeof content === 'string') {
		return content ? [{ type: 'text', text: content }] : [];
	}
	return content;
}

function extractText(blocks: ContentBlock[]): string {
	return blocks
		.filter((b): b is { type: 'text'; text: string } => b.type === 'text' && 'text' in b)
		.map((b) => b.text)
		.join('\n');
}

function formatTime(iso: string): string {
	try {
		const d = new Date(iso);
		return d.toLocaleString();
	} catch {
		return iso;
	}
}
