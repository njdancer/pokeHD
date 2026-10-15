// Lights the trading card (WebGL2, one quad): the print from face.ts, bumped by its height map,
// under a lamp above and to the left of the player and a soft room for metal to reflect. The card
// turns on screen with a CSS transform; the shader is given the same turn, so the lamp, the gloss
// and the foil move across it the way they would on a real card in your hand.

import type { CardImages } from "./face.ts";

/** 0 holo (rainbow starlight in the picture), 1 reverse (lined foil around it), 2 gold (etched). */
export type FinishCode = 0 | 1 | 2;

export interface CardLight {
  /** Card-to-world turn (column-major 3 × 3), as the CSS transform turns it. */
  turn: Float32Array;
  /** The eye's distance from the card, in card widths (CSS perspective ÷ card width). */
  eye: number;
  finish: FinishCode;
  /** 0–1.5: how strongly the foil plays. */
  foil: number;
  /** 0–1.5: the varnish's gloss and glare. */
  shine: number;
  /** 0–2: how raised the print feels. */
  bump: number;
  back: boolean;
}

export interface CardRenderer {
  setImages(side: "front" | "back", images: CardImages): void;
  draw(light: CardLight): void;
  dispose(): void;
}

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uFace;
uniform sampler2D uMaps;
uniform vec2 uTexel;
uniform mat3 uTurn;
uniform float uEye, uAspect, uFoil, uShine, uBump, uFlip;
uniform int uFinish;

const vec3 LAMP = vec3(-0.55, 0.95, 1.35);

vec3 spectrum(float t) { return 0.5 + 0.5 * cos(6.2832 * (t + vec3(0.0, 0.33, 0.67))); }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

