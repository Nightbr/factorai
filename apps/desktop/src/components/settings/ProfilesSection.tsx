import type { Profile, Project } from '@factorai/types';
import {
	Button,
	Checkbox,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	IconButton,
	InlineEdit,
	Input,
} from '@factorai/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, MoreHorizontal, Plus, TriangleAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatError } from '@lib/errors';
import { queryKeys } from '@lib/queryKeys';
import { cmd, pickFolder } from '@lib/tauri';

/**
 * The Claude identities on this machine (F25, ADR-0036).
 *
 * **The one section in this modal that writes as you click**, and it says so:
 * everything else here is a draft the footer's Save commits, while a profile is
 * a row in SQLite that other things — the indexer, the next spawn — react to
 * immediately. A draft would have to hold "created but not yet real" for a
 * directory we have already made on disk, which is a state with no honest
 * meaning. Cancel therefore does not undo anything done here, and the note under
 * the list is not decoration.
 *
 * **Nothing here logs in.** Creating a profile makes an empty directory; the CLI
 * populates it on first run and asks for credentials there, which is the only
 * place authentication belongs.
 */
export function ProfilesSection() {
	const queryClient = useQueryClient();
	const [creating, setCreating] = useState(false);
	const [renaming, setRenaming] = useState<string | null>(null);
	const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
	const [assigning, setAssigning] = useState<string | null>(null);
	const [failure, setFailure] = useState<string | null>(null);

	const profiles = useQuery({
		queryKey: queryKeys.profiles(),
		queryFn: () => cmd.listProfiles(),
		retry: false,
	});

	// Every write invalidates the same key, so the list is what the table says
	// rather than what the last mutation thought it would say. Rust also emits
	// `profiles:changed` — that one is for the indexer, and for a *second* window,
	// neither of which this component can speak for.
	const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.profiles() });

	// The reverse view of the project's own right-click menu: one profile, and
	// which projects are on it. Both write the same row; this one exists because
	// assigning six projects to a new profile from six context menus is six trips
	// through the sidebar.
	const projects = useQuery({
		queryKey: queryKeys.projects(),
		queryFn: () => cmd.listProjects(),
		retry: false,
	});
	const assign = useMutation({
		mutationFn: ({ projectId, profileId }: { projectId: string; profileId: string | null }) =>
			cmd.setProjectProfile(projectId, profileId),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.projects() });
			void queryClient.invalidateQueries({ queryKey: queryKeys.sidebar() });
		},
		onError: (e) => setFailure(formatError(e)),
	});

	const rename = useMutation({
		mutationFn: ({ id, name }: { id: string; name: string }) => cmd.renameProfile(id, name),
		onSuccess: () => void refresh(),
		onError: (e) => setFailure(formatError(e)),
	});
	const makeDefault = useMutation({
		mutationFn: (id: string) => cmd.setDefaultProfile(id),
		onSuccess: () => void refresh(),
		onError: (e) => setFailure(formatError(e)),
	});
	const remove = useMutation({
		mutationFn: (id: string) => cmd.deleteProfile(id),
		onSuccess: () => {
			setConfirmingDelete(null);
			void refresh();
		},
		onError: (e) => setFailure(formatError(e)),
	});

	const rows = profiles.data ?? [];

	return (
		<div className="space-y-2">
			<div className="flex items-baseline justify-between gap-2">
				<p className="text-muted-foreground text-xs">
					Each profile is a separate Claude login, kept apart by its own config directory. Projects
					with no profile of their own use the default.
				</p>
				<Button
					size="sm"
					variant="outline"
					className="shrink-0"
					data-testid="profiles-new"
					onClick={() => {
						setFailure(null);
						setCreating(true);
					}}
				>
					<Plus />
					New
				</Button>
			</div>

			{profiles.isPending ? (
				<p className="py-4 text-center text-muted-foreground text-sm">Loading…</p>
			) : (
				<ul className="divide-y divide-border" data-testid="profiles-list">
					{rows.map((profile) => (
						<li key={profile.id} data-testid={`profile-row-${profile.id}`} className="py-2">
							<div className="flex items-center gap-2">
								<div className="min-w-0 flex-1">
									{renaming === profile.id ? (
										<InlineEdit
											value={profile.name}
											aria-label="Profile name"
											data-testid="profile-rename"
											onCommit={(name) => rename.mutate({ id: profile.id, name })}
											onCancel={() => setRenaming(null)}
										/>
									) : (
										<p className="flex items-center gap-1.5 truncate text-sm">
											{profile.name}
											{profile.isDefault && (
												<span
													data-testid={`profile-default-${profile.id}`}
													className="rounded bg-secondary px-1 py-px text-muted-foreground text-xs uppercase tracking-wide"
												>
													Default
												</span>
											)}
										</p>
									)}
									<p className="flex items-center gap-1 truncate font-mono text-muted-foreground text-xs">
										{/* The agent is shown even though `claude` is the only value
									    today: it is what the row is an identity *for*, and a
									    column that appears later reorganises the table. */}
										<span className="uppercase tracking-wide">{profile.agent}</span>
										<span aria-hidden>·</span>
										<span className="truncate">{profile.configDir}</span>
									</p>
									{profile.missing && (
										// Not an error state: the scan skips this profile rather than
										// reaping its sessions, and the next spawn recreates the
										// directory — where the CLI asking for a login is the correct
										// outcome. Said out loud because "you are logged out" with no
										// reason given is the confusing version of that.
										<p
											data-testid={`profile-missing-${profile.id}`}
											className="flex items-center gap-1 text-muted-foreground text-xs"
										>
											<TriangleAlert className="size-3 shrink-0" />
											That directory is not there. It will be created empty on the next session, and
											Claude will ask you to log in.
										</p>
									)}
								</div>

								{confirmingDelete === profile.id ? (
									// Two steps in the row rather than a dialog on top of a dialog.
									// The write removes a row and nothing on disk, so what needs
									// confirming is the click, not the consequence.
									<div className="flex shrink-0 items-center gap-1">
										<span className="text-muted-foreground text-xs">Delete?</span>
										<Button size="sm" variant="outline" onClick={() => setConfirmingDelete(null)}>
											Cancel
										</Button>
										<Button
											size="sm"
											variant="destructive"
											data-testid="profile-delete-confirm"
											disabled={remove.isPending}
											onClick={() => remove.mutate(profile.id)}
										>
											Delete
										</Button>
									</div>
								) : (
									<>
										{/* The projects on this profile, folded away. Open by default
										    would make a three-profile list a wall of checkboxes, and
										    the usual visit here is about the profiles themselves. */}
										<IconButton
											size="md"
											aria-label={`Projects on ${profile.name}`}
											title="Projects on this profile"
											data-testid={`profile-projects-${profile.id}`}
											onClick={() => setAssigning(assigning === profile.id ? null : profile.id)}
										>
											<ChevronDown
												className={
													assigning === profile.id
														? 'rotate-180 transition-transform'
														: 'transition-transform'
												}
											/>
										</IconButton>
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<IconButton
													size="md"
													aria-label={`Actions for ${profile.name}`}
													data-testid={`profile-menu-${profile.id}`}
												>
													<MoreHorizontal />
												</IconButton>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<DropdownMenuItem
													onSelect={() => {
														setFailure(null);
														setRenaming(profile.id);
													}}
												>
													Rename
												</DropdownMenuItem>
												<DropdownMenuItem
													disabled={profile.isDefault}
													data-testid={`profile-make-default-${profile.id}`}
													onSelect={() => {
														setFailure(null);
														makeDefault.mutate(profile.id);
													}}
												>
													Make default
												</DropdownMenuItem>
												{/* Disabled rather than hidden on the default, so the reason
										    is where the action would have been. Deleting it would
										    leave every unassigned project with no identity to spawn
										    under. */}
												<DropdownMenuItem
													variant="destructive"
													disabled={profile.isDefault}
													data-testid={`profile-delete-${profile.id}`}
													onSelect={() => {
														setFailure(null);
														setConfirmingDelete(profile.id);
													}}
												>
													Delete
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</>
								)}
							</div>

							{assigning === profile.id && (
								<ProjectPicker
									profile={profile}
									projects={projects.data ?? []}
									pending={assign.isPending}
									onToggle={(projectId, on) =>
										assign.mutate({ projectId, profileId: on ? profile.id : null })
									}
								/>
							)}
						</li>
					))}
				</ul>
			)}

			{creating && (
				<CreateProfile
					existing={rows}
					onCancel={() => setCreating(false)}
					onCreated={() => {
						setCreating(false);
						void refresh();
					}}
					onFailure={setFailure}
				/>
			)}

			{failure && (
				<p data-testid="profiles-error" className="text-destructive text-xs">
					{failure}
				</p>
			)}

			<p className="pt-1 text-muted-foreground text-xs">
				Changes here apply immediately, and to <em>new</em> sessions — a running session keeps the
				profile it started under. Deleting a profile leaves its directory, its login and its
				transcripts on disk.
			</p>
		</div>
	);
}

