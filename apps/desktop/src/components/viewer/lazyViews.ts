import { lazy } from 'react';

/**
 * Monaco is the heaviest thing in the app and the viewer is the only thing that
 * needs it, so the chunk is fetched from local disk the first time a file is
 * opened (ADR-0007).
 *
 * Declared **once** and shared by every host — the pane and the expanded modal
 * (ADR-0037). Two `lazy()` calls over the same import would be two components
 * with two suspense boundaries over one chunk, so expanding a file already open
 * in the pane would throw `Loading editor…` over an editor that is already
 * loaded.
 */
export const LazyFileView = lazy(() =>
	import('@components/viewer/FileView').then((m) => ({ default: m.FileView })),
);

export const LazyDiffView = lazy(() =>
	import('@components/viewer/DiffView').then((m) => ({ default: m.DiffView })),
);
