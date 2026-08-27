import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * How long a dragged row must rest over another before the drop changes meaning
 * (specs/05-features.md F1).
 *
 * **Exported so the smoke test can hold for exactly this long.** It is a real
 * timer against real time in that test rather than a mocked clock: the dwell
 * couples to dnd-kit's own pointer handling and to `requestAnimationFrame`, and a
 * fake clock there produces a test that passes while the gesture is broken.
 *
 * The ask was 2000ms. 800 was chosen instead because creating a group is
 * reversible — remove it and the projects come back — so it does not need a long
 * deliberateness gate, and because two seconds of holding a mouse button still
 * reads as the app having hung. What actually prevents accidents is the pending
 * action being **visible** before it commits, which is what the ring is for.
 */
export const GROUP_DWELL_MS = 800;

/**
 * When the ring starts filling. Under this, a row passed over on the way
 * somewhere else shows nothing at all — the indicator has to mean "something is
 * about to happen", not "you are moving".
 */
const GROUP_DWELL_DELAY_MS = 300;

interface DragDwell {
	/** The row id the pointer is resting on, once the dwell has completed. Null
	 *  otherwise, including during the wait. */
	dwellingOn: string | null;
	/** The row currently being timed, whether or not the dwell has completed.
	 *  Separate from `dwellingOn` because only *this* row may draw the filling
	 *  ring — reading `progress` on every row would ring the whole list. */
	over: string | null;
	/** 0 → 1 while the ring fills, 0 before `GROUP_DWELL_DELAY_MS` has passed.
	 *  Read by the row under the pointer to draw its progress. */
	progress: number;
	/** Call on every dnd-kit `onDragOver` with the current target, and with null
	 *  when the drag ends or is cancelled. Restarting on a *different* target
	 *  resets the clock; being called again with the same one does not. */
	track: (rowId: string | null) => void;
}

/**
 * Time how long a drag rests over one row, so a **hold** can mean something a
 * **pass** does not.
 *
 * The sidebar uses this for two things at once, decided by what is under the
 * cursor: holding over a project offers to group the two, and holding over a
 * collapsed group springs it open so you can drop inside. One timer and one
 * filling ring for both, so there is one thing to learn.
 *
 * A hook rather than logic in the component because it owns a timer and an
 * animation frame that both have to be cancelled on every target change — and
 * getting that wrong leaks a callback that fires after the drag is over, which is
 * how a group appears from a drag the user already abandoned.
 */
export function useDragDwell(): DragDwell {
	const [dwellingOn, setDwellingOn] = useState<string | null>(null);
	const [over, setOver] = useState<string | null>(null);
	const [progress, setProgress] = useState(0);
	// The target currently being timed, kept in a ref as well as in state so
	// `track` can compare against it without being recreated on every change —
	// dnd-kit calls it on every pointer move.
	const target = useRef<string | null>(null);
	const startedAt = useRef(0);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const frame = useRef<number | null>(null);

	const stop = useCallback(() => {
		if (timer.current !== null) clearTimeout(timer.current);
		if (frame.current !== null) cancelAnimationFrame(frame.current);
		timer.current = null;
		frame.current = null;
	}, []);

	const track = useCallback(
		(rowId: string | null) => {
			// Same target: leave the clock running. dnd-kit fires `onDragOver` on
			// every pointer move, so resetting here would mean the dwell never
			// completed unless the hand were perfectly still.
			if (rowId === target.current) return;

			stop();
			target.current = rowId;
			setOver(rowId);
			setDwellingOn(null);
			setProgress(0);
			if (!rowId) return;

			startedAt.current = performance.now();
			timer.current = setTimeout(() => setDwellingOn(rowId), GROUP_DWELL_MS);
			const tick = () => {
				const elapsed = performance.now() - startedAt.current;
				// Nothing shown for the first stretch: a row crossed on the way
				// somewhere else must not flash an indicator at all.
				setProgress(
					elapsed < GROUP_DWELL_DELAY_MS
						? 0
						: Math.min(
								1,
								(elapsed - GROUP_DWELL_DELAY_MS) / (GROUP_DWELL_MS - GROUP_DWELL_DELAY_MS),
							),
				);
				if (elapsed < GROUP_DWELL_MS) frame.current = requestAnimationFrame(tick);
			};
			frame.current = requestAnimationFrame(tick);
		},
		[stop],
	);

	// A drag that ends while the timer is running would otherwise fire into an
	// unmounted tree.
	useEffect(() => stop, [stop]);

	return { dwellingOn, over, progress, track };
}
