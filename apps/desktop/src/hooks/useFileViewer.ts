import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback } from 'react';

/**
 * The file the viewer is showing, held in the URL as `?file=<absolute path>`
 * (specs/05-features.md F7).
 *
 * The URL rather than a store so it survives reload and HMR, so browser-back
 * closes the viewer, and because the per-project tab system grows out of the
 * same place — `?file=` becomes a list of open paths. `validateSearch` lives on
 * the project and session routes; other routes have no tree to open a file
 * from.
 */
export function useFileViewer(): {
	path: string | null;
	open: (path: string) => void;
	close: () => void;
} {
	const search = useSearch({ strict: false }) as { file?: string };
	const navigate = useNavigate();

	const open = useCallback(
		(path: string) => {
			void navigate({ to: '.', search: (prev) => ({ ...prev, file: path }) });
		},
		[navigate],
	);

	const close = useCallback(() => {
		void navigate({ to: '.', search: (prev) => ({ ...prev, file: undefined }) });
	}, [navigate]);

	return { path: search.file ?? null, open, close };
}
