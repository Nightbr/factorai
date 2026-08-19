import type { ILink, Terminal as XTerm } from '@xterm/xterm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearKindCache } from '@lib/fileLinks';
import { cellAt, createFileLinkProvider, windowedLine } from './fileLinkProvider';

vi.mock('@lib/tauri', () => ({ cmd: { pathKinds: vi.fn() } }));

const { cmd } = await import('@lib/tauri');
const pathKinds = cmd.pathKinds as unknown as ReturnType<typeof vi.fn>;

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

/**
 * The provider end to end: a buffer row in, an xterm link range out. This is
 * the seam where a coordinate mistake would otherwise only show up as an
 * underline in the wrong place in a running app.
 */
describe('createFileLinkProvider', () => {
	beforeEach(() => {
		clearKindCache();
		pathKinds.mockReset();
	});

	function provide(term: XTerm, row: number): Promise<ILink[] | undefined> {
		const provider = createFileLinkProvider(
			term,
			() => ({ bases: ['/proj'], home: null }),
			() => {},
		);
		return new Promise((resolve) => provider.provideLinks(row, resolve));
	}

	it('underlines exactly the path, not the words around it', async () => {
		pathKinds.mockResolvedValue(['file']);
		//               1234567890123456
		const term = fakeTerm([{ text: "Read the project's CLAUDE.md." }]);

		const links = await provide(term, 1);

		expect(links).toHaveLength(1);
		// `CLAUDE.md` starts at string index 19 and is 9 characters, so cells
		// 20..28 inclusive, 1-based. The trailing full stop is not part of it.
		expect(links?.[0].range).toEqual({
			start: { x: 20, y: 1 },
			end: { x: 28, y: 1 },
		});
		expect(links?.[0].text).toBe('/proj/CLAUDE.md');
	});

	it('covers the :line:col suffix, so the whole reference is clickable', async () => {
		pathKinds.mockResolvedValue(['file']);
		const term = fakeTerm([{ text: 'see src/a.ts:42:7 now' }]);

		const links = await provide(term, 1);

		// `src/a.ts:42:7` is 13 characters starting at index 4 → cells 5..17.
		expect(links?.[0].range).toEqual({ start: { x: 5, y: 1 }, end: { x: 17, y: 1 } });
	});

	it('spans the wrap when a path is split across two rows', async () => {
		pathKinds.mockResolvedValue(['file']);
		const term = fakeTerm([{ text: 'in apps/de' }, { text: 'sktop/a.ts', wrapped: true }]);

		const links = await provide(term, 2);

		expect(links?.[0].text).toBe('/proj/apps/desktop/a.ts');
		expect(links?.[0].range).toEqual({ start: { x: 4, y: 1 }, end: { x: 10, y: 2 } });
	});

	/**
	 * `undefined` rather than `[]`, and that is a contract rather than a style.
	 *
	 * xterm's `Linkifier._checkLinkProviderResult` shows provider N's links only
	 * once every earlier provider has replied with something **falsy**. This
	 * provider is registered ahead of `WebLinksAddon`, so replying `[]` here
	 * would silently kill every URL link in the terminal — no error, the text
	 * just stops underlining. (The same rule the other way round is why we go
	 * first at all: the addon always replies with an array.)
	 */
	it('offers nothing — as undefined — when the path is not on disk', async () => {
		pathKinds.mockResolvedValue(['missing']);
		expect(await provide(fakeTerm([{ text: 'see ghost.ts' }]), 1)).toBeUndefined();
	});

	it('offers undefined on an empty row, without asking the disk', async () => {
		expect(await provide(fakeTerm([{ text: '' }]), 1)).toBeUndefined();
		expect(pathKinds).not.toHaveBeenCalled();
	});

	it('survives a failing path_kinds by offering no links', async () => {
		pathKinds.mockRejectedValue(new Error('backend gone'));
		expect(await provide(fakeTerm([{ text: 'see a.ts' }]), 1)).toBeUndefined();
	});
});
