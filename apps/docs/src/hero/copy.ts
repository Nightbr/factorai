/**
 * The five steps' words. Step 3 is the README hook verbatim, per
 * `specs/09-branding.md` B10; the rest was chosen on 2026-09-19 from two
 * prototyped lead sets (roadmap item 58).
 */
export interface HeroCopy {
	/** Step 1: on the fog. */
	fog1: string;
	/** Step 2: after the sweep. */
	fog2: string;
	/** Step 3: the slam. */
	dead: string;
	/** Step 4: the answer — the phrase in white, the acronym in amber — and its expansion. */
	longLive: string;
	acronym: string;
	expansion: string;
	/** Step 5: after the strike. */
	forged: string;
}

export const COPY: HeroCopy = {
	fog1: 'AI has completely changed how we build software, at a pace we have never seen before.',
	fog2: 'Surviving this era means moving at its pace. Our tools were built for a slower one.',
	dead: 'IDE is dead',
	longLive: 'Long live the',
	acronym: 'ADE',
	expansion: 'Agentic Development Environment',
	forged: 'Forged for the agentic era.',
};
