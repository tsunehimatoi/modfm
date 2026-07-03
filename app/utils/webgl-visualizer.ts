// ─────────────────────────────────────────────────────────────────────────────
// webgl-visualizer.ts — WebGL-based audio visualizers (Scope + ChannelScopes)
// ─────────────────────────────────────────────────────────────────────────────
// Two renderers:
//   1. ScopeWebGLRenderer      – main scope (spectrum bars + waveform envelope)
//   2. ChannelScopesWebGLRenderer – per-channel scopes (shared single canvas,
//                                   viewport/scissor slicing)
// Both gracefully return null on init failure so callers can fallback to 2D.
// ─────────────────────────────────────────────────────────────────────────────

export function showWebGLErrorBanner(title: string, error: any) {
  if (typeof document === "undefined") return;
  console.error(`[webgl-error-banner] ${title}:`, error);
  let banner = document.getElementById("webgl-debug-err");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "webgl-debug-err";
    banner.style.cssText = "position:fixed;bottom:10px;right:10px;background:rgba(220,38,38,0.95);color:#fff;padding:12px;border-radius:4px;font-family:monospace;font-size:11px;z-index:99999;max-width:400px;max-height:300px;overflow:auto;box-shadow:0 4px 6px rgba(0,0,0,0.3);line-height:1.4;";
    
    const closeBtn = document.createElement("button");
    closeBtn.innerText = "✕";
    closeBtn.style.cssText = "float:right;background:none;border:none;color:#fff;cursor:pointer;font-size:12px;margin-left:8px;font-weight:bold;";
    closeBtn.onclick = () => {
      banner?.remove();
    };
    banner.appendChild(closeBtn);
    
    const content = document.createElement("div");
    content.id = "webgl-debug-err-content";
    banner.appendChild(content);
    
    document.body.appendChild(banner);
  }
  
  const content = document.getElementById("webgl-debug-err-content");
  if (content) {
    const errText = error ? (error.stack || error.message || String(error)) : "Unknown error";
    const div = document.createElement("div");
    div.style.marginBottom = "8px";
    div.style.borderBottom = "1px solid rgba(255,255,255,0.2)";
    div.style.paddingBottom = "4px";
    div.innerHTML = `<strong>${title}</strong><br/><pre style="margin:4px 0 0 0;white-space:pre-wrap;word-break:break-all;">${errText}</pre>`;
    content.appendChild(div);
  }
}


// 👨‍💻 Safe Uniform Setter Wrappers
function setUniform1f(gl: WebGLRenderingContext, loc: WebGLUniformLocation | null | undefined, val: number) {
  if (loc) gl.uniform1f(loc, val);
}
function setUniform2f(gl: WebGLRenderingContext, loc: WebGLUniformLocation | null | undefined, x: number, y: number) {
  if (loc) gl.uniform2f(loc, x, y);
}
function setUniform3f(gl: WebGLRenderingContext, loc: WebGLUniformLocation | null | undefined, x: number, y: number, z: number) {
  if (loc) gl.uniform3f(loc, x, y, z);
}
function setUniform1i(gl: WebGLRenderingContext, loc: WebGLUniformLocation | null | undefined, val: number) {
  if (loc) gl.uniform1i(loc, val);
}

/** Compile a shader, throw Error on failure. */
function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  src: string,
): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("Failed to create WebGL shader object");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) || "Unknown compile error";
    gl.deleteShader(sh);
    throw new Error("Shader compile error: " + log);
  }
  return sh;
}

/** Link a program, throw Error on failure. */
function linkProgram(
  gl: WebGLRenderingContext,
  vs: WebGLShader,
  fs: WebGLShader,
): WebGLProgram {
  const pg = gl.createProgram();
  if (!pg) throw new Error("Failed to create WebGL program object");
  gl.attachShader(pg, vs);
  gl.attachShader(pg, fs);
  gl.linkProgram(pg);
  if (!gl.getProgramParameter(pg, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(pg) || "Unknown link error";
    gl.deleteProgram(pg);
    throw new Error("Program link error: " + log);
  }
  return pg;
}

/** Create a 1-row RGBA POT texture of the given width. */
function createDataTexture(
  gl: WebGLRenderingContext,
  potWidth: number,
): WebGLTexture | null {
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const blank = new Uint8Array(potWidth * 4);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    potWidth,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    blank,
  );
  return tex;
}

/** Upload a Float32Array as RGBA bytes into a POT texture row. Values are
 *  mapped from [-1..1] (or [0..1] for unsigned) to [0..255]. */
function uploadTexRow(
  gl: WebGLRenderingContext,
  tex: WebGLTexture,
  unit: number,
  data: Uint8Array,
  potWidth: number,
) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texSubImage2D(
    gl.TEXTURE_2D,
    0,
    0,
    0,
    potWidth,
    1,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    data,
  );
}

// ── CSS color resolution via DOM ──────────────────────────────────────────────

let _colorProbe: HTMLElement | null = null;

function getColorProbe(): HTMLElement {
  if (_colorProbe && _colorProbe.parentNode) return _colorProbe;
  _colorProbe = document.createElement("span");
  _colorProbe.style.cssText =
    "position:absolute;left:-9999px;top:-9999px;pointer-events:none;visibility:hidden;";
  document.body.appendChild(_colorProbe);
  return _colorProbe;
}

const colorCache = new Map<string, [number, number, number, number]>();

/** Resolve any CSS color string (including color-mix, var(), etc.) to
 *  an [r, g, b, a] float array in 0..1 range. */
