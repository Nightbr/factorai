import type { Terminal as XTerm } from '@xterm/xterm';
import { describe, expect, it } from 'vitest';
import { cellAt, windowedLine } from './fileLinkProvider';

/**
 * A buffer stand-in. xterm can't run in the browser-only test lane, and the two
 * functions under test are exactly the ones that read cells — so the fake has
 * to model the one thing that makes cell arithmetic non-trivial: a wide
 * character is one string character and two cells, the second of them empty and
 * zero-width.
 */
interface FakeCell {
	chars: string;
	width: number;
}

/** Width-1 cells, one per character. `｜` marks the previous cell as wide. */
function cells(text: string): FakeCell[] {
	const out: FakeCell[] = [];
	for (const ch of text) {
		if (ch === '｜') {
			out[out.length - 1].width = 2;
			out.push({ chars: '', width: 0 });
			continue;
		}
		out.push({ chars: ch, width: 1 });
	}
	return out;
}

function fakeTerm(rows: Array<{ text: string; wrapped?: boolean }>): XTerm {
	const lines = rows.map((row) => {
		const row_ = cells(row.text);
		return {
			isWrapped: row.wrapped ?? false,
			length: row_.length,
			translateToString: (trim?: boolean) => {
				const s = row_.map((c) => c.chars).join('');
				return trim ? s.replace(/\s+$/, '') : s;
			},
			getCell: (x: number, target: { _c: FakeCell }) => {
				target._c = row_[x] ?? { chars: '', width: 0 };
			},
		};
	});

	const nullCell = {
		_c: { chars: '', width: 0 } as FakeCell,
		getChars() {
			return this._c.chars;
		},
		getWidth() {
			return this._c.width;
		},
	};

	return {
		buffer: {
			active: {
				getLine: (i: number) => lines[i],
				getNullCell: () => nullCell,
			},
		},
	} as unknown as XTerm;
}

describe('windowedLine', () => {
	it('is just the row when nothing wraps', () => {
		const term = fakeTerm([{ text: 'edited src/a.ts' }, { text: 'done' }]);
		expect(windowedLine(term, 0)).toEqual({ text: 'edited src/a.ts', startRow: 0 });
	});

	it('joins a path split across a wrap, from either half', () => {
		// The case this exists for: at a narrow width the long paths most worth
		// clicking are exactly the ones that get split.
		const term = fakeTerm([
			{ text: 'edited apps/desktop/src/' },
			{ text: 'components/Terminal.tsx', wrapped: true },
		]);

		const joined = 'edited apps/desktop/src/components/Terminal.tsx';
		expect(windowedLine(term, 0)).toEqual({ text: joined, startRow: 0 });
		expect(windowedLine(term, 1)).toEqual({ text: joined, startRow: 0 });
	});

	it('joins three rows of one unbroken token', () => {
		const term = fakeTerm([
			{ text: 'aaa/' },
			{ text: 'bbb/', wrapped: true },
			{ text: 'ccc.ts', wrapped: true },
		]);
		expect(windowedLine(term, 1)).toEqual({ text: 'aaa/bbb/ccc.ts', startRow: 0 });
	});

	it('does not join a row that is not a continuation', () => {
		const term = fakeTerm([{ text: 'first line' }, { text: 'second line' }]);
		expect(windowedLine(term, 1).text).toBe('second line');
	});

	it('is empty for a row past the end of the buffer', () => {
		expect(windowedLine(fakeTerm([{ text: 'x' }]), 9).text).toBe('');
	});
});

describe('cellAt', () => {
	it('maps a string offset straight onto a column, in the simple case', () => {
		const term = fakeTerm([{ text: 'abcdef' }]);
		expect(cellAt(term, 0, 0, 1)).toEqual({ row: 0, col: 0 });
		expect(cellAt(term, 0, 0, 4)).toEqual({ row: 0, col: 3 });
	});

	it('counts a wide character as two cells but one character', () => {
		// Without this, the underline drifts left by one cell per wide character
		// before the path — invisible in a Latin-only test, obvious the first time
		// an agent prints a table with a CJK label in it.
		const term = fakeTerm([{ text: '漢｜字｜/a.ts' }]);
		// String index 2 is `/`, which sits at cell 4.
		expect(cellAt(term, 0, 0, 3)).toEqual({ row: 0, col: 4 });
	});

	it('walks on to the next row when the offset runs past this one', () => {
		const term = fakeTerm([{ text: 'abc' }, { text: 'def', wrapped: true }]);
		expect(cellAt(term, 0, 0, 5)).toEqual({ row: 1, col: 1 });
	});

	it('returns null when the offset runs off the end of the buffer', () => {
		expect(cellAt(fakeTerm([{ text: 'abc' }]), 0, 0, 99)).toBeNull();
	});
});
