import { queryKeys } from '@lib/queryKeys';
import { cmd, events } from '@lib/tauri';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/**
 * Keep the open file honest while it is on screen (F7 § "Freshness").
 *
 * Reopening a file re-reads it, which is the fix for the cache that used to
 * answer a reopen from five minutes ago. This is the other half: an agent
 * editing the file you are *currently* reading, which no reopen happens for.
 * Rust watches the one path the viewer has open and emits `file:changed`; this
 * invalidates the reads for that path, and TanStack refetches the ones that are
 * mounted. The cached bytes stay on screen until the new ones land, so there is
 * no flash of `Loading…`.
 *
 * **The subscription's lifetime is exactly the viewer's.** `path` comes from
 * `?file=`, so opening a file subscribes, switching files moves the watch, and
 * closing the viewer releases it — an app sitting on a project page holds no
 * watch, no debouncer thread and no inotify descriptor. That is why the watch
 * lives in Rust behind two commands rather than being a watcher the backend
 * points at the project: nothing needs watching when nothing is open.
 *
 * Q17 decided *against* a watcher for the file tree, and that decision stands —
 * this is not the same bet. A recursive watch on an arbitrary project directory
 * means ignore rules, per-project lifecycle and inotify limits; one file has
 * none of those, and its wrong answer is worse: a stale row in a tree is a row
 * you can click, while stale contents look exactly like current ones.
 *
 * Two effects rather than one: the listener is registered for the app's life
 * (re-subscribing on every path change would drop an event in the gap), and the
 * watch follows the path. The invalidation is keyed off the event's own path, so
 * a notification that arrives after the reader has moved on refreshes a cache
 * entry nobody is reading rather than the file now in front of them.
 */
export function useWatchedOpenFile(path: string | null): void {
	const queryClient = useQueryClient();

	useEffect(() => {
		const pending = events.onFileChanged(({ path: changed }) => {
			// All three namespaces, because the path decides which command answers
			// and this hook does not need to know which one did: the two that hold
			// nothing for this path invalidate nothing. `file` is a prefix match,
			// so the capped and uncapped entries both go.
			void queryClient.invalidateQueries({ queryKey: ['file', changed] });
			void queryClient.invalidateQueries({ queryKey: queryKeys.image(changed) });
			void queryClient.invalidateQueries({ queryKey: queryKeys.pdf(changed) });
		});
		return () => {
			void pending.then((un) => un());
		};
	}, [queryClient]);

	useEffect(() => {
		if (!path) return;
		// Nothing to surface on failure: the file is still readable and reopening
		// it still re-reads, so a watch that could not be established costs the
		// live refresh and nothing else.
		void cmd.watchFile(path).catch((e) => console.error('watch_file failed', path, e));
		return () => {
			void cmd.unwatchFile(path).catch(() => undefined);
		};
	}, [path]);
}
