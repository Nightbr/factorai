import { ProjectIcon } from '@components/layout/ProjectIcon';
import { ProjectMenu } from '@components/layout/ProjectMenu';
import { SessionList } from '@components/layout/SidebarProject';
import type { Project, TerminalStatus } from '@factorai/types';
import {
	ContextMenu,
	ContextMenuTrigger,
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
	IconButton,
} from '@factorai/ui';
import { useStartSession } from '@hooks/useStartSession';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';

interface SidebarRailGlyphProps {
	project: Project;
	isActive: boolean;
	/** Whether *this* glyph's card is the one showing. Hoisted to the rail so
	 *  that at most one is open: see `onOpenChange`. */
	open: boolean;
	/** Radix reports its own delayed decisions here; the rail decides what they
	 *  mean for the set. The 400ms close exists so you can cross the gap into a
	 *  card (F1), but applied between two glyphs it would leave the old card up
	 *  for a third of a second after the new one had opened — two cards on
	 *  screen, describing different projects. Opening one is therefore the same
	 *  event as closing the last, with no delay on that half. */
	onOpenChange: (open: boolean) => void;
	/** Worst-status-wins roll-up of this project's live sessions, or undefined
	 *  when it has none (F10). Badged on the avatar, which is the whole reason a
	 *  rail can afford to drop the rows: knowing which project has a live
	 *  terminal comes for free with the icon. */
	liveStatus?: TerminalStatus;
}

/**
 * One project in the collapsed sidebar (F1, ADR-0038).
 *
 * **It routes, and the rail stays a rail.** Clicking does not expand: you
 * collapsed the sidebar to get the pixels back, and a click that hands them
 * away undoes the thing you asked for. The sidebar is the app's navigation, so
 * the rail has to *be* navigation rather than a launcher that destroys itself
 * on first use.
 *
 * **What a 48px column cannot show, the hover card shows.** The objection to a
 * rail is that a project's sessions disappear, and a rail that nests them is a
 * tree at 48px. A card is neither: it lists the same sessions the expanded row
 * lists, by the same rules (`SessionList`, `flat`), and it carries the row's
 * own `+` so the one thing you come to a project to do is still one click away.
 * It opens on focus as well as hover, and its content is focusable, so the
 * sessions inside it are reachable from the keyboard.
 */
export function SidebarRailGlyph({
	project,
	isActive,
	open,
	onOpenChange,
	liveStatus,
}: SidebarRailGlyphProps) {
	const startSession = useStartSession();

	return (
		// **The close delay is the whole usability of this card.** The pointer has
		// to cross the gap between a 48px column and the card to reach anything in
		// it, and a hover surface that closes the moment you leave the trigger is
		// one you can look at and never touch. 400ms also forgives the overshoot
		// you make aiming at a 26px row.
		<HoverCard open={open} onOpenChange={onOpenChange} openDelay={220} closeDelay={400}>
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<HoverCardTrigger asChild>
						<Link
							to="/projects/$id"
							params={{ id: project.id }}
							// A native anchor is draggable by default and that drag is the
							// HTML5 one, dead in this shell on macOS (ADR-0016). Nothing here
							// reorders anyway — see `ProjectMenu`'s missing `arrange` — but a
							// ghost drag image on every glyph is worse than no gesture.
							draggable={false}
							title={project.displayName}
							data-testid={`rail-glyph-${project.id}`}
							className={`flex h-9 w-full items-center justify-center rounded-md transition-colors ${
								isActive ? 'bg-secondary' : 'hover:bg-secondary/50'
							}`}
						>
							{/* 20px, the size the expanded row draws it at. Collapsing takes
							    the label away, not the identity, so the glyph has no reason
							    to grow (DESIGN.md, the rail). */}
							<ProjectIcon
								name={project.displayName}
								path={project.realPath}
								size={20}
								status={liveStatus}
							/>
						</Link>
					</HoverCardTrigger>
				</ContextMenuTrigger>
				{/* No `arrange`: reordering is off while collapsed, gesture and
				    keyboard path together. */}
				<ProjectMenu project={project} />
			</ContextMenu>

			<HoverCardContent side="right" align="start" sideOffset={12} className="w-64 p-1">
				<div className="flex items-center gap-2 px-2 pt-1 pb-1.5">
					<p className="min-w-0 flex-1 truncate font-medium text-sm">{project.displayName}</p>
					{/* The row's own `+`, verbatim (F2): same label, same call, same gate
					    on a `missing` folder. Without it the card reads a project's
					    sessions and cannot add one, which is the single most common
					    thing done from that row — and for a project with none yet it is
					    the whole of what the card has to offer. */}
					<IconButton
						aria-label={`New session in ${project.displayName}`}
						title={`New session in ${project.displayName}`}
						data-testid={`rail-new-session-${project.id}`}
						disabled={project.missing}
						onClick={() => void startSession(project.id)}
					>
						<Plus />
					</IconButton>
				</div>
				{/* `depth` is inert under `flat` — there is no guide to place and no
				    indent to pick — but the prop is required, so it says 0. */}
				<SessionList project={project} depth={0} variant="flat" />
			</HoverCardContent>
		</HoverCard>
	);
}