interface ProjectPickerProps {
	profile: Profile;
	projects: Project[];
	pending: boolean;
	onToggle: (projectId: string, on: boolean) => void;
}

/**
 * Which projects run as this profile (F25 slice 3).
 *
 * **Ticking a project already on another profile moves it**, because there is
 * one profile per project per agent — and the row says where it is coming from,
 * so the move is stated rather than confirmed. A dialog per tick would make
 * assigning six projects six dialogs; a label that reads `(on: Personal)` before
 * you click costs nothing and says the same thing earlier.
 *
 * Unticking clears the assignment rather than assigning anything, which is what
 * "no row means the default" looks like from here.
 */
function ProjectPicker({ profile, projects, pending, onToggle }: ProjectPickerProps) {
	if (projects.length === 0) {
		return (
			<p className="pt-1.5 pl-1 text-muted-foreground text-xs">
				No projects yet. Add one and it will show up here.
			</p>
		);
	}
	return (
		<ul
			className="mt-1.5 space-y-0.5 rounded border border-border p-1.5"
			data-testid={`profile-project-picker-${profile.id}`}
		>
			{projects.map((project) => {
				const on = project.profileId === profile.id;
				return (
					<li key={project.id} className="flex items-center gap-2 px-1 py-0.5">
						<Checkbox
							id={`assign-${profile.id}-${project.id}`}
							data-testid={`assign-${profile.id}-${project.id}`}
							checked={on}
							disabled={pending}
							onCheckedChange={(next) => onToggle(project.id, next === true)}
						/>
						<label
							htmlFor={`assign-${profile.id}-${project.id}`}
							className="min-w-0 flex-1 truncate text-sm"
						>
							{project.displayName}
						</label>
						{/* Only for a project that is somewhere else: the tick already says
						    "here", and repeating this profile's own name on every checked
						    row would be noise. */}
						{!on && project.profileName && (
							<span className="shrink-0 text-muted-foreground text-xs">
								on: {project.profileName}
							</span>
						)}
					</li>
				);
			})}
		</ul>
	);
}

