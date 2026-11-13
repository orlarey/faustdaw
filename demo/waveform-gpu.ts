/****************************** waveform-gpu.ts *******************************
 *
 * Purpose: Render envelope waveforms from packed min/max texture data using a
 *          small WebGL2 pipeline.
 * How: Upload one float texture per resource × bucketSizeSamples (uploaded
 *      again when the resource's audio changes), then draw one
 *      quad per visible clip so the fragment shader turns each bucket texel
 *      into a vertical min/max segment.
 *
 ******************************************************************************/
import type { WaveformTextureLevel } from "./waveform-view/waveform-types.js";
import { resolveWaveformTexture, type WaveformTextureSlot } from "./waveform-texture-cache.js";

export type GpuEnvelopeWaveformJob = {
  resourceId: string;
  textureLevel: WaveformTextureLevel;
  totalFrames: number;
  leftPx: number;
  topPx: number;
  widthPx: number;
  heightPx: number;
};

type WaveformGpuRenderer = {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  vertexBuffer: WebGLBuffer;
  uCanvasSizePx: WebGLUniformLocation;
  uClipRectPx: WebGLUniformLocation;
  uInnerSizePx: WebGLUniformLocation;
  uTotalFrames: WebGLUniformLocation;
  uBucketSizeSamples: WebGLUniformLocation;
  uBucketCount: WebGLUniformLocation;
  uColor: WebGLUniformLocation;
  uMinMaxTexture: WebGLUniformLocation;
  /** One slot per resource id × bucket size; see waveform-texture-cache.ts. */
  textures: Map<string, WaveformTextureSlot<WebGLTexture>>;
};

const VERTEX_SHADER_SOURCE = `#version 300 es
in vec2 a_position;

uniform vec2 u_canvasSizePx;
uniform vec4 u_clipRectPx;

out vec2 v_localUv;

void main() {
  vec2 pixelPosition = u_clipRectPx.xy + a_position * u_clipRectPx.zw;
  vec2 clipPosition = vec2(
    pixelPosition.x / u_canvasSizePx.x * 2.0 - 1.0,
    1.0 - pixelPosition.y / u_canvasSizePx.y * 2.0
  );
  gl_Position = vec4(clipPosition, 0.0, 1.0);
  v_localUv = a_position;
}
`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D u_minMaxTexture;
uniform vec2 u_innerSizePx;
uniform float u_totalFrames;
uniform float u_bucketSizeSamples;
uniform float u_bucketCount;
uniform vec4 u_color;

in vec2 v_localUv;

out vec4 outColor;