function resolveColor(css: string): [number, number, number, number] {
  if (!css) return [0.58, 0.64, 0.72, 1];
  const cached = colorCache.get(css);
  if (cached) return cached;

  if (typeof document === "undefined") return [0.58, 0.64, 0.72, 1];
  try {
    const probe = getColorProbe();
    probe.style.color = "";
    probe.style.color = css;
    const computed = window.getComputedStyle(probe).color;
    const m = computed.match(
      /rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/,
    );
    if (m) {
      const res: [number, number, number, number] = [
        parseFloat(m[1]!) / 255,
        parseFloat(m[2]!) / 255,
        parseFloat(m[3]!) / 255,
        m[4] != null ? parseFloat(m[4]) : 1,
      ];
      colorCache.set(css, res);
      return res;
    }
  } catch { /* fallback */ }
  // Try hex parse directly
  const h = css.trim();
  if (h.charAt(0) === "#") {
    let hex = h.slice(1);
    if (hex.length === 3) hex = hex[0]! + hex[0]! + hex[1]! + hex[1]! + hex[2]! + hex[2]!;
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16) / 255;
      const g = parseInt(hex.slice(2, 4), 16) / 255;
      const b = parseInt(hex.slice(4, 6), 16) / 255;
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
        const res: [number, number, number, number] = [r, g, b, 1];
        colorCache.set(css, res);
        return res;
      }
    }
  }
  const fallback: [number, number, number, number] = [0.58, 0.64, 0.72, 1];
  colorCache.set(css, fallback);
  return fallback;
}

// ── Full-screen quad geometry (shared) ────────────────────────────────────────

function createQuadVAO(gl: WebGLRenderingContext): WebGLBuffer | null {
  const buf = gl.createBuffer();
  if (!buf) return null;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  // Two triangles covering clip space [-1..1] → uv [0..1]
  // prettier-ignore
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 0, 0,
     1, -1, 1, 0,
    -1,  1, 0, 1,
     1,  1, 1, 1,
  ]), gl.STATIC_DRAW);
  return buf;
}

function bindQuad(
  gl: WebGLRenderingContext,
  buf: WebGLBuffer,
  aPos: number,
  aUV: number,
) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(aUV);
  gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 16, 8);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ScopeWebGLRenderer — Main scope (spectrum bars + waveform + grid)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SCOPE_VS = `
attribute vec2 aPos;
attribute vec2 aUV;
varying vec2 vUV;
void main() {
  vUV = aUV;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// Fragment shader for main scope:
// - Horizontal grid lines (3 lines at 25%, 50%, 75%)
// - Spectrum bars with SDF rounded-bottom-rect + hardware AA
// - Peak caps
// - Waveform envelope fill + halo + sharp stroke
const SCOPE_FS = `
precision mediump float;
varying vec2 vUV;

uniform sampler2D uSpectrum;   // R=bar value (0..1, sqrt-compressed)
uniform sampler2D uPeaks;      // R=peak value

uniform float uBars;           // number of spectrum bars (e.g. 56)
uniform float uDpr;
uniform float uFillContainer;  // 1.0 if background-fill mode
uniform vec2  uRes;            // canvas pixel size
uniform float uTime;           // time for particle float and wave ripple
uniform float uLowEnergy;      // bass energy
uniform float uMidEnergy;      // vocal/melody energy
uniform float uHighEnergy;     // percussion/hi-hat energy

uniform vec3 uSpecStart;      // spectrum gradient top color
uniform vec3 uSpecEnd;        // spectrum gradient bottom color
uniform vec3 uWaveColor;      // wave base color
uniform vec3 uGridColor;      // grid line color
uniform float uGridAlpha;

// Standard non-premultiplied alpha blending helper
vec4 blend(vec4 back, vec4 front) {
  float outAlpha = front.a + back.a * (1.0 - front.a);
  if (outAlpha == 0.0) return vec4(0.0);
  vec3 outColor = (front.rgb * front.a + back.rgb * back.a * (1.0 - front.a)) / outAlpha;
  return vec4(outColor, outAlpha);
}

