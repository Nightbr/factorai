import { toRows } from '@components/session/SubAgentTranscript';
import type { SessionEvent } from '@factorai/types';
import { describe, expect, it } from 'vitest';

function ev(over: Partial<SessionEvent>): SessionEvent {
	return { type: 'user', ...over };
}

describe('toRows', () => {
	it('keeps conversational events with their role and timestamp', () => {
		const rows = toRows([
			ev({
				type: 'user',
				timestamp: '2026-08-15T19:02:00.000Z',
				message: { role: 'user', content: 'Explore the repo' },
			}),
			ev({
				type: 'assistant',
				timestamp: '2026-08-15T19:03:00.000Z',
				message: {
					role: 'assistant',
					content: [{ type: 'text', text: 'Found it' }],
				},
			}),
		]);

		expect(rows).toEqual([
			{ role: 'user', text: 'Explore the repo', timestamp: '2026-08-15T19:02:00.000Z' },
			{ role: 'assistant', text: 'Found it', timestamp: '2026-08-15T19:03:00.000Z' },
		]);
	});

	it('skips meta events — they carry no message at all', () => {
		const rows = toRows([
			ev({ type: 'ai-title', aiTitle: 'Some name' }),
			ev({ type: 'file-history-snapshot' }),
			ev({ type: 'user', message: { role: 'user', content: 'the actual prompt' } }),
		]);

		expect(rows).toHaveLength(1);
		expect(rows[0]?.text).toBe('the actual prompt');
	});

	it('keeps a tool_use event as its name — what the agent did is signal', () => {
		const rows = toRows([
			ev({
				type: 'assistant',
				message: {
					role: 'assistant',
					content: [{ type: 'tool_use', id: 't1', name: 'Grep', input: {} }],
				},
			}),
		]);

		expect(rows).toHaveLength(1);
		expect(rows[0]?.text).toBe('[tool: Grep]');
	});

	it('skips events whose message flattens to nothing', () => {
		// A whitespace-only reply is noise in a read-only rendering.
		const rows = toRows([
			ev({ type: 'assistant', message: { role: 'assistant', content: '   ' } }),
		]);

		expect(rows).toHaveLength(0);
	});

	it('flattens array content across blocks, joining with newlines', () => {
		const rows = toRows([
			ev({
				type: 'assistant',
				message: {
					role: 'assistant',
					content: [
						{ type: 'text', text: 'first' },
						{ type: 'text', text: 'second' },
					],
				},
			}),
		]);

		expect(rows[0]?.text).toBe('first\nsecond');
	});

	it('renders nested tool_result content, the shape an agent transcript is full of', () => {
		const rows = toRows([
			ev({
				type: 'user',
				message: {
					role: 'user',
					content: [
						{
							type: 'tool_result',
							tool_use_id: 't1',
							content: [
								{ type: 'text', text: 'src/foo.rs:10' },
								{ type: 'text', text: 'src/bar.rs:20' },
							],
						},
					],
				},
			}),
		]);

		expect(rows[0]?.text).toBe('src/foo.rs:10\nsrc/bar.rs:20');
	});
});
