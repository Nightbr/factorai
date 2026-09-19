import { useId } from 'react';
import styles from './hero.module.css';

/**
 * The mark, forged: the master's geometry (`specs/09-branding.md` B2, mirrored
 * by hand as the app's `geometry.ts` is) under a metallic treatment — a brushed
 * dark housing with a bevelled edge, an amber F with its own lip and a drop
 * into the housing, and a specular sweep the strike sets off. This is the
 * marketing-surfaces exception B6 grants in ADR-0051; the ports still cut to
 * the ground and nothing about the shapes changes.
 */
const SIZE = 512;
const RADIUS = 112;
const PORT_DEPTH = 41.6;
const PORT_HEIGHT = 64;
const PORT_Y = [96, 224, 352] as const;
const F_PATH = 'M153.6 136H377.6V198.4H233.6V232H332.8L273.6 291.2H233.6V379.2H153.6Z';

export function MetalMark({ className }: { className?: string }) {
	const id = useId().replace(/:/g, '');
	const ports = `ports-${id}`;
	const housing = `housing-${id}`;
	const bevel = `bevel-${id}`;
	const amber = `amber-${id}`;
	const lip = `lip-${id}`;
	const drop = `drop-${id}`;
	const brush = `brush-${id}`;
	const sheen = `sheen-${id}`;
	const clip = `clip-${id}`;
	return (
		<svg
			className={className}
			viewBox={`0 0 ${SIZE} ${SIZE}`}
			role="img"
			aria-label="factorai"
			data-mark
		>
			<title>factorai</title>
			<defs>
				<mask id={ports}>
					<rect width={SIZE} height={SIZE} rx={RADIUS} fill="#fff" />
					<g fill="#000">
						{PORT_Y.map((y) => (
							<g key={y}>
								<rect x="0" y={y} width={PORT_DEPTH} height={PORT_HEIGHT} />
								<rect x={SIZE - PORT_DEPTH} y={y} width={PORT_DEPTH} height={PORT_HEIGHT} />
							</g>
						))}
					</g>
				</mask>
				<clipPath id={clip}>
					<rect width={SIZE} height={SIZE} rx={RADIUS} />
				</clipPath>
				<linearGradient id={housing} x1="0" y1="0" x2="1" y2="1">
					<stop offset="0" stopColor="#3d434c" />
					<stop offset="0.5" stopColor="#2a2e34" />
					<stop offset="1" stopColor="#1d2025" />
				</linearGradient>
				<linearGradient id={bevel} x1="0" y1="0" x2="1" y2="1">
					<stop offset="0" stopColor="#ffffff" stopOpacity="0.42" />
					<stop offset="0.45" stopColor="#ffffff" stopOpacity="0.04" />
					<stop offset="0.6" stopColor="#000000" stopOpacity="0.1" />
					<stop offset="1" stopColor="#000000" stopOpacity="0.55" />
				</linearGradient>
				<linearGradient id={amber} x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stopColor="#ffc845" />
					<stop offset="0.55" stopColor="#ffb020" />
					<stop offset="1" stopColor="#e89a0c" />
				</linearGradient>
				<linearGradient id={lip} x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stopColor="#fff2c8" stopOpacity="0.85" />
					<stop offset="0.35" stopColor="#ffffff" stopOpacity="0" />
					<stop offset="1" stopColor="#7a4a00" stopOpacity="0.55" />
				</linearGradient>
				<linearGradient id={sheen} x1="0" y1="0" x2="1" y2="0.35">
					<stop offset="0" stopColor="#ffffff" stopOpacity="0" />
					<stop offset="0.5" stopColor="#ffffff" stopOpacity="0.28" />
					<stop offset="1" stopColor="#ffffff" stopOpacity="0" />
				</linearGradient>
				<filter id={drop} x="-10%" y="-10%" width="120%" height="130%">
					<feDropShadow dx="0" dy="6" stdDeviation="5" floodColor="#000" floodOpacity="0.55" />
				</filter>
				<filter id={brush} x="0" y="0" width="100%" height="100%">
					<feTurbulence type="fractalNoise" baseFrequency="0.004 0.6" numOctaves="2" seed="7" />
					<feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.09 0" />
				</filter>
			</defs>
			<g mask={`url(#${ports})`}>
				<rect width={SIZE} height={SIZE} fill={`url(#${housing})`} />
				<rect width={SIZE} height={SIZE} filter={`url(#${brush})`} />
				<g clipPath={`url(#${clip})`}>
					<rect
						width={SIZE}
						height={SIZE}
						rx={RADIUS}
						fill="none"
						stroke={`url(#${bevel})`}
						strokeWidth="14"
					/>
				</g>
				<path d={F_PATH} fill={`url(#${amber})`} filter={`url(#${drop})`} />
				<path d={F_PATH} fill="none" stroke={`url(#${lip})`} strokeWidth="5" />
				<rect
					data-sheen
					x="-420"
					y="-100"
					width="260"
					height="720"
					fill={`url(#${sheen})`}
					transform="skewX(-24)"
					className={styles.sheen}
				/>
			</g>
		</svg>
	);
}
