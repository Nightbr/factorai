import { describe, expect, it } from 'vitest';
import {
	COLUMN_GUTTERS,
	columnThreshold,
	HOST_DEAD_BAND,
	MIN_SESSION_WIDTH,
	MIN_VIEWER_WIDTH,
	maxPanelWidth,
	maxViewerWidth,
	resolveViewerHost,
} from './viewerLayout';

const SIDEBAR = 256;
const PANEL = 288;

describe('columnThreshold', () => {
	it('is every column at its floor plus the gutters between them', () => {
		expect(columnThreshold(SIDEBAR, PANEL)).toBe(
			SIDEBAR + MIN_SESSION_WIDTH + MIN_VIEWER_WIDTH + PANEL + COLUMN_GUTTERS,
		);
	});

	it('moves with the panels, because the panels are draggable', () => {
		expect(columnThreshold(480, PANEL)).toBeGreaterThan(columnThreshold(SIDEBAR, PANEL));
		expect(columnThreshold(SIDEBAR, 420)).toBeGreaterThan(columnThreshold(SIDEBAR, PANEL));
	});
});

describe('resolveViewerHost', () => {
	const at = (shellWidth: number, current: 'column' | 'split') =>
		resolveViewerHost({ shellWidth, sidebarWidth: SIDEBAR, columnPanelWidth: PANEL, current });

	it('gives a wide shell the column', () => {
		expect(at(1920, 'split')).toBe('column');
	});

	it('gives a shell under the threshold the split', () => {
		expect(at(columnThreshold(SIDEBAR, PANEL) - 1, 'column')).toBe('split');
	});

	it('keeps a column that exactly meets the threshold', () => {
		expect(at(columnThreshold(SIDEBAR, PANEL), 'column')).toBe('column');
	});

	it('makes a split wait a dead band before going back to a column', () => {
		const threshold = columnThreshold(SIDEBAR, PANEL);
		expect(at(threshold, 'split')).toBe('split');
		expect(at(threshold + HOST_DEAD_BAND - 1, 'split')).toBe('split');
		expect(at(threshold + HOST_DEAD_BAND, 'split')).toBe('column');
	});

	it('holds the current host while the shell is unmeasured', () => {
		expect(at(0, 'column')).toBe('column');
		expect(at(0, 'split')).toBe('split');
		expect(at(Number.NaN, 'column')).toBe('column');
	});
});

describe('maxPanelWidth', () => {
	it('leaves the session its floor and the viewer its column', () => {
		expect(
			maxPanelWidth({
				shellWidth: 1600,
				sidebarWidth: SIDEBAR,
				viewerWidth: 460,
				host: 'column',
				viewerOpen: true,
			}),
		).toBe(1600 - SIDEBAR - MIN_SESSION_WIDTH - 460 - COLUMN_GUTTERS);
	});

	it('gives the panel the viewer column back when nothing is open', () => {
		const open = maxPanelWidth({
			shellWidth: 1600,
			sidebarWidth: SIDEBAR,
			viewerWidth: 460,
			host: 'column',
			viewerOpen: true,
		});
		const closed = maxPanelWidth({
			shellWidth: 1600,
			sidebarWidth: SIDEBAR,
			viewerWidth: 460,
			host: 'column',
			viewerOpen: false,
		});
		expect(closed - open).toBe(460);
	});

	it('ignores the viewer width in the split, where the viewer is inside the panel', () => {
		expect(
			maxPanelWidth({
				shellWidth: 1200,
				sidebarWidth: SIDEBAR,
				viewerWidth: 460,
				host: 'split',
				viewerOpen: true,
			}),
		).toBe(1200 - SIDEBAR - MIN_SESSION_WIDTH - COLUMN_GUTTERS);
	});
});

describe('maxViewerWidth', () => {
	it('is the same arithmetic from the other side', () => {
		expect(maxViewerWidth(1600, SIDEBAR, PANEL)).toBe(
			1600 - SIDEBAR - MIN_SESSION_WIDTH - PANEL - COLUMN_GUTTERS,
		);
	});

	it('and at the threshold leaves exactly the viewer minimum', () => {
		expect(maxViewerWidth(columnThreshold(SIDEBAR, PANEL), SIDEBAR, PANEL)).toBe(MIN_VIEWER_WIDTH);
	});
});