void main() {
  float innerWidthPx = max(u_innerSizePx.x, 1.0);
  float innerHeightPx = max(u_innerSizePx.y, 1.0);
  float localX = v_localUv.x * innerWidthPx;
  float localY = v_localUv.y * innerHeightPx;
  float bucketSpan = u_totalFrames / u_bucketSizeSamples;
  float bucketIndexFloat = floor((localX / innerWidthPx) * bucketSpan);
  float clampedBucketIndex = clamp(bucketIndexFloat, 0.0, u_bucketCount - 1.0);
  int textureBucketIndex = int(clampedBucketIndex + 0.5);

  vec2 minMax = texelFetch(u_minMaxTexture, ivec2(textureBucketIndex, 0), 0).rg;
  float minValue = minMax.r;
  float maxValue = minMax.g;

  float centerY = innerHeightPx * 0.5;
  float amplitudeScale = innerHeightPx * 0.42;
  float yTop = centerY - maxValue * amplitudeScale;
  float yBottom = centerY - minValue * amplitudeScale;
  float segmentTop = min(yTop, yBottom);
  float segmentBottom = max(yTop, yBottom);
  if ((segmentBottom - segmentTop) < 1.0) {
    float segmentCenter = (segmentTop + segmentBottom) * 0.5;
    segmentTop = segmentCenter - 0.5;
    segmentBottom = segmentCenter + 0.5;
  }

  if (localY < segmentTop || localY > segmentBottom) {
    discard;
  }

  outColor = u_color;
}
`;

let waveformGpuRenderer: WaveformGpuRenderer | null = null;
let waveformGpuRendererUnavailable = false;

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Unable to allocate WebGL shader");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) ?? "Unknown shader compile error";
    gl.deleteShader(shader);
    throw new Error(info);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new Error("Unable to allocate WebGL program");
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) ?? "Unknown shader link error";
    gl.deleteProgram(program);
    throw new Error(info);
  }
  return program;
}

function getRequiredUniform(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name);
  if (!location) {
    throw new Error(`Missing uniform: ${name}`);
  }
  return location;
}

function ensureWaveformGpuRenderer(): WaveformGpuRenderer | null {
  if (waveformGpuRendererUnavailable) {
    return null;
  }
  if (waveformGpuRenderer) {
    return waveformGpuRenderer;
  }
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      waveformGpuRendererUnavailable = true;
      return null;
    }
    const program = createProgram(gl);
    const vao = gl.createVertexArray();
    const vertexBuffer = gl.createBuffer();
    if (!vao || !vertexBuffer) {
      throw new Error("Unable to allocate WebGL geometry buffers");
    }
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        0, 0,
        1, 0,
        0, 1,
        1, 1,
      ]),
      gl.STATIC_DRAW,
    );
    const positionLocation = gl.getAttribLocation(program, "a_position");
    if (positionLocation < 0) {
      throw new Error("Missing a_position attribute");
    }
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    waveformGpuRenderer = {
      canvas,
      gl,
      program,
      vao,
      vertexBuffer,
      uCanvasSizePx: getRequiredUniform(gl, program, "u_canvasSizePx"),
      uClipRectPx: getRequiredUniform(gl, program, "u_clipRectPx"),
      uInnerSizePx: getRequiredUniform(gl, program, "u_innerSizePx"),
      uTotalFrames: getRequiredUniform(gl, program, "u_totalFrames"),
      uBucketSizeSamples: getRequiredUniform(gl, program, "u_bucketSizeSamples"),
      uBucketCount: getRequiredUniform(gl, program, "u_bucketCount"),
      uColor: getRequiredUniform(gl, program, "u_color"),
      uMinMaxTexture: getRequiredUniform(gl, program, "u_minMaxTexture"),
      textures: new Map(),
    };
    return waveformGpuRenderer;
  } catch {
    waveformGpuRendererUnavailable = true;
    waveformGpuRenderer = null;
    return null;
  }
}

function ensureRendererCanvasSize(
  renderer: WaveformGpuRenderer,
  widthPx: number,
  heightPx: number,
): {
  widthPx: number;
  heightPx: number;
  deviceScaleX: number;
  deviceScaleY: number;
  drawingBufferWidthPx: number;
  drawingBufferHeightPx: number;
} {
  const devicePixelRatio = window.devicePixelRatio || 1;
  const roundedWidthPx = Math.max(1, Math.round(widthPx));
  const roundedHeightPx = Math.max(1, Math.round(heightPx));
  const backingWidth = Math.max(1, Math.round(roundedWidthPx * devicePixelRatio));
  const backingHeight = Math.max(1, Math.round(roundedHeightPx * devicePixelRatio));
  if (renderer.canvas.width !== backingWidth) {
    renderer.canvas.width = backingWidth;
  }
  if (renderer.canvas.height !== backingHeight) {
    renderer.canvas.height = backingHeight;
  }
  const drawingBufferWidthPx = Math.max(1, renderer.gl.drawingBufferWidth || renderer.canvas.width);
  const drawingBufferHeightPx = Math.max(1, renderer.gl.drawingBufferHeight || renderer.canvas.height);
  renderer.gl.viewport(0, 0, drawingBufferWidthPx, drawingBufferHeightPx);
  return {
    widthPx: roundedWidthPx,
    heightPx: roundedHeightPx,
    deviceScaleX: drawingBufferWidthPx / roundedWidthPx,
    deviceScaleY: drawingBufferHeightPx / roundedHeightPx,
    drawingBufferWidthPx,
    drawingBufferHeightPx,
  };
}

function getTextureCacheKey(resourceId: string, textureLevel: WaveformTextureLevel): string {
  return `${resourceId};${textureLevel.bucketSizeSamples}`;
}

function ensureWaveformTexture(
  renderer: WaveformGpuRenderer,
  resourceId: string,
  textureLevel: WaveformTextureLevel,
): WebGLTexture | null {
  const { gl } = renderer;
  return resolveWaveformTexture(renderer.textures, getTextureCacheKey(resourceId, textureLevel), textureLevel.packedMinMax, {
    create: () => {
      const texture = gl.createTexture();
      if (!texture) {
        return null;
      }
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D, null);
      return texture;
    },
    upload: (texture, packedMinMax) => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      // One RG texel (min, max) per bucket.
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, packedMinMax.length / 2, 1, 0, gl.RG, gl.FLOAT, packedMinMax);
      gl.bindTexture(gl.TEXTURE_2D, null);
    },
  });
}

/**
 * Purpose: Render the visible envelope waveform segments with WebGL2 and composite them over the target 2D canvas.
 * How: Draw one quad per clip into a transparent helper canvas, then copy that helper canvas into the target context.
 */
/**
 * Purpose: Expose the GPU's MAX_TEXTURE_SIZE so the painter can avoid
 *          dispatching envelope jobs whose bucketCount overflows a single
 *          1D texture row — `texImage2D` silently truncates / zero-fills
 *          oversized widths, producing a flat-zero waveform instead of
 *          erroring out. Returns 0 when the renderer is unavailable.
 */
export function getWaveformGpuMaxTextureWidth(): number {
  const renderer = ensureWaveformGpuRenderer();
  if (!renderer) return 0;
  const maxSize = renderer.gl.getParameter(renderer.gl.MAX_TEXTURE_SIZE);
  return typeof maxSize === "number" && Number.isFinite(maxSize) ? maxSize : 0;
}

export function drawEnvelopeWaveformsWithGpu(
  targetContext: CanvasRenderingContext2D,
  canvasWidthPx: number,
  canvasHeightPx: number,
  jobs: readonly GpuEnvelopeWaveformJob[],
): boolean {
  if (jobs.length === 0) {
    return false;
  }
  const renderer = ensureWaveformGpuRenderer();
  if (!renderer) {
    return false;
  }

  try {
    const { gl } = renderer;
    const {
      widthPx,
      heightPx,
      deviceScaleX,
      deviceScaleY,
      drawingBufferWidthPx,
      drawingBufferHeightPx,
    } = ensureRendererCanvasSize(renderer, canvasWidthPx, canvasHeightPx);

    gl.useProgram(renderer.program);
    gl.bindVertexArray(renderer.vao);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(renderer.uCanvasSizePx, drawingBufferWidthPx, drawingBufferHeightPx);
    gl.uniform4f(renderer.uColor, 1, 244 / 255, 244 / 255, 0.9);
    gl.uniform1i(renderer.uMinMaxTexture, 0);

    for (const job of jobs) {
      const innerLeftPx = job.leftPx * deviceScaleX;
      const innerTopPx = (job.topPx + 4) * deviceScaleY;
      const innerWidthPx = Math.max(job.widthPx, 0) * deviceScaleX;
      const innerHeightPx = Math.max(job.heightPx - 8, 0) * deviceScaleY;
      if (innerWidthPx <= 1 || innerHeightPx <= 1 || job.totalFrames <= 0 || job.textureLevel.bucketCount <= 0) {
        continue;
      }
      const texture = ensureWaveformTexture(renderer, job.resourceId, job.textureLevel);
      if (!texture) {
        continue;
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform4f(renderer.uClipRectPx, innerLeftPx, innerTopPx, innerWidthPx, innerHeightPx);
      gl.uniform2f(renderer.uInnerSizePx, innerWidthPx, innerHeightPx);
      gl.uniform1f(renderer.uTotalFrames, job.totalFrames);
      gl.uniform1f(renderer.uBucketSizeSamples, job.textureLevel.bucketSizeSamples);
      gl.uniform1f(renderer.uBucketCount, job.textureLevel.bucketCount);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    gl.bindVertexArray(null);
    gl.useProgram(null);
    targetContext.drawImage(renderer.canvas, 0, 0, widthPx, heightPx);
    return true;
  } catch {
    waveformGpuRendererUnavailable = true;
    waveformGpuRenderer = null;
    return false;
  }
}
