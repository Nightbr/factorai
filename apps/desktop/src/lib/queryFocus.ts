import { focusManager } from '@tanstack/react-query';
import { events } from '@lib/tauri';

/**
 * Teach TanStack Query what "focused" means in a desktop window (PERF-11,
 * `specs/10-performance.md`).
 *
 * **The default listener is `visibilitychange`, and in this shell that fires
 * almost never.** A browser tab goes hidden the moment you look at another tab;
 * an app window only does when it is minimised or on another workspace. Sitting
 * behind a browser it is `visible` — so every `refetchInterval` in the app kept
 * running while nobody was looking at it: the sidebar every two seconds, a
 * session list every five per expanded project, the repository every three.
 *
 * With this, `refetchIntervalInBackground` is left at its default of `false` and
 * does what it says: a poll runs while the window has focus and stops when it
 * does not.
 *
 * **Events still arrive while blurred, and that is the point.** Invalidation
 * from `sessions:changed`, `file:changed` and the terminal's status events does
 * not go through the focus manager, so the window stays correct — what stops is
 * asking the same question of the backend on a timer nobody is reading. What is
 * missed is picked up on focus, because `refetchOnWindowFocus` is now a
 * meaningful setting rather than one tied to an event that never fires.
 *
 * In the browser lane there are no Tauri events, so the `visibilitychange`
 * listener is the whole of it, exactly as before.
 */
export function installQueryFocusListener(): void {
	focusManager.setEventListener((handleFocus) => {
		const onVisibility = () => handleFocus(document.visibilityState === 'visible');
		window.addEventListener('visibilitychange', onVisibility, false);

		// `listen` resolves after a round trip to the backend, so the unsubscribe
		// has to survive the teardown racing it — the same guard the event hooks
		// in `routes/__root.tsx` use.
		let cancelled = false;
		const unlisten: Array<() => void> = [];
		const track = (p: Promise<() => void>) => {
			void p.then((off) => (cancelled ? off() : unlisten.push(off)));
		};
		track(events.onWindowFocus(() => handleFocus(true)));
		track(events.onWindowBlur(() => handleFocus(false)));

		return () => {
			cancelled = true;
			window.removeEventListener('visibilitychange', onVisibility);
			for (const off of unlisten) off();
		};
	});
}
