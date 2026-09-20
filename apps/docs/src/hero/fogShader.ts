/**
 * Digital fog. Two layers of domain-warped fbm noise with a soft light from
 * above, so the volume reads as smoke rather than as blobs; a fine grid and a
 * slow scanline drawn through it are the "digital" half. A band sweeps left to
 * right with `u_progress` and thickens the fog under it; `u_warm` mixes amber
 * into the cool grey as step 2 approaches. Amber lightning strikes inside the
 * fog on a hashed schedule, and everything dies with `u_density`.
 */
export const FOG_VERTEX = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

export const FOG_FRAGMENT = `
precision highp float;

uniform vec2 u_res;
uniform float u_time;
uniform float u_progress;
uniform float u_density;
uniform float u_warm;
uniform float u_grid;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Linear interpolation on purpose: the kinks are what make a bolt a bolt.
float lnoise(float x, float seed) {
  float i = floor(x);
  return mix(hash(vec2(i, seed)), hash(vec2(i + 1.0, seed)), fract(x));
}

const mat2 ROT = mat2(0.8, 0.6, -0.6, 0.8);

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 6; i++) {
    v += amp * vnoise(p);
    p = ROT * p * 2.02 + vec2(1.7, 9.2);
    amp *= 0.46;
  }
  return v;
}

// Domain warping: noise displaced by noise. This is what gives smoke its
// curls; plain fbm only gives it lumps.
float smoke(vec2 p, float t) {
  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.3)), fbm(p + vec2(5.2, 1.3) - t * 0.2));
  vec2 r = vec2(fbm(p + 1.5 * q + vec2(1.7, 9.2) + t * 0.15), fbm(p + 1.5 * q + vec2(8.3, 2.8) - t * 0.1));
  return fbm(p + 1.3 * r);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  // Feature size follows the short side, so a portrait phone gets the same
  // curls as a landscape screen rather than a strip of them.
  vec2 p = vec2(uv.x * aspect, uv.y) / min(aspect, 1.0);
  float portrait = 1.0 + 0.45 * (1.0 - min(aspect, 1.0));
  float t = u_time * 0.09;

  // Two layers at different scales, the near one drifting faster.
  float far = smoke(p * 1.0 + vec2(t * 0.25, 0.0), t);
  float near = smoke(p * 1.9 + vec2(-t * 0.45, t * 0.12) + 4.0, t * 1.4);
  float n = far * 0.65 + near * 0.35;
  n = smoothstep(0.22, 0.78, n);

  // The sweeping band: a soft wall of fog crossing the screen with progress.
  float band = mix(-0.55, 1.55, u_progress);
  float wall = smoothstep(0.55, 0.0, abs(uv.x - band) - 0.12 * n);
  float behind = smoothstep(band + 0.15, band - 0.35, uv.x);

  // Density: heaviest low and at the edges; the band adds its wall and clears
  // what it has passed.
  float base = n * (0.5 + 0.5 * (1.0 - uv.y)) * u_density * portrait;
  float d = base * (1.0 - 0.85 * behind) + wall * 0.9 * u_density * (0.35 + 0.65 * n);
  d = clamp(d, 0.0, 1.0);

  // Lit from above: the gradient of the near layer against a light sitting
  // high and slightly left, so the fog has a bright side and a shadowed one.
  float e = 0.05;
  float lit = smoke(p * 1.9 + vec2(-t * 0.45, t * 0.12) + 4.0 + vec2(-e, e), t * 1.4) - near;
  float shade = 0.82 + clamp(lit * 7.0, -0.3, 0.4);

  vec3 cool = vec3(0.60, 0.65, 0.74);
  vec3 amber = vec3(1.0, 0.69, 0.125);
  vec3 col = mix(cool, amber, u_warm * 0.55) * shade;

  // Lightning. Two schedules on hashed time slots: cloud lightning — a
  // sheet that lights the fog from inside, shaped by the fog itself, no bolt —
  // fires often; a bolt dropping from a strike point is rare. Both flicker
  // and decay, and both die with the fog.
  float slotLen = 0.45;
  float slot = floor(u_time / slotLen);
  float ph = fract(u_time / slotLen);
  float flicker = 0.55 + 0.45 * step(0.5, fract(ph * 11.0 + hash(vec2(slot, 3.7))));
  float decay = exp(-ph * 6.0) * flicker;

  float cloudOn = step(0.7, hash(vec2(slot, 7.3)));
  vec2 cloudAt = vec2(0.1 + 0.8 * hash(vec2(slot, 1.1)), 0.45 + 0.5 * hash(vec2(slot, 2.2)));
  float cloudDist = length((uv - cloudAt) * vec2(aspect, 1.0));
  float cloud = cloudOn * decay * smoothstep(0.9, 0.0, cloudDist) * (0.2 + 0.8 * n) * u_density;

  float boltOn = step(0.93, hash(vec2(slot, 9.9)));
  vec2 origin = vec2(0.15 + 0.7 * hash(vec2(slot, 4.4)), 0.6 + 0.35 * hash(vec2(slot, 5.5)));
  float dist = length((uv - origin) * vec2(aspect, 1.0));
  float sheet = boltOn * decay * smoothstep(0.6, 0.0, dist) * (0.35 + 0.65 * n) * u_density;
  float below = step(uv.y, origin.y) * smoothstep(origin.y - 0.42, origin.y - 0.28, uv.y);
  float wobble = (lnoise(uv.y * 34.0, slot) - 0.5) * 0.07 + (lnoise(uv.y * 120.0, slot + 9.0) - 0.5) * 0.02;
  float core = smoothstep(0.0028, 0.0, abs(uv.x - origin.x - wobble) * aspect);
  float halo = smoothstep(0.03, 0.0, abs(uv.x - origin.x - wobble) * aspect) * 0.25;
  float bolt = boltOn * decay * below * (core + halo) * u_density;
  sheet += cloud;

  // The digital half: a fine grid where the fog is thin, a coarser one drawn
  // through it, and a slow scanline.
  vec2 cell = vec2(u_grid) / u_res;
  vec2 g = fract(uv / cell);
  float line = (1.0 - smoothstep(0.0, 0.08, min(g.x, g.y))) * 0.035 * (1.0 - d) * u_density;
  vec2 g2 = fract(uv / (cell * 8.0));
  float major = (1.0 - smoothstep(0.0, 0.012, min(g2.x, g2.y))) * 0.09 * u_density;
  float scan = smoothstep(0.02, 0.0, abs(uv.y - fract(u_time * 0.06))) * 0.05;
  vec3 techCol = vec3(0.55, 0.72, 0.95);
  col = mix(col, techCol, 0.3);

  // Blue-noise-ish dither so the soft gradients do not band on 8-bit output.
  float dither = (hash(gl_FragCoord.xy) - 0.5) / 96.0;

  vec3 rgb = col * (d * 0.62) + vec3(line) + techCol * (major + scan);
  rgb += amber * sheet * 0.5 * (0.3 + d) + mix(amber, vec3(1.0, 0.93, 0.8), 0.5) * bolt * 0.9;
  float a = d * 0.7 + line + major + scan + sheet * 0.35 + bolt * 0.9 + dither;
  gl_FragColor = vec4(rgb + dither, clamp(a, 0.0, 1.0));
}
`;
