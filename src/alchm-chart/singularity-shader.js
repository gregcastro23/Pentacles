/* ============================================================
   Pentacles — Canonical Singularity Shader
   ============================================================
   WebGL canvas renderer for the Singularity Core / Event Horizon
   visual effect. Used by MeleeTable and classic script bridges.
   ============================================================ */

export function initSingularityShaderCanvas(canvas) {
  if (!canvas || canvas.dataset.initialized) return canvas?._glCleanup || null;
  canvas.dataset.initialized = "true";

  const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
  if (!gl) return null;

  function syncSize() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(120, Math.round(rect.width || canvas.clientWidth || 320));
    const h = Math.max(120, Math.round(rect.height || canvas.clientHeight || 320));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }
  syncSize();

  const vs = `attribute vec2 a_position;
varying vec2 v_texCoord;
void main() {
  v_texCoord = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

  const fs = `precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
varying vec2 v_texCoord;

void main() {
    vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution.xy) / min(u_resolution.x, u_resolution.y);
    float dist = length(uv);
    
    // Gravitational Lensing effect
    float distort = 1.0 / (dist + 0.1);
    vec2 distortedUv = uv * (1.0 + 0.05 * sin(dist * 10.0 - u_time * 2.0) * distort);
    float dist2 = length(distortedUv);

    // Singularity Core (The Black Hole)
    float core = smoothstep(0.35, 0.34, dist2);
    
    // Accretion Disk (Rotating Glow)
    float angle = atan(distortedUv.y, distortedUv.x);
    float disk = smoothstep(0.7, 0.35, dist2) * smoothstep(0.34, 0.45, dist2);
    disk *= 0.5 + 0.5 * sin(angle * 3.0 + u_time * 1.5 + dist2 * 5.0);
    
    // Photon Sphere Ring (Gold Accents)
    float ring = smoothstep(0.01, 0.0, abs(dist2 - 0.48 + 0.02 * sin(u_time * 4.0 + angle * 5.0)));
    
    // Event Horizon Particles (Shimmer)
    float particles = 0.0;
    for(float i = 0.0; i < 3.0; i++) {
        float t = u_time * (0.5 + i * 0.2);
        float r = 0.5 + 0.1 * sin(t + angle * (2.0 + i));
        particles += smoothstep(0.02, 0.0, abs(dist2 - r)) * (0.3 / (dist2 + 0.5));
    }

    vec3 backgroundColor = vec3(0.02, 0.023, 0.047);
    vec3 goldColor = vec3(0.847, 0.706, 0.416);
    vec3 glowColor = vec3(0.4, 0.3, 0.1);
    
    vec3 color = backgroundColor;
    color = mix(color, glowColor * 1.5, disk);
    color = mix(color, goldColor, ring * 0.8);
    color = mix(color, goldColor, particles * 0.5);
    color *= (1.0 - core);
    
    gl_FragColor = vec4(color, 1.0);
}`;

  function compileShader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  }

  const prog = gl.createProgram();
  gl.attachShader(prog, compileShader(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, compileShader(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  const pos = gl.getAttribLocation(prog, "a_position");
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

  const uTime = gl.getUniformLocation(prog, "u_time");
  const uRes = gl.getUniformLocation(prog, "u_resolution");

  let start = performance.now();
  let animId = null;
  let alive = true;

  function render(now) {
    if (!alive || !document.body.contains(canvas)) {
      alive = false;
      return;
    }
    const t = now - start;
    syncSize();
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (uTime) gl.uniform1f(uTime, t * 0.001);
    if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    animId = requestAnimationFrame(render);
  }

  animId = requestAnimationFrame(render);

  const cleanup = () => {
    alive = false;
    if (animId) cancelAnimationFrame(animId);
    try {
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
    } catch {}
    delete canvas.dataset.initialized;
  };

  canvas._glCleanup = cleanup;
  return cleanup;
}

export function cleanupSingularityShaderCanvas(canvas) {
  if (canvas && typeof canvas._glCleanup === "function") {
    canvas._glCleanup();
    canvas._glCleanup = null;
  }
}
