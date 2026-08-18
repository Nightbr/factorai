import type { GitGraphEdge } from '@factorai/types';
import {
	AVATAR_MIN_PITCH,
	AVATAR_RADIUS,
	AVATAR_RING,
	laneCentre,
	laneColour,
} from '@lib/gitGraph';

/** Row height, matching the 26px the file tree and Changes rows come out at
 *  (`py-[3px]` on `text-sm`). Hardcoded here because the SVG needs a number and
 *  reading it back off the DOM per row would be a layout thrash per poll. */
export const ROW_HEIGHT = 26;

/** Radius of a commit's node. Small enough to sit inside a 6px pitch without
 *  touching its neighbour. */
const NODE_RADIUS = 2.75;

/** Stroke width for lane lines. Under 1.5 the colour reads washed out at these
 *  sizes, which defeats the point of having colours. */
const STROKE = 1.5;

/** What the node at this row's lane is. */
type RailNode =
	/** An ordinary commit, drawn as its author. */
	| { kind: 'commit'; colour: string; initials: string }
	/** HEAD, with uncommitted changes sitting on top of it. */
	| { kind: 'dirty' }
	/** The synthetic working-changes row above HEAD. */
	| { kind: 'working' };

interface GraphRailProps {
	lane: number;
	edges: GitGraphEdge[];
	pitch: number;
	width: number;
	node: RailNode;
}

/**
 * One row's slice of the lane rail (specs/05-features.md F18).
 *
 * Each edge is drawn as a cubic curve rather than a polyline: a diagonal joining
 * two lanes over 26px reads as a kink, and the curve is what makes a merge look
 * like a merge. Straight `through` lines are emitted as straight lines anyway,
 * which is most of them.
 *
 * Lane assignment is not here — it arrives in the payload from Rust (Q23). This
 * turns lane indices into pixels and nothing else.
 */
export function GraphRail({ lane, edges, pitch, width, node }: GraphRailProps) {
	const centre = (index: number) => laneCentre(index, pitch);
	const mid = ROW_HEIGHT / 2;
	const cx = centre(lane);
	const colour = laneColour(lane);
	const showAvatar = node.kind === 'commit' && pitch >= AVATAR_MIN_PITCH;

	return (
		<svg
			width={width}
			height={ROW_HEIGHT}
			viewBox={`0 0 ${width} ${ROW_HEIGHT}`}
			data-testid="graph-rail"
			className="shrink-0"
			// The rail is decoration for the refs and subject beside it, which carry
			// the same information in text. Announcing 20 unlabelled paths per row
			// would make the list unusable with a screen reader.
			aria-hidden="true"
		>
			{edges.map((edge, index) => (
				<path
					// Edges have no identity of their own — they are derived from the
					// row's lanes every poll, so the index *is* the identity.
					key={`${edge.kind}:${edge.fromLane}:${edge.toLane}:${index}`}
					d={pathFor(edge, centre, mid)}
					fill="none"
					stroke={laneColour(edge.lane)}
					strokeWidth={STROKE}
					strokeLinecap="round"
				/>
			))}

			{showAvatar && node.kind === 'commit' ? (
				<g>
					{/* **Ring in the lane's colour, disc in the author's** (changed
					    2026-08-18 on user feedback). The ring used to be the row's
					    background, cutting the lines behind the disc so they didn't
					    appear to touch it — which read as the node being *detached* from
					    the line it sits on, the one relationship the rail exists to show.
					    Painting it the lane's colour lets the line run into the node
					    instead, and still hides whatever passes behind.

					    The disc keeps the author's hue, so both questions stay
					    answerable at a glance: the ring says which lane, the disc says
					    who. Making the disc itself the lane colour would have cost
					    "scan for the ones I did", which is why the node became an
					    avatar in the first place (F18 § The node is its author). */}
					<circle
						cx={cx}
						cy={mid}
						r={AVATAR_RADIUS}
						fill={node.colour}
						stroke={colour}
						strokeWidth={AVATAR_RING}
					/>
					<text
						x={cx}
						y={mid}
						textAnchor="middle"
						dominantBaseline="central"
						// 9px is below our type scale on purpose: this is a glyph pair
						// inside an 18px disc, not text anyone reads as text.
						fontSize={9}
						fontWeight={600}
						fill="var(--card)"
					>
						{node.initials}
					</text>
				</g>
			) : (
				<circle
					cx={cx}
					cy={mid}
					r={NODE_RADIUS}
					// Hollow marks a commit that what is on disk has moved past; the
					// working row's node is hollow and dashed, since it is not a commit
					// at all and should not look like one.
					fill={node.kind === 'commit' ? colour : 'var(--card)'}
					stroke={colour}
					strokeWidth={STROKE}
					strokeDasharray={node.kind === 'working' ? '2 1.5' : undefined}
				/>
			)}
		</svg>
	);
}

function pathFor(edge: GitGraphEdge, centre: (index: number) => number, mid: number): string {
	const from = centre(edge.fromLane);
	const to = centre(edge.toLane);

	if (edge.kind === 'through') {
		return `M ${from} 0 L ${from} ${ROW_HEIGHT}`;
	}
	// An incoming edge arrives from the row above and stops at the node; an
	// outgoing one starts there and leaves through the bottom. Splitting them this
	// way is why a tip has no stub above it and a root none below.
	const [startY, endY] = edge.kind === 'incoming' ? [0, mid] : [mid, ROW_HEIGHT];
	if (from === to) return `M ${from} ${startY} L ${to} ${endY}`;

	// Control points on the vertical through each endpoint, so the curve leaves
	// and arrives parallel to its own lane and the join reads as a branch rather
	// than a corner.
	const bend = (endY - startY) / 2;
	return `M ${from} ${startY} C ${from} ${startY + bend}, ${to} ${endY - bend}, ${to} ${endY}`;
}
