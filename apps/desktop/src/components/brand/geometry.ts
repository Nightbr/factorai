/**
 * The mark's geometry, mirrored by hand from `docs/brand/factorai-icon.svg`.
 *
 * Hand-mirrored rather than imported, for the same reason the IPC types are
 * (the `backend-conventions` skill): the renderer gets a real component that inherits
 * `currentColor` and carries no build-time asset plumbing, and the duplication
 * is held honest by `geometry.test.ts`, which fails the moment this file and
 * the master SVG disagree.
 *
 * The construction — and why the F's numbers look wrong to a ruler — is
 * `specs/09-branding.md` § B2. Do not adjust anything here without changing the
 * master first; the master is what every shipped icon is generated from.
 */

/** The mark is drawn on a 16x16 cell grid; one cell is 32 units. */
export const MARK_SIZE = 512;

/** 3.5 cells. */
export const MARK_CORNER_RADIUS = 112;

/** Ports: 1.3 cells deep, 2 cells tall, at y = 3, 7 and 11 cells. */
export const MARK_PORT_DEPTH = 41.6;
export const MARK_PORT_HEIGHT = 64;
export const MARK_PORT_Y = [96, 224, 352] as const;

/** The F. Wide, high crossbar, mid-arm terminal cut at 45 degrees. */
export const MARK_F_PATH = 'M153.6 136H377.6V198.4H233.6V232H332.8L273.6 291.2H233.6V379.2H153.6Z';

/**
 * The one-colour cut: a full-bleed square with the F punched out of it, clipped
 * to the notched housing by the ports mask. `evenodd` is what makes the F a
 * hole rather than a second filled shape.
 */
export const MARK_HOUSING_PATH = `M0 0H${MARK_SIZE}V${MARK_SIZE}H0Z${MARK_F_PATH}`;

/** Full-colour values, for the contexts that want the app icon rather than the mark. */
export const MARK_HOUSING_FILL = '#272B31';
export const MARK_F_FILL = '#FFB020';