void main() {
  // The back is the same card seen from behind: mirror it so it reads the right way round.
  vec2 uv = vec2(uFlip > 0.5 ? 1.0 - vUv.x : vUv.x, vUv.y);
  vec4 face = texture(uFace, uv);
  if (face.a < 0.004) discard;
  vec3 maps = texture(uMaps, uv).rgb;
  float foil = maps.g * uFoil, metal = maps.b;

  // The print's relief: slopes of the height map, per card unit whatever the texture's size.
  float perUnit = 1.0 / (uTexel.x * 630.0);
  float hx = texture(uMaps, uv + vec2(uTexel.x, 0.0)).r - texture(uMaps, uv - vec2(uTexel.x, 0.0)).r;
  float hy = texture(uMaps, uv + vec2(0.0, uTexel.y)).r - texture(uMaps, uv - vec2(0.0, uTexel.y)).r;
  vec3 n = normalize(vec3(-hx, -hy, 0.0) * uBump * 1.6 * perUnit + vec3(0.0, 0.0, 1.0));

  // Eye and lamp brought into the card's own frame, so each point sees them from its own angle.
  mat3 toCard = transpose(uTurn);
  vec3 p = vec3(uv.x - 0.5, (uv.y - 0.5) * uAspect, 0.0);
  vec3 eye = toCard * vec3(0.0, 0.0, uEye);
  vec3 lamp = toCard * LAMP;
  vec3 V = normalize(eye - p);
  vec3 L = normalize(lamp - p);
  vec3 H = normalize(L + V);

  // Foil: a microstructure under the ink, different for each finish.
  vec3 fn = n;
  float sparkle = 0.0;
  float t = 0.0;
  vec2 q = vec2(p.x, p.y);
  if (uFinish == 0) {
    // Starlight holo: tiny tilted facets, a few of them catching the lamp at a time.
    vec2 grid = uv * vec2(170.0, 170.0 * uAspect);
    vec2 cell = floor(grid);
    vec3 facet = vec3(hash(cell) - 0.5, hash(cell + 7.1) - 0.5, 0.0);
    fn = normalize(n + facet * 0.5);
    float star = smoothstep(0.45, 0.0, length(fract(grid) - 0.5));
    sparkle = pow(max(dot(fn, H), 0.0), 220.0) * step(0.72, hash(cell + 3.3)) * star * 2.4;
    t = dot(q, vec2(0.8, 1.25)) * 1.6 + dot(V.xy, vec2(2.4, 1.8)) + dot(L.xy, vec2(0.6, 0.4));
  } else if (uFinish == 1) {
    // Reverse holo: fine diagonal grooves, shimmering across them as the card turns.
    float g = sin((q.x - q.y) * 520.0);
    fn = normalize(n + vec3(0.7071, -0.7071, 0.0) * g * 0.18);
    t = q.y * 1.6 - q.x * 0.6 + dot(V.xy, vec2(2.6, 1.4));
  } else {
    // Gold: a sunburst etched out from behind the picture.
    vec2 c = q - vec2(0.0, 0.178 * uAspect);
    float a = atan(c.y, c.x);
    float g = sin(a * 110.0);
    vec2 tangent = vec2(-c.y, c.x) / max(length(c), 1e-3);
    fn = normalize(n + vec3(tangent * g * 0.22, 0.0));
    vec2 cell = floor(uv * vec2(140.0, 140.0 * uAspect));
    sparkle = pow(max(dot(fn, H), 0.0), 400.0) * step(0.7, hash(cell)) * 1.4;
    t = length(c) * 2.2 + dot(V.xy, vec2(1.6, 1.2));
  }

  // Printed ink: lit by the lamp over a bright room, so the relief shows without darkening it.
  float diffuse = max(dot(n, L), 0.0);
  vec3 col = face.rgb * (0.74 + 0.36 * diffuse);

  // Metal (the picture's frame, the ribbon, a gold card): reflects the room, a bright window up
  // and to the left, so its shine slides across as the card turns.
  vec3 R = uTurn * reflect(-V, n);
  float room = 0.22 + 0.75 * smoothstep(-0.1, 0.85, R.y) + 0.9 * exp(-pow((R.x + 0.35) * 4.5, 2.0)) * smoothstep(-0.2, 0.5, R.y);
  vec3 metalCol = face.rgb * (0.3 + room * 1.05) + face.rgb * pow(max(dot(n, H), 0.0), 40.0) * 0.9;
  col = mix(col, metalCol, metal);

  // Foil: the print is see-through ink over a mirror that splits the light into colours.
  float catchLight = pow(max(dot(fn, H), 0.0), 4.0);
  vec3 rainbow = mix(vec3(1.0), spectrum(t), 0.62);
  vec3 foilCol = face.rgb * (0.5 + rainbow * (0.22 + 0.85 * catchLight)) + rainbow * catchLight * 0.16;
  col = mix(col, foilCol, clamp(foil, 0.0, 1.0)) + (foilCol - col) * max(foil - 1.0, 0.0);
  col += vec3(1.0, 0.97, 0.9) * sparkle * clamp(foil, 0.0, 1.5);

  // Varnish over everything: a sharp highlight from the lamp, a broad sheen, a little rim.
  float nh = max(dot(n, H), 0.0);
  col += vec3(1.0, 0.98, 0.94) * (pow(nh, 110.0) * 0.55 + pow(nh, 14.0) * 0.08) * uShine;
  col += pow(1.0 - max(dot(n, V), 0.0), 5.0) * 0.12 * uShine;

  outColor = vec4(col * face.a, face.a);
}`;

function shader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`card shader: ${gl.getShaderInfoLog(s)}`);
  return s;
}

/** A renderer for one card on `canvas`, or null where WebGL2 isn't available (the card then shows unlit). */
export function createCardRenderer(canvas: HTMLCanvasElement): CardRenderer | null {
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return null;
  let program: WebGLProgram;
  try {
    program = gl.createProgram()!;
    gl.attachShader(program, shader(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, shader(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`card program: ${gl.getProgramInfoLog(program)}`);
  } catch (e) {
    console.warn(e);
    return null;
  }
  gl.useProgram(program);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const u = (name: string) => gl.getUniformLocation(program, name);
  const loc = {
    face: u("uFace"), maps: u("uMaps"), texel: u("uTexel"), turn: u("uTurn"), eye: u("uEye"), aspect: u("uAspect"),
    foil: u("uFoil"), shine: u("uShine"), bump: u("uBump"), flip: u("uFlip"), finish: u("uFinish"),
  };
  gl.uniform1i(loc.face, 0);
  gl.uniform1i(loc.maps, 1);

  const sides: Record<"front" | "back", { face: WebGLTexture; maps: WebGLTexture; w: number; h: number } | null> = { front: null, back: null };
  const upload = (tex: WebGLTexture, img: HTMLCanvasElement) => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };

  return {
    setImages(side, images) {
      const old = sides[side];
      const face = old?.face ?? gl.createTexture()!;
      const maps = old?.maps ?? gl.createTexture()!;
      upload(face, images.face);
      upload(maps, images.maps);
      sides[side] = { face, maps, w: images.face.width, h: images.face.height };
    },
    draw(light) {
      const side = sides[light.back ? "back" : "front"];
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!side) return;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, side.face);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, side.maps);
      gl.uniform2f(loc.texel, 1 / side.w, 1 / side.h);
      gl.uniformMatrix3fv(loc.turn, false, light.turn);
      gl.uniform1f(loc.eye, light.eye);
      gl.uniform1f(loc.aspect, side.h / side.w);
      gl.uniform1f(loc.foil, light.foil);
      gl.uniform1f(loc.shine, light.shine);
      gl.uniform1f(loc.bump, light.bump);
      gl.uniform1f(loc.flip, light.back ? 1 : 0);
      gl.uniform1i(loc.finish, light.finish);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    dispose() {
      for (const s of Object.values(sides)) {
        if (!s) continue;
        gl.deleteTexture(s.face);
        gl.deleteTexture(s.maps);
      }
      gl.deleteBuffer(buf);
      gl.deleteProgram(program);
      // The context stays: React's development double mount hands the same canvas back, and a lost
      // context can't be had again. It goes with the canvas.
    },
  };
}
