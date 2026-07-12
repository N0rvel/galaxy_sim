/**
 * "liquid glass" surfaces: the backdrop showing through the
 * element is refracted along its rounded edges, like light bending through
 * the bevel of a thick glass slab.
 *
 * WebGL2 implementation (2026-07): the video backdrop is uploaded once per
 * video frame into a texture on a single shared offscreen WebGL canvas; each
 * glass surface is a quad rendered into its own slot of that atlas by a
 * fragment shader (rounded-rect SDF bezel + chromatic aberration), then
 * blitted into a small DOM-anchored 2D canvas inside the element. Everything
 * stays on the GPU - no SVG filters (black glass on Firefox, and their
 * displacement chain re-ran on every scrolled frame), no per-frame
 * video→canvas2D readback, no CPU-generated displacement maps for rects.
 */

const BEZEL = 30;        // px: width of the refracting rim (rest stays flat)
const STRENGTH = 150;     // displacement scale at the rim edge (SVG feDisplacementMap semantics)
const ABERRATION = 0.1;  // relative displacement offset between color channels
const PADDING = 80;      // px: how far beyond the element the canvas extends,
                         // so edge refraction can pull light from outside it
                         // (must exceed STRENGTH * (1 + ABERRATION) / 2)

// The SVG-filter era capped elements at 260k device px; the WebGL shader is
// cheap enough to render near-native (the cap now mostly guards huge screens).
const MAX_SLOT_AREA = 2000000; // device px per element
const SCALE_MIN = 0.35;        // never go softer than this
const DPR_CAP = 2;

// Glass TEXT (class "liquid-glass-text"): the glyphs themselves become the
// glass - the refracting rim follows the letter outlines. Strokes are thin,
// so they use their own bezel width and a gentler displacement. Calibrated
// at TEXT_REF_SIZE px font and scaled with the actual font size, so the
// glass look survives responsive shrinking (a fixed 30px bezel swallows
// small glyphs whole - rainbow soup instead of a rim).
const TEXT_BEZEL = 30;
const TEXT_STRENGTH = 200;
const TEXT_REF_SIZE = 230;

// Firefox on Android (device-diagnosed 2026-07-11 via /diag.html):
// - texSubImage2D from a <video> silently no-ops → frozen first frame;
//   texImage2D re-upload per frame works. So we always full-upload.
// - canvas2d drawImage(video) yields black (unreadable hw decoder surface).
// - the <video> element intermittently stops compositing while WebGL reads
//   it. So there the visible backdrop is rendered BY WebGL too: a
//   fullscreen passthrough slot in the atlas, blitted to a 2D canvas
//   (canvas→canvas blits are reliable), and the <video> only decodes.
const GL_BACKDROP = typeof navigator !== 'undefined'
    && /Android/i.test(navigator.userAgent)
    && /Firefox\//i.test(navigator.userAgent);

const VERT = `#version 300 es
in vec2 aPos;
uniform vec4 uSlot;   // slot rect in atlas bitmap px, top-left origin
uniform vec2 uAtlas;  // atlas size in px
out vec2 vUV;
void main() {
    vUV = aPos;
    vec2 p = (uSlot.xy + aPos * uSlot.zw) / uAtlas;
    gl_Position = vec4(p.x * 2. - 1., 1. - p.y * 2., 0., 1.);
}`;

// The refraction: same recipe as the previous SVG filter chain. Bezel
// displacement follows the outward normal, eased (1-t)^2.2 from the edge;
// R/G/B sample at slightly different displacement scales (chromatic
// aberration); glass text multiplies by the glyph mask and lifts the
// result (the old feComponentTransfer slope 1.25 / intercept 0.02).
const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uVideo;
uniform sampler2D uMap;    // text mode: R/G displacement, B glyph mask
uniform int uMode;         // 0 = rounded rect (analytic SDF), 1 = glass text, 2 = passthrough fond
uniform vec2 uQuadSize;    // quad size in screen px (element + 2*PADDING)
uniform vec2 uRectSize;    // element size in screen px
uniform float uRadius;
uniform float uBezel;
uniform float uStrength;   // effective displacement in screen px
uniform float uAberration;
uniform float uBlur;       // frost blur radius in screen px
uniform vec2 uUV0;         // video UV of the quad's top-left corner
uniform vec2 uUVScale;     // quad size in video UV
uniform vec2 uPxToUV;      // one screen px in video UV
in vec2 vUV;
out vec4 outColor;