void main() {
  float x = vUV.x;               // 0..1 from left
  float y = 1.0 - vUV.y;         // 0..1 from top (canvas convention)

  vec4 color = vec4(0.0);

  // ── Grid lines ────────────────────────────────────────────────────────
  float gridW = 1.0 / uRes.y;    // 1px in UV space
  for (int i = 1; i <= 3; i++) {
    float gy = float(i) * 0.25;
    float dist = abs(y - gy);
    float line = 1.0 - smoothstep(0.0, gridW, dist);
    color = blend(color, vec4(uGridColor, uGridAlpha * line));
  }

  // ── Spectrum bars (classic flat design) ───────────────────────────────
  float barIdx = floor(x * uBars);
  float barFrac = fract(x * uBars);

  // Sample spectrum value
  float specU = (barIdx + 0.5) / uBars;
  float barVal = texture2D(uSpectrum, vec2(specU, 0.5)).r;

  // Bar geometry
  float barGapFrac = 0.22;
  float gapHalf = barGapFrac * 0.5;

  if (barFrac > gapHalf && barFrac < (1.0 - gapHalf) && barIdx < uBars) {
    float barH = barVal * 0.92 + (1.0 / uRes.y);  // bar height fraction

    // Bars hang from top
    if (y < barH) {
      // Spectrum gradient color
      vec3 barColor = mix(uSpecStart, uSpecEnd, y / max(barH, 0.001));
      color = blend(color, vec4(barColor, 0.70));
    }

    // Peak cap (simplified 1px solid line)
    float peakVal = texture2D(uPeaks, vec2(specU, 0.5)).r;
    float peakH = peakVal * 0.92 + (1.0 / uRes.y);
    float capThickness = max(1.0, 1.5 * uDpr) / uRes.y;
    float capDist = abs(y - peakH);
    if (peakVal > 0.04 && capDist < capThickness) {
      float capAA = 1.0 - smoothstep(0.0, capThickness, capDist);
      color = blend(color, vec4(uSpecEnd, 0.85 * capAA));
    }
  }

  // ── Classic Single-Line Waveform ──────────────────────────────────────
  if (uFillContainer < 0.5) {
    float pi = 3.14159265;
    float dx = 1.0 / uRes.x;
    float win = sin(x * pi);  // Window function to fade at edges
    float winNext = sin((x + dx) * pi);

    // Single simple wave line based on low+mid energy
    float waveAmp = 0.18 * (uLowEnergy + uMidEnergy * 0.5 + 0.05);
    float waveY = 0.5 + waveAmp * sin(x * 6.28 + uTime * 2.0) * win;
    float waveYNext = 0.5 + waveAmp * sin((x + dx) * 6.28 + uTime * 2.0) * winNext;

    // ── Perpendicular distance to line segment (pixel-precise) ──────
    float y0  = waveY * uRes.y;
    float y1  = waveYNext * uRes.y;
    float py  = y * uRes.y;
    float dy  = y1 - y0;
    float segLen2 = 1.0 + dy * dy;
    float t = (0.5 + (py - y0) * dy) / segLen2;
    t = clamp(t, 0.0, 1.0);
    float closestX = t;
    float closestY = y0 + t * dy;
    float distPx = sqrt((0.5 - closestX) * (0.5 - closestX) + (py - closestY) * (py - closestY));
    float dist = distPx / uRes.y;

    // Clean 1px solid line (no neon glow/glow effect)
    float thickness = max(1.0, 1.5 * uDpr) / uRes.y;
    float lineAA = 1.0 - smoothstep(0.0, thickness, dist);
    if (lineAA > 0.01) {
      color = blend(color, vec4(uWaveColor, 0.65 * lineAA));
    }

    // Center axis line (subtle)
    float axisDist = abs(y - 0.5);
    float axisW = 0.5 / uRes.y;
    float axisAA = 1.0 - smoothstep(0.0, axisW * 2.0, axisDist);
    if (axisAA > 0.01) {
      color = blend(color, vec4(uWaveColor, 0.12 * axisAA));
    }
  }

  gl_FragColor = color;
}
`;

export interface ScopeColors {
  spectrumStart: string;
  spectrumEnd: string;
  waveformColor: string;
  borderColor: string;
}

export class ScopeWebGLRenderer {
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private quadBuf: WebGLBuffer;
  private specTex: WebGLTexture;
  private peakTex: WebGLTexture;
  private specData: Uint8Array;
  private peakData: Uint8Array;
  private locs: { [k: string]: WebGLUniformLocation | null };
  private aPos: number;
  private aUV: number;

  // Precise texture dimensions
  private specWidth = 56;   // 56 bars

  private canvas: HTMLCanvasElement;

  private constructor(
    gl: WebGLRenderingContext,
    canvas: HTMLCanvasElement,
    program: WebGLProgram,
    quadBuf: WebGLBuffer,
    specTex: WebGLTexture,
    peakTex: WebGLTexture,
  ) {
    this.gl = gl;
    this.canvas = canvas;
    this.program = program;
    this.quadBuf = quadBuf;
    this.specTex = specTex;
    this.peakTex = peakTex;

    this.specData = new Uint8Array(this.specWidth * 4);
    this.peakData = new Uint8Array(this.specWidth * 4);

    this.aPos = gl.getAttribLocation(program, "aPos");
    this.aUV = gl.getAttribLocation(program, "aUV");

    gl.useProgram(program);
    this.locs = {};
    const names = [
      "uSpectrum", "uPeaks",
      "uBars", "uDpr", "uFillContainer", "uRes",
      "uTime", "uLowEnergy", "uMidEnergy", "uHighEnergy",
      "uSpecStart", "uSpecEnd", "uWaveColor", "uGridColor", "uGridAlpha",
    ];
    for (const n of names) {
      this.locs[n] = gl.getUniformLocation(program, n);
    }
    // Bind texture units
    setUniform1i(gl, this.locs["uSpectrum"], 0);
    setUniform1i(gl, this.locs["uPeaks"], 1);
  }

  /** Try to create the renderer; throws Error on failure. */
  static create(canvas: HTMLCanvasElement): ScopeWebGLRenderer {
    try {
      const gl = canvas.getContext("webgl", {
        alpha: true,
        premultipliedAlpha: false,
        antialias: false,
        preserveDrawingBuffer: false,
      }) as WebGLRenderingContext | null;
      if (!gl) {
        throw new Error("Failed to get WebGL rendering context");
      }

      const vs = compileShader(gl, gl.VERTEX_SHADER, SCOPE_VS);
      const fs = compileShader(gl, gl.FRAGMENT_SHADER, SCOPE_FS);
      if (!vs || !fs) {
        throw new Error("Failed to compile shaders");
      }

      const pg = linkProgram(gl, vs, fs);
      if (!pg) {
        throw new Error("Failed to link shader program");
      }

      const quad = createQuadVAO(gl);
      if (!quad) {
        throw new Error("Failed to create quad vertex array object");
      }

      const specTex = createDataTexture(gl, 56);
      const peakTex = createDataTexture(gl, 56);
      if (!specTex || !peakTex) {
        throw new Error("Failed to create spectrum or peak textures");
      }

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      return new ScopeWebGLRenderer(gl, canvas, pg, quad, specTex, peakTex);
    } catch (e) {
      console.error("[webgl-vis] ScopeWebGLRenderer.create failed:", e);
      throw e;
    }
  }

  /**
   * Render a frame.
   *
   * @param barValues   - Float32Array[SCOPE_BARS] of sqrt-compressed bar values (0..1)
   * @param peakValues  - Float32Array[SCOPE_BARS] of peak values (0..1)
   * @param bars        - number of spectrum bars
   * @param fillContainer - true if background fill mode
   * @param colors      - resolved color strings
   * @param dpr         - device pixel ratio
   * @param time        - cumulative time in seconds
   * @param lowEnergy   - low-frequency (bass) energy
   * @param midEnergy   - mid-frequency (vocal/melody) energy
   * @param highEnergy  - high-frequency (percussion/hi-hat) energy
   */
  render(
    barValues: Float32Array,
    peakValues: Float32Array,
    bars: number,
    fillContainer: boolean,
    colors: ScopeColors,
    dpr: number,
    time: number,
    lowEnergy: number,
    midEnergy: number,
    highEnergy: number,
  ): void {
    const gl = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;

    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Upload spectrum data
    const sd = this.specData;
    sd.fill(0);
    for (let i = 0; i < bars && i < this.specWidth; i++) {
      const v = Math.max(0, Math.min(1, barValues[i]!));
      const idx = i * 4;
      sd[idx] = (v * 255) | 0;       // R = value
      sd[idx + 1] = 0;
      sd[idx + 2] = 0;
      sd[idx + 3] = 255;
    }
    uploadTexRow(gl, this.specTex, 0, sd, this.specWidth);

    // Upload peak data
    const pd = this.peakData;
    pd.fill(0);
    for (let i = 0; i < bars && i < this.specWidth; i++) {
      const v = Math.max(0, Math.min(1, peakValues[i]!));
      const idx = i * 4;
      pd[idx] = (v * 255) | 0;
      pd[idx + 3] = 255;
    }
    uploadTexRow(gl, this.peakTex, 1, pd, this.specWidth);

    // Set uniforms
    gl.useProgram(this.program);
    const L = this.locs;
    setUniform1f(gl, L["uBars"], bars);
    setUniform1f(gl, L["uDpr"], dpr);
    setUniform1f(gl, L["uFillContainer"], fillContainer ? 1.0 : 0.0);
    setUniform2f(gl, L["uRes"], w, h);
    setUniform1f(gl, L["uTime"], time);
    setUniform1f(gl, L["uLowEnergy"], lowEnergy);
    setUniform1f(gl, L["uMidEnergy"], midEnergy);
    setUniform1f(gl, L["uHighEnergy"], highEnergy);

    // Resolve & set colors
    const specStart = resolveColor(colors.spectrumStart);
    const specEnd = resolveColor(colors.spectrumEnd);
    const waveCol = resolveColor(colors.waveformColor);
    const gridCol = resolveColor(colors.borderColor);

    setUniform3f(gl, L["uSpecStart"], specStart[0], specStart[1], specStart[2]);
    setUniform3f(gl, L["uSpecEnd"], specEnd[0], specEnd[1], specEnd[2]);
    setUniform3f(gl, L["uWaveColor"], waveCol[0], waveCol[1], waveCol[2]);
    setUniform3f(gl, L["uGridColor"], gridCol[0], gridCol[1], gridCol[2]);
    setUniform1f(gl, L["uGridAlpha"], fillContainer ? 0.15 : 0.5);

    // Draw
    bindQuad(gl, this.quadBuf, this.aPos, this.aUV);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Clear the canvas to transparent. */
  clear(): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Dispose all WebGL resources. */
  destroy(): void {
    const gl = this.gl;
    gl.deleteTexture(this.specTex);
    gl.deleteTexture(this.peakTex);
    gl.deleteBuffer(this.quadBuf);
    gl.deleteProgram(this.program);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ChannelScopesWebGLRenderer — Per-channel scopes (single shared canvas)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CHANNEL_VS = `
