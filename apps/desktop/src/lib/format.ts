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
