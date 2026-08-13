import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import type { Project } from '@factorai/types';
import { cmd } from '@lib/tauri';
import { queryKeys } from '@lib/queryKeys';

interface ActiveProject {
	/** Project id from the route, if the current route has one. */
	projectId: string | undefined;
	project: Project | undefined;
	/** Absolute project directory, or null when unresolved / off-disk. */
	root: string | null;
	/** True while the projects list is still loading — distinguishes "no root
	 *  yet" from "this project has no root". */
	isLoading: boolean;
}

/**
 * The project the current route is about. `/projects/$id` names it `id`,
 * `/projects/$projectId/sessions/$sessionId` names it `projectId`; routes like
 * `/search` name neither, and get `undefined`.
 */
export function useActiveProject(): ActiveProject {
	const params = useParams({ strict: false }) as { id?: string; projectId?: string };
	const projectId = params.id ?? params.projectId;

	const projectsQ = useQuery({
		queryKey: queryKeys.projects(),
		queryFn: () => cmd.listProjects(),
	});

	const project = projectId ? projectsQ.data?.find((p) => p.id === projectId) : undefined;

	return {
		projectId,
		project,
		root: project?.realPath ?? null,
		isLoading: projectsQ.isLoading,
	};
}
