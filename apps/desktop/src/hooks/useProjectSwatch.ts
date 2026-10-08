import { assignProjectSwatches, projectSwatch, projectSwatchKey } from '@lib/icon';
import { queryKeys } from '@lib/queryKeys';
import { cmd } from '@lib/tauri';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

/**
 * The tile for one project, with the workspace's collisions resolved
 * (ADR-0073).
 *
 * Reads the same `projects` query the sidebar polls, so it costs no request of
 * its own and every `ProjectIcon` on screen — sidebar, tab strip, search hit,
 * drag chip — agrees on the assignment. Before the list has arrived, or for a
 * name that is not in it (a tab whose project was just removed), the hashed
 * swatch stands in: it is what the assignment would give that project in a
 * workspace with no collision, so for most projects nothing moves when the
 * list lands.
 */
export function useProjectSwatch(name: string) {
	const projectsQ = useQuery({ queryKey: queryKeys.projects(), queryFn: () => cmd.listProjects() });
	const projects = projectsQ.data;
	const assigned = useMemo(
		() => (projects ? assignProjectSwatches(projects) : undefined),
		[projects],
	);
	return assigned?.get(projectSwatchKey(name)) ?? projectSwatch(name);
}