attribute vec2 aPos;
attribute vec2 aUV;
varying vec2 vUV;
void main() {
  vUV = aUV;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const CHANNEL_FS = `
precision mediump float;
varying vec2 vUV;

uniform sampler2D uWaveform;   // R=waveform sample value (signed remapped to 0..1)
uniform float uCols;           // number of samples in texture
uniform vec2  uRes;            // viewport pixel size
uniform float uDpr;

uniform vec3 uStroke;          // waveform stroke color
uniform vec3 uFillTop;         // fill gradient top color
uniform vec3 uFillBot;         // fill gradient bottom color
uniform vec3 uIdleColor;       // idle state color
uniform vec3 uGridColor;       // center axis color
uniform float uIntensity;      // current signal intensity (0..1)
uniform float uIsTotal;        // 1.0 if total channel scope, 0.0 otherwise

// Standard non-premultiplied alpha blending helper
vec4 blend(vec4 back, vec4 front) {
  float outAlpha = front.a + back.a * (1.0 - front.a);
  if (outAlpha == 0.0) return vec4(0.0);
  vec3 outColor = (front.rgb * front.a + back.rgb * back.a * (1.0 - front.a)) / outAlpha;
  return vec4(outColor, outAlpha);
}

// Hermite-interpolated waveform sample lookup at position u (0..1)
float getWaveform(float u) {
  float p = clamp(u, 0.0, 1.0) * uCols;
  float b = floor(p - 0.5);
  float f = fract(p - 0.5);
  float fs = f * f * (3.0 - 2.0 * f); // smoothstep-like hermite
  float waveU = (b + 0.5 + fs) / uCols;
  return texture2D(uWaveform, vec2(waveU, 0.5)).r * 2.0 - 1.0;
}

// 5-tap Gaussian smoothing for anti-aliased curves, with soft clip
float getSmoothedWave(float u) {
  float stepU = 1.0 / uCols;
  float m2 = getWaveform(u - 2.0 * stepU);
  float m1 = getWaveform(u - 1.0 * stepU);
  float m0 = getWaveform(u);
  float p1 = getWaveform(u + 1.0 * stepU);
  float p2 = getWaveform(u + 2.0 * stepU);
  float v = 0.06 * m2 + 0.25 * m1 + 0.38 * m0 + 0.25 * p1 + 0.06 * p2;
  // Hard clip to [-1, 1] — prevents uint8 texture wrap-around
  return clamp(v, -1.0, 1.0);
}

void main() {
  float x = vUV.x;
  float y = 1.0 - vUV.y;   // 0=top, 1=bottom

  vec4 color = vec4(0.0);

  // 1. Center axis line (subtle)
  float axisDist = abs(y - 0.5);
  float axisW = 0.5 / uRes.y;
  float axisAA = 1.0 - smoothstep(0.0, axisW * 2.0, axisDist);
  if (axisAA > 0.01) {
    color = blend(color, vec4(uGridColor, 0.05 * axisAA));
  }

  float halfY = 0.5;
  float amp = 0.5 - 2.0 / uRes.y;
  float dx = 1.0 / uRes.x;

  if (uIntensity >= 0.02) {
    float waveY = getSmoothedWave(x);
    float waveYNext = getSmoothedWave(x + dx);

    // Map sample value [-1,1] → pixel y position
    float topEdge = halfY - waveY * amp;
    float topEdgeNext = halfY - waveYNext * amp;

    // ── Perpendicular distance to line segment (pixel-precise) ──────
    // Convert to pixel coordinates so x/y distances are commensurate
    float y0  = topEdge * uRes.y;       // line-start y (px)
    float y1  = topEdgeNext * uRes.y;   // line-end y at x+1 px
    float py  = y * uRes.y;             // current pixel y (px)
    float dy  = y1 - y0;                // vertical delta over 1 px

    // Closest point on segment (0,y0)–(1,y1) to pixel centre (0.5, py)
    float segLen2 = 1.0 + dy * dy;
    float t = (0.5 + (py - y0) * dy) / segLen2;
    t = clamp(t, 0.0, 1.0);
    float closestX = t;
    float closestY = y0 + t * dy;
    float distPx = sqrt((0.5 - closestX) * (0.5 - closestX) + (py - closestY) * (py - closestY));
    // Back to y-UV units for stroke-width comparison
    float dist = distPx / uRes.y;

    // Stroke
    float strokeW = mix(1.0, 1.6, uIsTotal) * uDpr / uRes.y;
    float topStrokeAA = 1.0 - smoothstep(0.0, strokeW * 1.6, dist);

        // Uniform stroke color (no idle/active blending)
        vec3 strokeColor = uStroke;

    if (topStrokeAA > 0.01) {
      color = blend(color, vec4(strokeColor, topStrokeAA));
    }
  }

  gl_FragColor = color;
}
`;

export interface ChannelColors {
  stroke: string;
  fillTop: string;
  fillBottom: string;
  idle: string;
  grid: string;
}

export class ChannelScopesWebGLRenderer {
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private quadBuf: WebGLBuffer;
  private waveTex: WebGLTexture;
  private waveData: Uint8Array;
  private locs: { [k: string]: WebGLUniformLocation | null };
  private aPos: number;
  private aUV: number;
  private colsCount: number;

  canvas: HTMLCanvasElement;

  private constructor(
    gl: WebGLRenderingContext,
    canvas: HTMLCanvasElement,
    program: WebGLProgram,
    quadBuf: WebGLBuffer,
    waveTex: WebGLTexture,
    colsCount: number,
  ) {
    this.gl = gl;
    this.canvas = canvas;
    this.program = program;
    this.quadBuf = quadBuf;
    this.waveTex = waveTex;
    this.colsCount = colsCount;
    this.waveData = new Uint8Array(colsCount * 4);

    this.aPos = gl.getAttribLocation(program, "aPos");
    this.aUV = gl.getAttribLocation(program, "aUV");

    gl.useProgram(program);
    this.locs = {};
    const names = [
      "uWaveform", "uCols", "uRes", "uDpr",
      "uStroke", "uFillTop", "uFillBot", "uIdleColor", "uGridColor", "uIntensity",
      "uIsTotal",
    ];
    for (const n of names) {
      this.locs[n] = gl.getUniformLocation(program, n);
    }
    setUniform1i(gl, this.locs["uWaveform"], 0);
  }

  /** Try to create the renderer; throws Error on failure. */
  static create(canvas: HTMLCanvasElement, cols: number = 96): ChannelScopesWebGLRenderer {
    try {
      const gl = canvas.getContext("webgl", {
        alpha: true,
        premultipliedAlpha: false,
        antialias: false,
        preserveDrawingBuffer: false,
      }) as WebGLRenderingContext | null;
      if (!gl) {
        throw new Error("Failed to get WebGL rendering context for channel scopes");
      }

      const vs = compileShader(gl, gl.VERTEX_SHADER, CHANNEL_VS);
      const fs = compileShader(gl, gl.FRAGMENT_SHADER, CHANNEL_FS);
      if (!vs || !fs) {
        throw new Error("Failed to compile shaders for channel scopes");
      }

      const pg = linkProgram(gl, vs, fs);
      if (!pg) {
        throw new Error("Failed to link shader program for channel scopes");
      }

      const quad = createQuadVAO(gl);
      if (!quad) {
        throw new Error("Failed to create quad vertex array object for channel scopes");
      }

      const waveTex = createDataTexture(gl, cols);
      if (!waveTex) {
        throw new Error("Failed to create waveform texture for channel scopes");
      }

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      return new ChannelScopesWebGLRenderer(gl, canvas, pg, quad, waveTex, cols);
    } catch (e) {
      console.error("[webgl-vis] ChannelScopesWebGLRenderer.create failed:", e);
      throw e;
    }
  }

  /**
   * Render a single channel waveform in a viewport region.
   *
   * @param samples   - Float32Array of raw waveform sample values (-1..1)
   * @param numSamples - number of samples
   * @param vp        - {x, y, w, h} viewport in canvas pixels (y=0 at bottom)
   * @param intensity - signal intensity 0..1
   * @param colors    - resolved channel color strings
   * @param dpr       - device pixel ratio
   * @param isTotal   - true if rendering the total/sum waveform
   */
  renderChannel(
    samples: Float32Array,
    numSamples: number,
    vp: { x: number; y: number; w: number; h: number },
    intensity: number,
    colors: ChannelColors,
    dpr: number,
    isTotal: boolean = false,
  ): void {
    const gl = this.gl;

    // Upload waveform sample data (R channel = sample value remapped to [0,1])
    const wd = this.waveData;
    wd.fill(0);
    for (let i = 0; i < numSamples && i < this.colsCount; i++) {
      const idx = i * 4;
      // Remap [-1, 1] → [0, 255] with safety clamp to prevent uint8 overflow
      const v = samples[i]!;
      const clamped = v > 1.0 ? 1.0 : (v < -1.0 ? -1.0 : v);
      wd[idx] = ((clamped + 1.0) * 0.5 * 255 + 0.5) | 0;
      wd[idx + 1] = 0;
      wd[idx + 2] = 0;
      wd[idx + 3] = 255;
    }
    uploadTexRow(gl, this.waveTex, 0, wd, this.colsCount);

    // Set viewport and scissor
    gl.viewport(vp.x, vp.y, vp.w, vp.h);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(vp.x, vp.y, vp.w, vp.h);

    // Uniforms
    gl.useProgram(this.program);
    const L = this.locs;
    setUniform1f(gl, L["uCols"], numSamples);
    setUniform2f(gl, L["uRes"], vp.w, vp.h);
    setUniform1f(gl, L["uDpr"], dpr);
    setUniform1f(gl, L["uIntensity"], intensity);
    setUniform1f(gl, L["uIsTotal"], isTotal ? 1.0 : 0.0);

    // Colors
    const stroke = resolveColor(colors.stroke);
    const fillTop = resolveColor(colors.fillTop);
    const fillBot = resolveColor(colors.fillBottom);
    const idle = resolveColor(colors.idle);
    const grid = resolveColor(colors.grid);

    setUniform3f(gl, L["uStroke"], stroke[0], stroke[1], stroke[2]);
    setUniform3f(gl, L["uFillTop"], fillTop[0], fillTop[1], fillTop[2]);
    setUniform3f(gl, L["uFillBot"], fillBot[0], fillBot[1], fillBot[2]);
    setUniform3f(gl, L["uIdleColor"], idle[0], idle[1], idle[2]);
    setUniform3f(gl, L["uGridColor"], grid[0], grid[1], grid[2]);

    // Draw
    bindQuad(gl, this.quadBuf, this.aPos, this.aUV);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.disable(gl.SCISSOR_TEST);
  }

  /** Clear the entire canvas. */
  clear(): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Resize the canvas to match its container. */
  resize(dpr: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /** Dispose all WebGL resources. */
  destroy(): void {
    const gl = this.gl;
    gl.deleteTexture(this.waveTex);
    gl.deleteBuffer(this.quadBuf);
    gl.deleteProgram(this.program);
  }
}

export class PatternWebGLRenderer {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;

  fontTex: WebGLTexture | null = null;
  gridTex: WebGLTexture | null = null;
  gridDataArray: Uint8Array | null = null;

  program: WebGLProgram;
  quadBuf: WebGLBuffer;

  // Attribute locations
  aPos: number;
  aUV: number;

  // Uniform locations
  uFontTex: WebGLUniformLocation | null;
  uGridTex: WebGLUniformLocation | null;
  uGridSize: WebGLUniformLocation | null;
  uResolution: WebGLUniformLocation | null;
  uCharSize: WebGLUniformLocation | null;
  uCurrentRow: WebGLUniformLocation | null;
  uCurrentRowBgColor: WebGLUniformLocation | null;
  uBorderColor: WebGLUniformLocation | null;
  uIsHorizontal: WebGLUniformLocation | null;

  charWidth: number = 8;
  charHeight: number = 18;
  rowHeight: number = 18;

  lastCols: number = 0;
  lastRows: number = 0;
  lastCacheKey: string = "";

  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.style.display = "block";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";

    container.innerHTML = "";
    container.appendChild(this.canvas);

    const gl = this.canvas.getContext("webgl", { alpha: true, antialias: false });
    if (!gl) throw new Error("WebGL context creation failed");
    this.gl = gl;

    // 1. 初始化 Shaders 和 Program
    const vsSource = `
      attribute vec2 aPosition;
      attribute vec2 aUV;
      varying vec2 vUV;
      void main() {
        vUV = aUV;
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `;

    const fsSource = `
      precision mediump float;
      varying vec2 vUV;

      uniform sampler2D uFontTex;
      uniform sampler2D uGridTex;
      uniform vec2 uGridSize;
      uniform vec2 uResolution;
      uniform vec2 uCharSize;
      uniform float uCurrentRow;
      uniform vec4 uCurrentRowBgColor;
      uniform vec4 uBorderColor;
      uniform float uIsHorizontal;

      void main() {
        // textUV.y is flipped because text rows go top-to-bottom, while WebGL UV goes bottom-to-top
        vec2 textUV = vec2(vUV.x, 1.0 - vUV.y);
        vec2 pixelPos = textUV * uResolution;
        vec2 cellIndex = floor(pixelPos / uCharSize);

        if (cellIndex.x < 0.0 || cellIndex.x >= uGridSize.x || cellIndex.y < 0.0 || cellIndex.y >= uGridSize.y) {
          gl_FragColor = vec4(0.0);
          return;
        }

        vec2 gridUV = (cellIndex + vec2(0.5)) / uGridSize;
        vec4 gridData = texture2D(uGridTex, gridUV);

        float ascii = floor(gridData.r * 255.0 + 0.5);
        vec3 charColor = gridData.gba;

        vec2 localUV = (pixelPos - cellIndex * uCharSize) / uCharSize;
        float texU = (ascii + localUV.x) / 128.0;
        // Flip V coordinate within font texture cell because WebGL texture Y coordinates 
        // are bottom-up while Canvas 2D Y coordinates are top-down.
        float texV = localUV.y;

        vec4 fontColor = texture2D(uFontTex, vec2(texU, texV));
        float charAlpha = fontColor.a;

        vec4 bgColor = vec4(0.0);
        float glowPadding = 6.0;

        if (uIsHorizontal > 0.5) {
          // ==================== 横向模式 ====================
          // 1. 垂直高亮指示条 (当前播放时间步)
          float leftBoundary = (5.0 + uCurrentRow * 5.0) * uCharSize.x;
          float rightBoundary = (5.0 + (uCurrentRow + 1.0) * 5.0) * uCharSize.x;

          if (pixelPos.x >= leftBoundary - glowPadding && pixelPos.x <= rightBoundary + glowPadding) {
            if (pixelPos.x >= leftBoundary && pixelPos.x < rightBoundary) {
              bgColor = vec4(uCurrentRowBgColor.rgb * uCurrentRowBgColor.a, uCurrentRowBgColor.a);
            }
            
            float distToLeft = abs(pixelPos.x - leftBoundary);
            float distToRight = abs(pixelPos.x - rightBoundary);
            float minDist = min(distToLeft, distToRight);
            
            float lineWidth = 1.0;
            float glow = exp(-minDist * 0.45);
            vec4 strokeColor = vec4(uCurrentRowBgColor.rgb, 1.0);
            
            if (minDist <= lineWidth * 0.5 + 0.1) {
              bgColor = mix(bgColor, strokeColor, 0.50);
            } else {
              bgColor = mix(bgColor, strokeColor, 0.18 * glow);
            }
          }

          // 2. 水平轨道分割线 (通道行之间)
          float border0Y = 1.0 * uCharSize.y;
          float distToBorderY = abs(pixelPos.y - border0Y);
          if (pixelPos.y >= border0Y) {
            float relativeY = pixelPos.y - border0Y;
            float borderIntervalY = 3.0 * uCharSize.y;
            float mY = mod(relativeY, borderIntervalY);
            distToBorderY = min(mY, borderIntervalY - mY);
          }

          float horizLineWidth = 1.0;
          if (distToBorderY <= horizLineWidth * 0.5 + 0.1) {
            bgColor = mix(bgColor, vec4(uBorderColor.rgb, 1.0), uBorderColor.a);
          }

        } else {
          // ==================== 纵向模式 ====================
          // 1. 水平高亮指示条 (当前播放行)
          float topBoundary = uCurrentRow * uCharSize.y;
          float bottomBoundary = (uCurrentRow + 1.0) * uCharSize.y;

          if (pixelPos.y >= topBoundary - glowPadding && pixelPos.y <= bottomBoundary + glowPadding) {
            if (pixelPos.y >= topBoundary && pixelPos.y < bottomBoundary) {
              bgColor = vec4(uCurrentRowBgColor.rgb * uCurrentRowBgColor.a, uCurrentRowBgColor.a);
            }
            
            float distToTop = abs(pixelPos.y - topBoundary);
            float distToBottom = abs(pixelPos.y - bottomBoundary);
            float minDist = min(distToTop, distToBottom);
            
            float lineWidth = max(1.0, uCharSize.y / 18.0);
            float glow = exp(-minDist * 0.45);
            vec4 strokeColor = vec4(uCurrentRowBgColor.rgb, 1.0);
            
            if (minDist <= lineWidth * 0.5 + 0.1) {
              bgColor = mix(bgColor, strokeColor, 0.50);
            } else {
              bgColor = mix(bgColor, strokeColor, 0.18 * glow);
            }
          }

          // 2. 垂直轨道分割线 (通道列之间)
          float border0 = 7.0 * uCharSize.x;
          float distToBorder = abs(pixelPos.x - border0);
          if (pixelPos.x >= border0) {
            float relativeX = pixelPos.x - border0;
            float borderInterval = 12.0 * uCharSize.x;
            float m = mod(relativeX, borderInterval);
            distToBorder = min(m, borderInterval - m);
          }

          float vertLineWidth = 1.0;
          if (distToBorder <= vertLineWidth * 0.5 + 0.1) {
            bgColor = mix(bgColor, vec4(uBorderColor.rgb, 1.0), uBorderColor.a);
          }
        }

        gl_FragColor = mix(bgColor, vec4(charColor, 1.0), charAlpha);
      }
    `;

    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
    this.program = linkProgram(gl, vs, fs);

    gl.deleteShader(vs);
    gl.deleteShader(fs);

    // 2. 获取 Attributes 和 Uniforms
    this.aPos = gl.getAttribLocation(this.program, "aPosition");
    this.aUV = gl.getAttribLocation(this.program, "aUV");

    this.uFontTex = gl.getUniformLocation(this.program, "uFontTex");
    this.uGridTex = gl.getUniformLocation(this.program, "uGridTex");
    this.uGridSize = gl.getUniformLocation(this.program, "uGridSize");
    this.uResolution = gl.getUniformLocation(this.program, "uResolution");
    this.uCharSize = gl.getUniformLocation(this.program, "uCharSize");
    this.uCurrentRow = gl.getUniformLocation(this.program, "uCurrentRow");
    this.uCurrentRowBgColor = gl.getUniformLocation(this.program, "uCurrentRowBgColor");
    this.uBorderColor = gl.getUniformLocation(this.program, "uBorderColor");
    this.uIsHorizontal = gl.getUniformLocation(this.program, "uIsHorizontal");

    // 3. 创建 Quad geometry 缓冲
    const qb = createQuadVAO(gl);
    if (!qb) throw new Error("Failed to create quad buffer");
    this.quadBuf = qb;
  }

  static create(container: HTMLElement): PatternWebGLRenderer | null {
    try {
      return new PatternWebGLRenderer(container);
    } catch (e) {
      console.error("[webgl-vis] PatternWebGLRenderer.create failed:", e);
      return null;
    }
  }

  private createFontTexture(dpr: number, maxPhysicalCharWidth: number): { texture: WebGLTexture, charWidth: number, charHeight: number } {
    const gl = this.gl;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get font 2D context");

    // 理论上字宽是字号的 0.615 倍左右，也就是说字号是字宽的 1.625 倍。
    // 我们从估计的物理字号开始微调
    let physicalFontSize = maxPhysicalCharWidth * 1.625;
    if (physicalFontSize < 5) physicalFontSize = 5;

    ctx.font = `bold ${physicalFontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
    let metrics = ctx.measureText("M");
    let physicalCharWidth = Math.ceil(metrics.width);

    // 动态调整字体大小，使实际渲染出的物理字符字宽最接近且不超过 maxPhysicalCharWidth
    if (physicalCharWidth > maxPhysicalCharWidth) {
      while (physicalCharWidth > maxPhysicalCharWidth && physicalFontSize > 4) {
        physicalFontSize -= 0.5;
        ctx.font = `bold ${physicalFontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
        physicalCharWidth = Math.ceil(ctx.measureText("M").width);
      }
    } else if (physicalCharWidth < maxPhysicalCharWidth) {
      while (physicalFontSize < 120) {
        const nextFontSize = physicalFontSize + 0.5;
        ctx.font = `bold ${nextFontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
        const nextWidth = Math.ceil(ctx.measureText("M").width);
        if (nextWidth > maxPhysicalCharWidth) {
          break; // 再增大就会超过 maxPhysicalCharWidth，停止增加
        }
        physicalFontSize = nextFontSize;
        physicalCharWidth = nextWidth;
      }
    }

    if (physicalCharWidth < 1) physicalCharWidth = 1;

    // 动态根据实际物理字宽计算物理行高，保持大约 2.25 的宽高比
    const physicalRowHeight = Math.ceil(physicalCharWidth * 2.25);

    canvas.width = physicalCharWidth * 128;
    canvas.height = physicalRowHeight;

    ctx.font = `bold ${physicalFontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";

    for (let i = 0; i < 128; i++) {
      let char = String.fromCharCode(i);
      if (i === 127) {
        char = "»";
      }
      const x = i * physicalCharWidth + physicalCharWidth / 2;
      const y = physicalRowHeight / 2;
      if ((i >= 32 && i <= 126) || i === 127) {
        ctx.fillText(char, x, y);
      }
    }

    const texture = gl.createTexture();
    if (!texture) throw new Error("Failed to create WebGL font texture");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    return { 
      texture, 
      charWidth: physicalCharWidth / dpr, 
      charHeight: physicalRowHeight / dpr 
    };
  }

  render(
    cols: number,
    rows: number,
    cells: { char: string, r: number, g: number, b: number }[][],
    currentRow: number,
    currentRowBgColor: { r: number, g: number, b: number, a: number },
    borderColor: { r: number, g: number, b: number },
    isHorizontal: boolean,
    dpr: number
  ) {
    const gl = this.gl;

    const containerWidth = this.canvas.parentElement ? this.canvas.parentElement.clientWidth : 0;
    const containerHeight = this.canvas.parentElement ? this.canvas.parentElement.clientHeight : 0;
    
    // 如果获取不到容器大小，进行兜底
    const refWidth = containerWidth > 100 ? containerWidth : 800;
    const refHeight = containerHeight > 100 ? containerHeight : 480;

    let maxPhysicalCharWidth = 8;
    if (isHorizontal) {
      // 横向模式下：通道在行方向上，以高度为限制标准进行自适应
      // 限制：rows * (charWidth * 2.25) <= refHeight -> charWidth <= refHeight / (rows * 2.25)
      maxPhysicalCharWidth = Math.floor((refHeight / (rows * 2.25)) * dpr);
    } else {
      // 纵向模式下：通道在列方向上，以宽度为限制标准进行自适应
      // 限制：cols * charWidth <= refWidth
      maxPhysicalCharWidth = Math.floor((refWidth / cols) * dpr);
    }

    // 限制最小物理字符字宽为 3 像素，以防极端窄容器或极多通道时溢出，并确保有显示像素
    const targetMaxPhysicalCharWidth = Math.max(3, maxPhysicalCharWidth);

    // 检查缓存键（dpr + targetMaxPhysicalCharWidth + isHorizontal），如果不一致则重新高清渲染字符集贴图
    const cacheKey = `${dpr}_${targetMaxPhysicalCharWidth}_${isHorizontal}`;
    if (!this.fontTex || this.lastCacheKey !== cacheKey) {
      if (this.fontTex) gl.deleteTexture(this.fontTex);
      const fontInfo = this.createFontTexture(dpr, targetMaxPhysicalCharWidth);
      this.fontTex = fontInfo.texture;
      
      // 更新最终 of 逻辑像素大小和行高，从而保证没有多余的缝隙，并且 100% 物理像素对齐（Pixel Perfect）
      this.charWidth = fontInfo.charWidth;
      this.rowHeight = fontInfo.charHeight;
      this.charHeight = fontInfo.charHeight;
      this.lastCacheKey = cacheKey;
    }

    // 动态撑开父容器 CSS 大小
    const finalHeight = rows * this.rowHeight;
    const finalWidth = cols * this.charWidth;
    const styleWidth = finalWidth;

    if (this.canvas.style.height !== `${finalHeight}px`) {
      this.canvas.style.height = `${finalHeight}px`;
    }
    if (this.canvas.style.width !== `${styleWidth}px`) {
      this.canvas.style.width = `${styleWidth}px`;
    }

    // 计算 backbuffer 的物理大小
    const w = Math.floor(styleWidth * dpr);
    const h = Math.floor(finalHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }

    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // 准备数据纹理
    if (!this.gridTex || this.lastCols !== cols || this.lastRows !== rows) {
      if (this.gridTex) gl.deleteTexture(this.gridTex);
      this.gridTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.gridTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      this.gridDataArray = new Uint8Array(cols * rows * 4);
      this.lastCols = cols;
      this.lastRows = rows;
    }

    // 写入 grid 数据
    const arr = this.gridDataArray!;
    for (let r = 0; r < rows; r++) {
      // 保持正向对应关系，以配合 Shader 中的 textUV 顶底方向
      const targetY = r;
      const rowCells = cells[r];
      for (let c = 0; c < cols; c++) {
        const idx = (targetY * cols + c) * 4;
        let cell = { char: " ", r: 0, g: 0, b: 0 };
        if (rowCells) {
          const item = rowCells[c];
          if (item) {
            cell = item;
          }
        }

        let ascii = cell.char.charCodeAt(0) || 32;
        if (ascii === 160) ascii = 32; // nbsp -> space
        if (cell.char === "»") ascii = 127;
        if (ascii > 127 || ascii < 0) ascii = 63; // '?'

        arr[idx] = ascii;
        arr[idx + 1] = cell.r;
        arr[idx + 2] = cell.g;
        arr[idx + 3] = cell.b;
      }
    }

    gl.bindTexture(gl.TEXTURE_2D, this.gridTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, arr);

    // 使用 shader program
    gl.useProgram(this.program);

    // 绑定 textures
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fontTex);
    setUniform1i(gl, this.uFontTex, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.gridTex);
    setUniform1i(gl, this.uGridTex, 1);

    // 绑定 uniforms
    setUniform2f(gl, this.uGridSize, cols, rows);
    setUniform2f(gl, this.uResolution, w, h);
    // 每个字符物理像素大小 = (charWidth * dpr) x (rowHeight * dpr)
    setUniform2f(gl, this.uCharSize, this.charWidth * dpr, this.rowHeight * dpr);
    // 相对当前行
    setUniform1f(gl, this.uCurrentRow, currentRow);
    if (this.uCurrentRowBgColor) {
      gl.uniform4f(
        this.uCurrentRowBgColor,
        currentRowBgColor.r / 255.0,
        currentRowBgColor.g / 255.0,
        currentRowBgColor.b / 255.0,
        currentRowBgColor.a
      );
    }
    if (this.uBorderColor) {
      gl.uniform4f(
        this.uBorderColor,
        borderColor.r / 255.0,
        borderColor.g / 255.0,
        borderColor.b / 255.0,
        0.35
      );
    }
    if (this.uIsHorizontal) {
      gl.uniform1f(this.uIsHorizontal, isHorizontal ? 1.0 : 0.0);
    }

    // Draw
    bindQuad(gl, this.quadBuf, this.aPos, this.aUV);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  clear(): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  destroy(): void {
    const gl = this.gl;
    if (this.fontTex) gl.deleteTexture(this.fontTex);
    if (this.gridTex) gl.deleteTexture(this.gridTex);
    if (this.quadBuf) gl.deleteBuffer(this.quadBuf);
    if (this.program) gl.deleteProgram(this.program);
    this.canvas.remove();
  }
}
