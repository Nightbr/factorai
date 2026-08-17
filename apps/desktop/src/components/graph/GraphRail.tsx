import type { GitGraphEdge } from '@factorai/types';
import { laneColour } from '@lib/gitGraph';

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

interface GraphRailProps {
	lane: number;
	edges: GitGraphEdge[];
	pitch: number;
	width: number;
	/** Draw the node hollow, to mark uncommitted changes sitting on top of it. */
	dirty: boolean;
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
export function GraphRail({ lane, edges, pitch, width, dirty }: GraphRailProps) {
	const centre = (index: number) => pitch / 2 + index * pitch;
	const mid = ROW_HEIGHT / 2;

	return (
		<svg
			width={width}
			height={ROW_HEIGHT}
			viewBox={`0 0 ${width} ${ROW_HEIGHT}`}
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
			<circle
				cx={centre(lane)}
				cy={mid}
				r={NODE_RADIUS}
				// A hollow node is the dirty marker: the commit is there, but what is
				// on disk has moved past it. Filled is the ordinary case.
				fill={dirty ? 'var(--card)' : laneColour(lane)}
				stroke={laneColour(lane)}
				strokeWidth={STROKE}
			/>
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