float sdRect(vec2 p, vec2 half_, float r) {
    vec2 q = abs(p) - (half_ - vec2(r));
    return min(max(q.x, q.y), 0.) + length(max(q, vec2(0.))) - r;
}

vec3 sampleGlass(vec2 base, vec2 duv) {
    return vec3(
        texture(uVideo, base + duv * (1. + uAberration)).r,
        texture(uVideo, base + duv).g,
        texture(uVideo, base + duv * (1. - uAberration)).b);
}

void main() {
    vec2 disp = vec2(0.);
    float mask = 1.;
    if (uMode == 0) {
        vec2 p = (vUV - .5) * uQuadSize;
        vec2 half_ = uRectSize * .5;
        float d = sdRect(p, half_, uRadius);
        if (d >= 0.) { outColor = vec4(0.); return; }
        mask = min(-d, 1.); // 1px feather; the DOM wrap's border-radius does the real clip
        if (d > -uBezel) {
            float m = pow(1. + d / uBezel, 2.2);
            float e = 1.;
            vec2 g = vec2(
                sdRect(p + vec2(e, 0.), half_, uRadius) - sdRect(p - vec2(e, 0.), half_, uRadius),
                sdRect(p + vec2(0., e), half_, uRadius) - sdRect(p - vec2(0., e), half_, uRadius));
            disp = g / max(length(g), 1e-4) * m;
        }
    } else if (uMode == 1) {
        vec4 map = texture(uMap, vUV);
        mask = map.b;
        if (mask <= 0.004) { outColor = vec4(0.); return; }
        disp = map.rg * 2. - 1.;
    }
    // uMode == 2: fullscreen passthrough - no shape, no displacement
    vec2 base = uUV0 + vUV * uUVScale;
    vec2 duv = disp * uStrength * uPxToUV;
    vec3 col;
    if (uBlur > .01) {
        col = vec3(0.);
        for (int i = -1; i <= 1; i++)
            for (int j = -1; j <= 1; j++)
                col += sampleGlass(base + vec2(float(i), float(j)) * uBlur * uPxToUV, duv);
        col /= 9.;
    } else {
        col = sampleGlass(base, duv);
    }
    if (uMode == 1) col = col * 1.25 + .02;
    outColor = vec4(col * mask, mask); // premultiplied for the 2D blit
}`;

function boxBlurH(src, dst, w, h, r) {
    const norm = 1 / (2 * r + 1);
    for (let y = 0; y < h; y++) {
        const row = y * w;
        let acc = 0;
        for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
        for (let x = 0; x < w; x++) {
            dst[row + x] = acc * norm;
            acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
        }
    }
}

function boxBlurV(src, dst, w, h, r) {
    const norm = 1 / (2 * r + 1);
    for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let y = -r; y <= r; y++) acc += src[Math.min(h - 1, Math.max(0, y)) * w + x];
        for (let y = 0; y < h; y++) {
            dst[y * w + x] = acc * norm;
            acc += src[Math.min(h - 1, y + r + 1) * w + x] - src[Math.max(0, y - r) * w + x];
        }
    }
}

/**
 * Displacement map for glass text: the element's text is rasterized into a
 * mask, a blurred copy of the mask approximates a distance field, and its
 * gradient gives the rim normals along the glyph outlines. R/G pack the
 * displacement, B packs the crisp glyph mask (routed into alpha by the
 * shader so the refracted video is clipped to the letters). Built once per
 * size change and uploaded as a texture - never per frame.
 */
function makeTextMap(el, width, height, dpr, bezel) {
    const w = Math.max(1, Math.round((width + 2 * PADDING) * dpr));
    const h = Math.max(1, Math.round((height + 2 * PADDING) * dpr));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const cs = getComputedStyle(el);
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${parseFloat(cs.fontSize) * dpr}px ${cs.fontFamily}`;
    const ls = parseFloat(cs.letterSpacing);
    if (ls && 'letterSpacing' in ctx) ctx.letterSpacing = `${ls * dpr}px`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    const lines = el.innerText.split('\n').map((l) => l.trim()).filter(Boolean);
    const lineH = (parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2) * dpr;
    const y0 = h / 2 - ((lines.length - 1) * lineH) / 2;
    lines.forEach((line, i) => ctx.fillText(line, w / 2, y0 + i * lineH));

    const maskData = ctx.getImageData(0, 0, w, h).data;
    const n = w * h;
    const field = new Float32Array(n);
    for (let i = 0; i < n; i++) field[i] = maskData[i * 4 + 3] / 255;
    // three box-blur passes ≈ a gaussian over the bezel width
    const r = Math.max(1, Math.round(bezel * dpr / 3));
    const tmp = new Float32Array(n);
    for (let p = 0; p < 3; p++) {
        boxBlurH(field, tmp, w, h, r);
        boxBlurV(tmp, field, w, h, r);
    }

    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = y * w + x;
            const a = maskData[i * 4 + 3];
            let dx = 0;
            let dy = 0;
            if (a > 0) {
                const t = Math.min(Math.max((field[i] - 0.5) * 2, 0), 1); // 0 at the edge, 1 deep inside
                const m = (1 - t) ** 2.2 * (a / 255);
                const gx = field[i + (x < w - 1 ? 1 : 0)] - field[i - (x > 0 ? 1 : 0)];
                const gy = field[i + (y < h - 1 ? w : 0)] - field[i - (y > 0 ? w : 0)];
                const len = Math.hypot(gx, gy) || 1;
                dx = -(gx / len) * m; // the field decreases outward
                dy = -(gy / len) * m;
            }
            const o = i * 4;
            img.data[o] = Math.round(127.5 + 127.5 * dx);
            img.data[o + 1] = Math.round(127.5 + 127.5 * dy);
            img.data[o + 2] = a;
            img.data[o + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
}

