import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { FOG_FRAGMENT, FOG_VERTEX } from './fogShader';

interface FogUniforms {
	progress: number;
	density: number;
	warm: number;
}

export interface FogHandle {
	set: (u: Partial<FogUniforms>) => void;
}

interface Props {
	className?: string;
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
	const shader = gl.createShader(type);
	if (!shader) return null;
	gl.shaderSource(shader, src);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		console.error(gl.getShaderInfoLog(shader));
		gl.deleteShader(shader);
		return null;
	}
	return shader;
}

/**
 * Full-viewport WebGL fog. Uniforms are pushed imperatively through the handle
 * from the GSAP timeline; nothing here goes through React state per frame.
 */
export const Fog = forwardRef<FogHandle, Props>(function Fog({ className }, ref) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const uniforms = useRef<FogUniforms>({ progress: 0, density: 1, warm: 0 });

	useImperativeHandle(ref, () => ({
		set: (u) => {
			Object.assign(uniforms.current, u);
		},
	}));

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const gl = canvas.getContext('webgl', {
			alpha: true,
			premultipliedAlpha: true,
			antialias: false,
		});
		if (!gl) return;

		const vs = compile(gl, gl.VERTEX_SHADER, FOG_VERTEX);
		const fs = compile(gl, gl.FRAGMENT_SHADER, FOG_FRAGMENT);
		if (!vs || !fs) return;
		const program = gl.createProgram();
		if (!program) return;
		gl.attachShader(program, vs);
		gl.attachShader(program, fs);
		gl.linkProgram(program);
		gl.useProgram(program);

		const buf = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
		const aPos = gl.getAttribLocation(program, 'a_pos');
		gl.enableVertexAttribArray(aPos);
		gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

		const uRes = gl.getUniformLocation(program, 'u_res');
		const uTime = gl.getUniformLocation(program, 'u_time');
		const uProgress = gl.getUniformLocation(program, 'u_progress');
		const uDensity = gl.getUniformLocation(program, 'u_density');
		const uWarm = gl.getUniformLocation(program, 'u_warm');
		const uGrid = gl.getUniformLocation(program, 'u_grid');

		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

		// Render at most at 1.5x device pixels: the fog is soft and never needs
		// more, and a phone's GPU is what pays for it.
		const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
		const resize = () => {
			const w = Math.floor(canvas.clientWidth * dpr);
			const h = Math.floor(canvas.clientHeight * dpr);
			if (canvas.width !== w || canvas.height !== h) {
				canvas.width = w;
				canvas.height = h;
				gl.viewport(0, 0, w, h);
			}
		};
		resize();
		window.addEventListener('resize', resize);

		let frame = 0;
		const start = performance.now();
		const draw = (now: number) => {
			const u = uniforms.current;
			// Skip work when the fog is fully cleared; the canvas stays transparent.
			if (u.density > 0.001) {
				resize();
				gl.uniform2f(uRes, canvas.width, canvas.height);
				gl.uniform1f(uTime, (now - start) / 1000);
				gl.uniform1f(uProgress, u.progress);
				gl.uniform1f(uDensity, u.density);
				gl.uniform1f(uWarm, u.warm);
				gl.uniform1f(uGrid, 4 * dpr);
				gl.drawArrays(gl.TRIANGLES, 0, 3);
			} else {
				gl.clearColor(0, 0, 0, 0);
				gl.clear(gl.COLOR_BUFFER_BIT);
			}
			frame = requestAnimationFrame(draw);
		};
		frame = requestAnimationFrame(draw);

		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener('resize', resize);
			gl.deleteProgram(program);
			gl.deleteShader(vs);
			gl.deleteShader(fs);
			gl.deleteBuffer(buf);
		};
	}, []);

	return <canvas ref={canvasRef} className={className} />;
});
