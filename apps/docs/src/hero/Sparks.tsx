import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export interface SparksHandle {
	/** Burst at a point given in canvas-relative CSS pixels. */
	burst: (x: number, y: number) => void;
	/**
	 * Burst along the edges of a rectangle (centre, width, height in CSS px):
	 * what a face slamming a plate throws — sparks squeezed out at the rim.
	 */
	burstEdges: (cx: number, cy: number, w: number, h: number) => void;
}

interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	max: number;
	size: number;
	hot: boolean;
}

/** Canvas 2D spark particles for the strike. Amber and white-hot, with gravity. */
export const Sparks = forwardRef<SparksHandle, { className?: string }>(function Sparks(
	{ className },
	ref,
) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const particles = useRef<Particle[]>([]);
	const frame = useRef(0);
	const last = useRef(0);

	const start = () => {
		if (!frame.current) {
			last.current = performance.now();
			frame.current = requestAnimationFrame(tick);
		}
	};

	const emit = (x: number, y: number, angle: number, spread: number) => {
		const a = angle + (Math.random() - 0.5) * spread;
		const speed = 320 + Math.random() * 680;
		particles.current.push({
			x,
			y,
			vx: Math.cos(a) * speed,
			vy: Math.sin(a) * speed,
			life: 0,
			max: 0.45 + Math.random() * 0.75,
			size: 1 + Math.random() * 2.2,
			hot: Math.random() < 0.3,
		});
	};

	useImperativeHandle(ref, () => ({
		burst: (x, y) => {
			for (let i = 0; i < 90; i++) emit(x, y, -Math.PI / 2, Math.PI * 1.4);
			start();
		},
		burstEdges: (cx, cy, w, h) => {
			const hw = w / 2;
			const hh = h / 2;
			const perEdge = 34;
			for (let i = 0; i < perEdge; i++) {
				const t = (i + Math.random()) / perEdge;
				// Outward from each edge, biased upward so most of it reads as
				// flying up and out rather than falling straight down.
				emit(cx - hw + w * t, cy - hh, -Math.PI / 2, 1.1);
				emit(cx - hw + w * t, cy + hh, Math.PI / 2, 1.1);
				emit(cx - hw, cy - hh + h * t, Math.PI, 1.1);
				emit(cx + hw, cy - hh + h * t, 0, 1.1);
			}
			start();
		},
	}));

	const tick = (now: number) => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext('2d');
		if (!canvas || !ctx) {
			frame.current = 0;
			return;
		}
		const dpr = window.devicePixelRatio || 1;
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
			canvas.width = Math.floor(w * dpr);
			canvas.height = Math.floor(h * dpr);
		}
		const dt = Math.min((now - last.current) / 1000, 0.05);
		last.current = now;

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, w, h);
		ctx.globalCompositeOperation = 'lighter';

		const alive: Particle[] = [];
		for (const p of particles.current) {
			p.life += dt;
			if (p.life > p.max) continue;
			p.vy += 1500 * dt;
			p.vx *= 1 - 1.6 * dt;
			p.x += p.vx * dt;
			p.y += p.vy * dt;
			const t = p.life / p.max;
			const a = (1 - t) * (1 - t);
			ctx.strokeStyle = p.hot
				? `rgba(255, 244, 214, ${a})`
				: `rgba(255, ${Math.round(176 - 90 * t)}, ${Math.round(32 * (1 - t))}, ${a})`;
			ctx.lineWidth = p.size * (1 - t * 0.6);
			ctx.beginPath();
			ctx.moveTo(p.x, p.y);
			ctx.lineTo(p.x - p.vx * 0.018, p.y - p.vy * 0.018);
			ctx.stroke();
			alive.push(p);
		}
		particles.current = alive;
		if (alive.length > 0) {
			frame.current = requestAnimationFrame(tick);
		} else {
			ctx.clearRect(0, 0, w, h);
			frame.current = 0;
		}
	};

	useEffect(() => () => cancelAnimationFrame(frame.current), []);

	return <canvas ref={canvasRef} className={className} />;
});
