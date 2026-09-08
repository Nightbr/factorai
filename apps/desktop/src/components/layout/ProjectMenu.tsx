import type { Project } from '@factorai/types';
import {
	Button,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@factorai/ui';
import { liveSessionsIn, useRemoveProject } from '@hooks/useRemoveProject';
import { useStartSession } from '@hooks/useStartSession';
import { queryKeys } from '@lib/queryKeys';
import { cmd, openExternally } from '@lib/tauri';
import { useTerminalStore } from '@store/terminalStore';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { AlertTriangle, ClockFading, FolderOpen, IdCard, Plus, Trash2 } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';

/**
 * What right-clicking a project offers, in both places a project is drawn.
 *
 * **One menu, two frames** (F1, ADR-0038). The sidebar row passes its
 * reordering block as `arrange`; the rail's glyph passes nothing, because
 * dragging 48px glyphs to rearrange a workspace is a gesture with no target and
 * the keyboard path goes with it. Everything else — the two things you come to
 * a project to start, the profile it runs as, revealing it, removing it — is
 * the same question at 48px as at 256, and a second copy of it is a second
 * answer that drifts.
 *
 * There is deliberately **no pin here**: a project has none. The row's hover pin
 * was removed when ordering replaced pinning (F1, "This replaced pinning"), and
 * the pin that remains is a session's, on the session's own row.
 *
 * Rendered inside a `<ContextMenu>`; it is the content, not the trigger. The
 * confirm dialog rides along because it is this menu's, and it portals out of
 * wherever the menu was opened from.
 */
export function ProjectMenu({ project, arrange }: { project: Project; arrange?: ReactNode }) {
	const startSession = useStartSession();
	const navigate = useNavigate();
	const removeProject = useRemoveProject();
	// Subscribe to `bySession` and derive: `liveSessionsIn` builds a new array
	// each call, so selecting it directly would hand zustand a fresh reference
	// on every store read and re-render forever.
	const bySession = useTerminalStore((s) => s.bySession);
	const liveHere = useMemo(() => liveSessionsIn(bySession, project.id), [bySession, project.id]);
	const [confirmRemove, setConfirmRemove] = useState(false);

	// Removing is silent when nothing is running: it touches nothing on disk and
	// re-adding rebuilds, so a dialog on every tidy-up is friction on the action
	// you will do thirty times. A live PTY is the exception — see the dialog.
	function remove() {
		if (liveHere.length > 0) {
			setConfirmRemove(true);
			return;
		}
		void removeProject(project.id);
	}

	return (
		<>
			<ContextMenuContent className="w-56" onCloseAutoFocus={(e) => e.preventDefault()}>
				{/* The two things you come to a project to start (F22), at the top
				    and away from the arranging below. Both say "New …" because the
				    project page's own button does — two verbs on two adjacent items
				    reads as a difference that is not there. */}
				<ContextMenuItem
					disabled={project.missing}
					data-testid={`new-session-${project.id}`}
					onSelect={() => void startSession(project.id)}
				>
					<Plus />
					New session
				</ContextMenuItem>
				<ContextMenuItem
					data-testid={`new-routine-${project.id}`}
					onSelect={() =>
						void navigate({
							to: '/projects/$id',
							params: { id: project.id },
							search: { tab: 'routines', new: true },
						})
					}
				>
					<ClockFading />
					New routine
				</ContextMenuItem>
				<ContextMenuSeparator />
				{arrange}
				<ProfileSubmenu project={project} />
				<ContextMenuSeparator />
				<ContextMenuItem
					disabled={project.missing}
					onSelect={() => void openExternally(project.realPath)}
				>
					<FolderOpen />
					Reveal in file manager
				</ContextMenuItem>
				<ContextMenuSeparator />
				{/* Below the separator and away from everything else: this one has no
				    undo, and it is otherwise a slip from Reveal. */}
				<ContextMenuItem
					variant="destructive"
					data-testid={`remove-project-${project.id}`}
					onSelect={remove}
				>
					<Trash2 />
					Remove Project
				</ContextMenuItem>
			</ContextMenuContent>

			{/* Only reached with something running. Removing is otherwise silent:
			    it touches nothing on disk (ADR-0004) and re-adding rebuilds the
			    index, so a dialog every time would be friction on the action this
			    whole item exists to make possible. What a live PTY changes is that
			    the alternative to killing it is leaving `claude` running with no row
			    and no tab — the invisible-agent state ADR-0005 forbids. */}
			<Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
				<DialogContent data-testid="confirm-remove-project">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<AlertTriangle className="size-5 text-destructive" />
							Remove {project.displayName}?
						</DialogTitle>
						<DialogDescription>
							{liveHere.length} running session{liveHere.length === 1 ? '' : 's'} in this project
							will be stopped. Nothing on disk is deleted — your transcripts stay where they are,
							and adding the folder back restores them.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setConfirmRemove(false)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							data-testid="confirm-remove-project-yes"
							onClick={() => {
								setConfirmRemove(false);
								void removeProject(project.id);
							}}
						>
							Stop &amp; remove
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

/**
 * Which Claude identity this project's new sessions run as (F25 slice 3).
 *
 * The note is permanent, not conditional on anything being live. The rule —
 * `CLAUDE_CONFIG_DIR` is read at spawn — is worth learning once rather than
 * discovering from a toast that only appears sometimes.
 */
function ProfileSubmenu({ project }: { project: Project }) {
	const queryClient = useQueryClient();
	const profiles = useQuery({
		queryKey: queryKeys.profiles(),
		queryFn: () => cmd.listProfiles(),
		// Read by every project row's menu, so one fetch answers all of them; the
		// list changes only when Settings writes it, which invalidates this key.
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
	const assign = useMutation({
		mutationFn: (profileId: string | null) => cmd.setProjectProfile(project.id, profileId),
		// `projects` carries the assignment, and the sidebar draws this menu from
		// it — so the label under the cursor is what invalidating refreshes.
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.projects() });
			void queryClient.invalidateQueries({ queryKey: queryKeys.sidebar() });
		},
	});

	const rows = profiles.data ?? [];
	// Nothing to choose between: one profile is the state every install starts in,
	// and a submenu whose only entry is the one already in force is a dead end.
	if (rows.length < 2) return null;

	return (
		<ContextMenuSub>
			<ContextMenuSubTrigger data-testid={`project-profile-${project.id}`}>
				<IdCard />
				Profile
				<span className="ml-auto pl-2 text-muted-foreground text-xs">
					{project.profileName ?? 'Default'}
				</span>
			</ContextMenuSubTrigger>
			<ContextMenuSubContent className="w-56">
				<ContextMenuItem
					data-testid={`project-profile-default-${project.id}`}
					disabled={project.profileId === null}
					onSelect={() => assign.mutate(null)}
				>
					Default profile
				</ContextMenuItem>
				<ContextMenuSeparator />
				{rows.map((profile) => (
					<ContextMenuItem
						key={profile.id}
						data-testid={`project-profile-${project.id}-${profile.id}`}
						disabled={profile.id === project.profileId}
						onSelect={() => assign.mutate(profile.id)}
					>
						{profile.name}
						{profile.isDefault && (
							<span className="ml-auto pl-2 text-muted-foreground text-xs">default</span>
						)}
					</ContextMenuItem>
				))}
				<p className="px-2 pt-1.5 pb-1 text-muted-foreground text-xs">
					Applies to new sessions. A running session keeps the profile it started under.
				</p>
			</ContextMenuSubContent>
		</ContextMenuSub>
	);
}
