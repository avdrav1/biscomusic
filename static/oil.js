// The Now playing title in moving oil-slick colours: simplex noise posterized into iridescent rings with
// dark oil between them (a WebGL shader after an "Oil Spill" Three.js sketch), drawn only inside the letters.
// The sketch's noise had a typo (dot(v, ...) for dot(i, ...)) that zeroed it more and more as time grew:
// its six-pass swirl warp never moved anything, and after about a minute the whole picture went flat green.
// This uses the correct noise and leaves out the warp, which renders what the sketch showed in its first
// seconds, but for as long as the radio plays.
// The real text stays in the page for layout, selection and screen readers; it turns transparent only
// once WebGL is running, and a canvas over it paints the letters at the positions the browser laid out.
// Without WebGL the title is plain text. With prefers-reduced-motion it's a still frame.
window.oilText = el => {
  const PAD = 10;          // CSS px of canvas around the text box, for glyphs that overhang their line box
  const SWIRL_PX = 90;     // CSS px per shader unit: the size of the swirls, the same for one line or two
  const canvas = document.createElement('canvas');
  canvas.className = 'oil-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, antialias: false });
  if (!gl) return;

  const vertex = `
    attribute vec2 aPos;
    varying vec2 vUv;
    void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
  const fragment = `
    precision highp float;
    uniform float uTime;
    uniform vec2 uResolution;   // device px
    uniform float uUnit;        // device px per shader unit
    uniform vec2 uMouse;        // device px, from the bottom left
    uniform sampler2D uMask;    // the letters
    varying vec2 vUv;

    // 3D simplex noise (Ashima Arts)
    vec4 permute(vec4 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
    float snoise(vec3 v) {
      const vec2 C = vec2(1.0/6.0, 1.0/3.0);
      const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
      vec3 i = floor(v + dot(v, C.yyy));
      vec3 x0 = v - i + dot(i, C.xxx);
      vec3 g = step(x0.yzx, x0.xyz);
      vec3 l = 1.0 - g;
      vec3 i1 = min(g.xyz, l.zxy);
      vec3 i2 = max(g.xyz, l.zxy);
      vec3 x1 = x0 - i1 + C.xxx;
      vec3 x2 = x0 - i2 + 2.0 * C.xxx;
      vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
      i = mod(i, 289.0);
      vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
      float n_ = 1.0/7.0;
      vec3 ns = n_ * D.wyz - D.xzx;
      vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
      vec4 x_ = floor(j * ns.z);
      vec4 y_ = floor(j - 7.0 * x_);
      vec4 x = x_ * ns.x + ns.yyyy;
      vec4 y = y_ * ns.x + ns.yyyy;
      vec4 h = 1.0 - abs(x) - abs(y);
      vec4 b0 = vec4(x.xy, y.xy);
      vec4 b1 = vec4(x.zw, y.zw);
      vec4 s0 = floor(b0)*2.0 + 1.0;
      vec4 s1 = floor(b1)*2.0 + 1.0;
      vec4 sh = -step(h, vec4(0.0));
      vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
      vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
      vec3 p0 = vec3(a0.xy, h.x);
      vec3 p1 = vec3(a0.zw, h.y);
      vec3 p2 = vec3(a1.xy, h.z);
      vec3 p3 = vec3(a1.zw, h.w);
      vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
      p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
      vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
      m = m * m;
      return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
    }

    // Iridescent thin-film cosine palette (Inigo Quilez)
    vec3 oilPalette(float t) {
      return vec3(0.5) + vec3(0.5) * cos(6.28318 * (t + vec3(0.00, 0.33, 0.67)));
    }

    void main() {
      float alpha = texture2D(uMask, vUv).a;
      if (alpha < 0.004) { gl_FragColor = vec4(0.0); return; }

      vec2 uv = (vUv * uResolution - 0.5 * uResolution) / uUnit;
      vec2 mouse = (uMouse - 0.5 * uResolution) / uUnit;
      uv += (mouse - uv) * 0.08 * exp(-length(uv - mouse));   // a subtle pull toward the pointer

      float t = uTime * 0.12;
      float n = snoise(vec3(uv * 1.26, t * 0.8));
      float val = n * 0.5 + 0.5;

      // Posterized bands with soft edges, iridescent ridges and dark oil troughs between them
      float bands = 14.0;
      float scaled = val * bands;
      float posterized = (floor(scaled) + smoothstep(0.75, 0.95, fract(scaled))) / bands;
      vec3 iridescence = oilPalette(posterized * 2.2 - t * 0.5);
      float darkMask = smoothstep(0.15, 0.55, sin(scaled * 3.14159));
      // Troughs lifted from the original near-black so the letters stay readable on the dark card
      vec3 color = mix(vec3(0.24, 0.22, 0.3), iridescence, darkMask);
      color += smoothstep(0.4, 0.0, abs(n)) * oilPalette(val + 0.2) * 0.25;   // sheen along the ridges

      gl_FragColor = vec4(color * alpha, alpha);
    }`;

  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const vs = shader(gl.VERTEX_SHADER, vertex), fs = shader(gl.FRAGMENT_SHADER, fragment);
  if (!vs || !fs) return;
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
  gl.useProgram(program);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const u = name => gl.getUniformLocation(program, name);
  const uTime = u('uTime'), uResolution = u('uResolution'), uUnit = u('uUnit'), uMouse = u('uMouse');

  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);   // canvas rows run top down, GL textures bottom up
  const mask = document.createElement('canvas'), ctx = mask.getContext('2d');

  el.after(canvas);   // a sibling, so setting the title's textContent leaves it alone
  el.classList.add('oil');

  // Paint the letters into the mask exactly where the browser put them: one glyph at a time, from the
  // layout rectangles of the real text, so wrapping, kerning and letter-spacing all match.
  let dpr = 1, width = 0, height = 0;
  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const box = el.getBoundingClientRect();
    width = Math.max(1, Math.round((box.width + 2 * PAD) * dpr));
    height = Math.max(1, Math.round((box.height + 2 * PAD) * dpr));
    canvas.style.width = `${box.width + 2 * PAD}px`;
    canvas.style.height = `${box.height + 2 * PAD}px`;
    canvas.width = mask.width = width;
    canvas.height = mask.height = height;

    const style = getComputedStyle(el);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'alphabetic';
    const ascent = ctx.measureText('Hg').fontBoundingBoxAscent;
    const range = document.createRange();
    for (const node of el.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      let offset = 0;
      for (const ch of node.data) {
        range.setStart(node, offset);
        range.setEnd(node, offset + ch.length);
        offset += ch.length;
        if (!ch.trim()) continue;
        const r = range.getClientRects()[0];
        if (r) ctx.fillText(ch, r.left - box.left + PAD, r.top - box.top + PAD + ascent);
      }
    }
    gl.viewport(0, 0, width, height);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask);
    gl.uniform2f(uResolution, width, height);
    gl.uniform1f(uUnit, SWIRL_PX * dpr);
    draw();
  }

  let mouse = [-1e4, -1e4];
  addEventListener('pointermove', e => {
    const r = canvas.getBoundingClientRect();
    mouse = [(e.clientX - r.left) * dpr, (r.bottom - e.clientY) * dpr];
  }, { passive: true });

  const start = performance.now();
  let left = null, top = null;
  function draw() {
    // Follow the title if something above it in the card moves it (its size changes come via relayout)
    if (el.offsetLeft !== left || el.offsetTop !== top) {
      left = el.offsetLeft;
      top = el.offsetTop;
      canvas.style.left = `${left - PAD}px`;
      canvas.style.top = `${top - PAD}px`;
    }
    gl.uniform1f(uTime, still.matches ? 0 : (performance.now() - start) / 1000);
    gl.uniform2f(uMouse, mouse[0], mouse[1]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // Animate only while the title is on screen (requestAnimationFrame already stops in hidden tabs).
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let onScreen = true, frame = 0;
  const loop = () => { draw(); frame = requestAnimationFrame(loop); };
  const run = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    if (onScreen && !still.matches) frame = requestAnimationFrame(loop);
  };
  new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; run(); }).observe(canvas);
  still.addEventListener('change', run);

  let pending = 0;
  const relayout = () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(layout); };
  new MutationObserver(relayout).observe(el, { childList: true, characterData: true, subtree: true });
  new ResizeObserver(relayout).observe(el);
  document.fonts?.ready.then(relayout);

  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault();
    cancelAnimationFrame(frame);
    el.classList.remove('oil');   // plain text until the page is reloaded
    canvas.remove();
  });

  layout();
  run();
};