function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error(`liquid glass shader: ${gl.getShaderInfoLog(sh)}`);
    }
    return sh;
}

/**
 * Turn each element into a refracting glass surface over `video`.
 * The redraw loop stops when `container` leaves the DOM - so everything
 * dies with the landing screen. Throws if WebGL2 is unavailable; the caller
 * keeps the CSS backdrop-filter fallback in that case.
 */
export function applyLiquidGlass(elements, container = document.body,
    video = document.getElementById('fontVideo')) {
    if (!video) return;

    const atlas = document.createElement('canvas');
    const gl = atlas.getContext('webgl2', {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: true,
    });
    if (!gl) throw new Error('WebGL2 unavailable');

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error(`liquid glass link: ${gl.getProgramInfoLog(prog)}`);
    }
    gl.useProgram(prog);
    const U = {};
    for (const name of ['uSlot', 'uAtlas', 'uVideo', 'uMap', 'uMode', 'uQuadSize',
        'uRectSize', 'uRadius', 'uBezel', 'uStrength', 'uAberration', 'uBlur',
        'uUV0', 'uUVScale', 'uPxToUV']) {
        U[name] = gl.getUniformLocation(prog, name);
    }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.BLEND);
    gl.uniform1f(U.uAberration, ABERRATION);

    const makeTexture = () => {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return tex;
    };
    const videoTex = makeTexture();
    gl.uniform1i(U.uVideo, 0);
    gl.uniform1i(U.uMap, 1);

    // The backdrop canvas stays hidden until its first blit lands, so the
    // <video> element keeps showing (or at least occupying) the screen
    // during load - never a black page while the pipeline warms up.
    let backdrop = null;
    let backdropCtx = null;
    let backdropSlot = null;
    let backdropShown = false;
    let backdropDirty = false;
    let lastViewport = '';
    if (GL_BACKDROP) {
        backdrop = document.createElement('canvas');
        backdropCtx = backdrop.getContext('2d', { alpha: false });
        Object.assign(backdrop.style, {
            position: 'fixed',
            inset: '0',
            width: '100vw',
            height: '100vh',
            visibility: 'hidden',
        });
        video.parentNode.insertBefore(backdrop, video.nextSibling);
    }

    // Debug hook for /diag.html: expose the internals so the diagnostic page
    // can display the raw atlas and the backdrop bridge on-device.
    if (window.__LG_DEBUG) {
        window.__lgAtlas = atlas;
        window.__lgBackdrop = backdrop;
        window.__lgGl = gl;
    }

    let dead = false;
    const items = [];
    for (const el of elements) {
        const wrap = document.createElement('div');
        Object.assign(wrap.style, {
            position: 'absolute',
            inset: '0',
            overflow: 'hidden',
            borderRadius: 'inherit',
            zIndex: '-1',
            pointerEvents: 'none',
        });
        const canvas = document.createElement('canvas');
        Object.assign(canvas.style, {
            position: 'absolute',
            left: `${-PADDING}px`,
            top: `${-PADDING}px`,
        });
        wrap.appendChild(canvas);
        el.prepend(wrap);
        el.style.isolation = 'isolate'; // keep the z-index:-1 canvas inside

        // Glass text: the glyphs themselves are the glass - hide the real
        // text (kept for layout/selection/a11y), the canvas paints the
        // refracted video clipped to the letter shapes.
        const text = el.classList.contains('liquid-glass-text');
        if (text) {
            if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
            el.style.color = 'transparent';
        }

        items.push({
            el, wrap, canvas, ctx: canvas.getContext('2d'), text,
            key: '', slot: null, mapTex: text ? makeTexture() : null,
            blur: 0, lastPos: '',
        });
    }

    // A mobile GPU may evict the context: drop the canvases so the CSS
    // backdrop-filter fallback shows instead of frozen frames.
    // Full retreat to the CSS backdrop-filter fallback: used on GPU context
    // loss, and by the bridge watchdog when a device turns out to deliver
    // only black frames (better a frosted button than a black screen).
    const teardown = () => {
        dead = true;
        for (const item of items) {
            item.wrap.remove();
            if (item.text) item.el.style.color = '';
        }
        if (backdrop) {
            backdrop.remove();
            video.style.visibility = '';
        }
    };
    atlas.addEventListener('webglcontextlost', teardown);

    // The element's rounded-rect radius, resolved to px and clamped the way
    // the browser clamps it (pill shapes use radii up to half the box).
    const readRadius = (el, w, h) => {
        const raw = getComputedStyle(el).borderTopLeftRadius;
        let r = parseFloat(raw) || 0;
        if (raw.endsWith('%')) r = Math.min(w, h) * r / 100;
        return Math.min(r, w / 2, h / 2);
    };

    // Stack the slots vertically in the atlas. Rebuilt only when an element's
    // size / radius / the zoom level changes.
    const layout = () => {
        let atlasW = 1;
        let y = 0;
        const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
        // First pass at full budget; if the stacked atlas would exceed the
        // GPU's texture limit, shrink everything uniformly and redo.
        const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        let fit = 1;
        for (let pass = 0; pass < 2; pass++) {
            atlasW = 1;
            y = 0;
            for (const item of items) {
                if (!item.w) { item.slot = null; continue; }
                const cw = item.w + 2 * PADDING;
                const ch = item.h + 2 * PADDING;
                const scale = fit * Math.max(SCALE_MIN, Math.min(1,
                    Math.sqrt(MAX_SLOT_AREA / (cw * ch * dpr * dpr))));
                const sw = Math.max(1, Math.round(cw * dpr * scale));
                const sh = Math.max(1, Math.round(ch * dpr * scale));
                item.slot = { x: 0, y, w: sw, h: sh, scale };
                item.cw = cw;
                item.ch = ch;
                y += sh;
                atlasW = Math.max(atlasW, sw);
            }
            if (backdrop) {
                const bw = Math.max(1, Math.round(window.innerWidth * dpr * fit));
                const bh = Math.max(1, Math.round(window.innerHeight * dpr * fit));
                backdropSlot = { x: 0, y, w: bw, h: bh };
                y += bh;
                atlasW = Math.max(atlasW, bw);
            }
            if (y <= maxTex && atlasW <= maxTex) break;
            fit = 0.95 * Math.min(maxTex / y, maxTex / atlasW);
        }
        if (backdrop) {
            backdrop.width = backdropSlot.w;
            backdrop.height = backdropSlot.h;
            backdropDirty = true;
        }
        for (const item of items) {
            if (!item.slot) continue;
            const { scale } = item.slot;
            item.canvas.width = item.slot.w;
            item.canvas.height = item.slot.h;
            item.canvas.style.width = `${item.cw}px`;
            item.canvas.style.height = `${item.ch}px`;
            if (item.text) {
                // Scale the rim with the glyph size so the look matches the
                // desktop calibration at every font size.
                item.k = (parseFloat(getComputedStyle(item.el).fontSize) || TEXT_REF_SIZE)
                    / TEXT_REF_SIZE;
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, item.mapTex);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE,
                    makeTextMap(item.el, item.w, item.h, dpr * scale,
                        Math.max(3, TEXT_BEZEL * item.k)));
            }
            item.lastPos = ''; // force a redraw
        }
        atlas.width = atlasW;
        atlas.height = Math.max(1, y);
        gl.viewport(0, 0, atlas.width, atlas.height);
        gl.uniform2f(U.uAtlas, atlas.width, atlas.height);
    };

    // The glyph masks depend on the font; rebuild once webfonts land.
    document.fonts?.ready?.then(() => {
        for (const item of items) if (item.text) item.key = '';
    });

    let lastVideoTime = -1;

    // New-frame signal: requestVideoFrameCallback when the browser has it
    // (fires only when a frame was actually presented — currentTime can keep
    // advancing on Firefox Android while the decoder silently stalls, which
    // froze the glass on whatever frame was uploaded last).
    const hasRVFC = typeof video.requestVideoFrameCallback === 'function';
    let frameReady = false;
    let rvfcId = 0;
    const armRVFC = () => {
        if (!hasRVFC) return;
        // re-registered after load(): a media reset can cancel pending
        // callbacks, which would silently stop all uploads for good
        if (rvfcId) video.cancelVideoFrameCallback?.(rvfcId);
        const onFrame = () => {
            frameReady = true;
            rvfcId = video.requestVideoFrameCallback(onFrame);
        };
        rvfcId = video.requestVideoFrameCallback(onFrame);
    };
    armRVFC();
    // Stall watchdog, PIXEL-based: on Firefox Android the decoder can stall
    // while rVFC keeps firing and currentTime keeps advancing — every
    // browser-side "new frame" signal lies, so the only reliable check is
    // whether the pixels actually uploaded to the texture still change.
    // Probed once per second via a tiny FBO readback of the video texture;
    // after 3 s static, escalate remedies (device-tested order 2026-07-12):
    // play() → seek +0.01 s → load()+play (the one that truly resets the
    // stalled decoder; capped, as it refetches the file if uncached).
    const probeFB = gl.createFramebuffer();
    const probePx = new Uint8Array(4 * 4 * 4);
    let lastProbeAt = 0;
    let lastProbeHash = -1;
    let lastPixelChangeAt = performance.now();
    let remedyStep = 0;
    let reloadsLeft = 3;
    const remedies = [
        () => video.play().catch(() => {}),
        () => {
            video.currentTime += 0.01;
            video.play().catch(() => {});
        },
        () => {
            if (reloadsLeft-- <= 0) return;
            video.load();
            armRVFC();
            video.play().catch(() => {});
        },
    ];

    const draw = () => {
        if (dead) return;
        if (!container.isConnected) {
            gl.getExtension('WEBGL_lose_context')?.loseContext();
            dead = true;
            return;
        }
        requestAnimationFrame(draw);

        let needLayout = false;
        const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
        for (const item of items) {
            item.w = item.el.offsetWidth;
            item.h = item.el.offsetHeight;
            item.radius = readRadius(item.el, item.w, item.h);
            const key = `${item.w}|${item.h}|${item.radius}|${dpr}`;
            if (key !== item.key) {
                item.key = key;
                needLayout = true;
            }
        }
        if (backdrop) {
            const vp = `${window.innerWidth}|${window.innerHeight}`;
            if (vp !== lastViewport) {
                lastViewport = vp;
                needLayout = true;
            }
        }
        if (needLayout) layout();

        // The probe runs BEFORE the readyState guard, so a video stuck
        // loading (or reset by load()) still escalates remedies.
        const now = performance.now();
        if (now - lastProbeAt > 1000) {
            lastProbeAt = now;
            let hash = 0;
            if (video.readyState >= 2 && video.videoWidth) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, probeFB);
                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
                    gl.TEXTURE_2D, videoTex, 0);
                if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
                    gl.readPixels(video.videoWidth >> 1, video.videoHeight >> 1,
                        4, 4, gl.RGBA, gl.UNSIGNED_BYTE, probePx);
                    for (let i = 0; i < probePx.length; i++) hash = (hash * 31 + probePx[i]) | 0;
                }
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            }
            if (hash !== lastProbeHash) {
                lastProbeHash = hash;
                lastPixelChangeAt = now;
                remedyStep = 0;
                reloadsLeft = 3; // content flows again: re-arm everything
            } else if (now - lastPixelChangeAt > 100) {
                lastPixelChangeAt = now; // next escalation in 100 ms
                remedies[Math.min(remedyStep++, remedies.length - 1)]();
            }
        }

        if (video.readyState < 2 || !video.videoWidth) return;
        const vr = video.getBoundingClientRect(); // visibility:hidden keeps layout
        const videoChanged = hasRVFC ? frameReady : video.currentTime !== lastVideoTime;
        if (videoChanged) {
            frameReady = false;
            lastVideoTime = video.currentTime;
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, videoTex);
            // Full texImage2D every frame, never texSubImage2D: the
            // sub-update path silently no-ops from a <video> on Firefox
            // Android (frozen glass) and the realloc costs nothing.
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
        }

        // object-fit: cover mapping of the video inside its on-screen box
        const cover = Math.max(vr.width / video.videoWidth, vr.height / video.videoHeight);
        const dw = video.videoWidth * cover;
        const dh = video.videoHeight * cover;
        const dx = vr.left + (vr.width - dw) / 2;
        const dy = vr.top + (vr.height - dh) / 2;

        const blits = [];
        for (const item of items) {
            if (!item.slot) continue;
            const r = item.canvas.getBoundingClientRect();
            if (r.bottom < -40 || r.top > window.innerHeight + 40
                || r.right < -40 || r.left > window.innerWidth + 40) continue;
            // Frost only elements that carry .liquid-glass-blur themselves:
            // --glass-blur is an inherited custom property, so reading it
            // unconditionally would frost every glass descendant too.
            const blur = item.el.classList.contains('liquid-glass-blur')
                ? (parseFloat(getComputedStyle(item.el).getPropertyValue('--glass-blur')) || 0)
                : 0;
            const pos = `${r.left}|${r.top}|${r.width}`;
            if (!videoChanged && pos === item.lastPos && blur === item.blur) continue;
            item.lastPos = pos;
            item.blur = blur;

            gl.uniform4f(U.uSlot, item.slot.x, item.slot.y, item.slot.w, item.slot.h);
            gl.uniform1i(U.uMode, item.text ? 1 : 0);
            gl.uniform2f(U.uQuadSize, item.cw, item.ch);
            gl.uniform2f(U.uRectSize, item.w, item.h);
            gl.uniform1f(U.uRadius, item.radius);
            gl.uniform1f(U.uBezel, BEZEL);
            // SVG feDisplacementMap moved by scale * (channel - 0.5), so the
            // effective px displacement for our [-1,1] normals is strength/2.
            gl.uniform1f(U.uStrength,
                (item.text ? TEXT_STRENGTH * (item.k || 1) : STRENGTH) / 2);
            gl.uniform1f(U.uBlur, blur);
            gl.uniform2f(U.uUV0, (r.left - dx) / dw, (r.top - dy) / dh);
            gl.uniform2f(U.uUVScale, r.width / dw, r.height / dh);
            gl.uniform2f(U.uPxToUV, 1 / dw, 1 / dh);
            if (item.text) {
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, item.mapTex);
            }
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            blits.push(item);
        }
        // Blit in the same task as the draws: the drawing buffer is only
        // cleared at compositing time, so preserveDrawingBuffer isn't needed.
        for (const item of blits) {
            item.ctx.globalCompositeOperation = 'copy';
            item.ctx.drawImage(atlas,
                item.slot.x, item.slot.y, item.slot.w, item.slot.h,
                0, 0, item.canvas.width, item.canvas.height);
        }

        // GL-rendered fond (Firefox Android): passthrough draw of the video
        // texture into the fullscreen slot, blitted to the visible canvas.
        // Mode 2 skips both shape branches in the shader: no displacement,
        // no mask - just the cover-mapped video.
        if (backdrop && (videoChanged || backdropDirty)) {
            backdropDirty = false;
            gl.uniform4f(U.uSlot, backdropSlot.x, backdropSlot.y, backdropSlot.w, backdropSlot.h);
            gl.uniform1i(U.uMode, 2);
            gl.uniform1f(U.uStrength, 0);
            gl.uniform1f(U.uBlur, 0);
            gl.uniform2f(U.uUV0, -dx / dw, -dy / dh);
            gl.uniform2f(U.uUVScale, window.innerWidth / dw, window.innerHeight / dh);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            backdropCtx.globalCompositeOperation = 'copy';
            backdropCtx.drawImage(atlas,
                backdropSlot.x, backdropSlot.y, backdropSlot.w, backdropSlot.h,
                0, 0, backdrop.width, backdrop.height);
            if (!backdropShown) {
                backdropShown = true;
                backdrop.style.visibility = 'visible';
                // The <video> is NOT hidden - the backdrop just paints over
                // it. Gecko on Android suspends decoding of invisible videos
                // (visibility:hidden froze the whole page on one frame).
            }
        }
    };
    requestAnimationFrame(draw);
}