interface CreateProfileProps {
	/** For the directory suggestion's uniqueness, so the form does not offer a
	 *  path the command is about to refuse. */
	existing: Profile[];
	onCancel: () => void;
	onCreated: () => void;
	onFailure: (message: string | null) => void;
}

/**
 * Name, then directory.
 *
 * The directory is **suggested from the name and stays editable**: somebody
 * already juggling accounts has a `~/.claude-work` to point at, and a path we
 * derive and lock would make that directory unusable. It stops following the
 * name as soon as it is edited by hand — a suggestion that overwrites what you
 * typed is not a suggestion.
 */
function CreateProfile({ existing, onCancel, onCreated, onFailure }: CreateProfileProps) {
	const [name, setName] = useState('');
	const [dir, setDir] = useState('');
	const [dirEdited, setDirEdited] = useState(false);
	const [saving, setSaving] = useState(false);

	// Asked of Rust rather than built here: the answer starts at `$HOME`, which
	// the renderer has no honest way to know.
	useEffect(() => {
		if (dirEdited) return;
		let live = true;
		const trimmed = name.trim();
		if (!trimmed) {
			setDir('');
			return;
		}
		void cmd
			.suggestProfileDir(trimmed)
			.then((suggested) => {
				if (!live) return;
				// A suggestion that collides with a profile already on that path is
				// one the command would refuse, so it is disambiguated here rather
				// than offered and rejected.
				let candidate = suggested;
				for (let n = 2; existing.some((p) => p.configDir === candidate); n += 1) {
					candidate = `${suggested}-${n}`;
				}
				setDir(candidate);
			})
			.catch(() => {
				// The field is editable and required; an unsuggestible path is not a
				// failure worth a message.
			});
		return () => {
			live = false;
		};
	}, [name, dirEdited, existing]);

	async function submit() {
		onFailure(null);
		setSaving(true);
		try {
			await cmd.createProfile({ name: name.trim(), configDir: dir.trim() });
			onCreated();
		} catch (e) {
			onFailure(formatError(e));
		} finally {
			setSaving(false);
		}
	}

	const ready = name.trim().length > 0 && dir.trim().length > 0 && !saving;

	return (
		<form
			data-testid="profile-create"
			className="space-y-2 rounded border border-border p-2.5"
			onSubmit={(e) => {
				e.preventDefault();
				if (ready) void submit();
			}}
		>
			<div className="flex items-center gap-2">
				<label className="w-20 shrink-0 text-muted-foreground text-xs" htmlFor="profile-name">
					Name
				</label>
				<Input
					id="profile-name"
					data-testid="profile-name"
					autoFocus
					placeholder="Work"
					value={name}
					onChange={(e) => setName(e.target.value)}
				/>
			</div>
			<div className="flex items-center gap-2">
				<label className="w-20 shrink-0 text-muted-foreground text-xs" htmlFor="profile-dir">
					Directory
				</label>
				<Input
					id="profile-dir"
					data-testid="profile-dir"
					className="font-mono text-xs"
					placeholder="~/.factorai/profiles/work"
					value={dir}
					onChange={(e) => {
						setDirEdited(true);
						setDir(e.target.value);
					}}
				/>
				<Button
					type="button"
					size="sm"
					variant="outline"
					className="shrink-0"
					data-testid="profile-dir-browse"
					onClick={() => {
						void pickFolder('Profile config directory').then((picked) => {
							if (!picked) return;
							setDirEdited(true);
							setDir(picked);
						});
					}}
				>
					Browse…
				</Button>
			</div>
			<div className="flex items-center gap-2">
				<p className="min-w-0 flex-1 text-muted-foreground text-xs">
					Created empty. Claude will ask you to log in the first time a session runs under it.
				</p>
				<IconButton size="md" aria-label="Cancel" title="Cancel" onClick={onCancel}>
					<X />
				</IconButton>
				<IconButton
					size="md"
					type="submit"
					aria-label="Create profile"
					title="Create"
					data-testid="profile-create-submit"
					disabled={!ready}
				>
					<Check />
				</IconButton>
			</div>
		</form>
	);
}
