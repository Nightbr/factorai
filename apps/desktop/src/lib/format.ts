/**
 * Human-friendly "X ago" formatter. Uses absolute date once we exceed 30d.
 */
export function formatRelative(ms: number, now: number = Date.now()): string {
	const diff = now - ms;
	if (diff < 0) return 'just now';
	const sec = Math.floor(diff / 1000);
	if (sec < 60) return 'just now';
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m ago`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr}h ago`;
	const days = Math.floor(hr / 24);
	if (days < 30) return `${days}d ago`;
	return new Date(ms).toLocaleDateString();
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * File size for the viewer footer and the too-big / binary cards. Binary
 * units (1024), one decimal above KB — "1.2 MB" reads better than "1258291 B"
 * and better than "1.258 MB".
 */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return '—';
	if (bytes < 1024) return `${Math.round(bytes)} B`;

	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < UNITS.length - 1) {
		value /= 1024;
		unit++;
	}
	// Keep 3 significant-ish digits: 9.8 MB, but 128 MB rather than 128.0 MB.
	const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
	return `${rounded} ${UNITS[unit]}`;
}
