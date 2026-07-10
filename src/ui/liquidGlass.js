/**
 * "liquid glass" surfaces: the backdrop showing through the
 * element is refracted along its rounded edges, like light bending through
 * the bevel of a thick glass slab.
 *
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

const BEZEL = 30;        // px: width of the refracting rim (rest stays flat)
const STRENGTH = 150;     // feDisplacementMap scale at the rim edge
const ABERRATION = 0.1;  // relative displacement offset between color channels
const BLUR = 0.0;        // px: just enough to hide displacement-map banding
const SATURATION = 1.0;
const PADDING = 80;      // px: how far beyond the element the canvas extends,
                         // so edge refraction can pull light from outside it
                         // (must exceed STRENGTH * (1 + ABERRATION) / 2)


const MAX_FILTER_AREA = 260000; // device px per element
const SCALE_MIN = 0.35;         // never go softer than this
const DPR_CAP = 1.5;

// Glass TEXT (class "liquid-glass-text"): the glyphs themselves become the
// glass - the refracting rim follows the letter outlines. Strokes are thin,
// so they use their own bezel width and a gentler displacement.
const TEXT_BEZEL = 30;
const TEXT_STRENGTH = 200;

let uid = 0;

/** Signed distance to a w x h rounded rect centered on the origin. */
function roundedRectSDF(x, y, w, h, r) {
    const qx = Math.abs(x) - (w / 2 - r);
    const qy = Math.abs(y) - (h / 2 - r);
    return Math.min(Math.max(qx, qy), 0)
        + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

/**
 * Displacement map for feDisplacementMap, covering element + padding:
 * neutral gray outside and in the body, and on the rim the outward normal
 * packed into R/G, strongest at the very edge.
 */
function makeDisplacementMap(width, height, radius, dpr) {
    const w = Math.max(1, Math.round((width + 2 * PADDING) * dpr));
    const h = Math.max(1, Math.round((height + 2 * PADDING) * dpr));
    const rw = width * dpr;   // the refracting rect, centered on the canvas
    const rh = height * dpr;
    const r = radius * dpr;
    const bezel = BEZEL * dpr;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const px = x + 0.5 - w / 2;
            const py = y + 0.5 - h / 2;
            const d = roundedRectSDF(px, py, rw, rh, r);
            let dx = 0;
            let dy = 0;
            if (d < 0 && d > -bezel) {
                const t = -d / bezel; // 0 at the edge, 1 at the inner rim
                const m = (1 - t) ** 2.2;
                const e = 1;
                const gx = roundedRectSDF(px + e, py, rw, rh, r) - roundedRectSDF(px - e, py, rw, rh, r);
                const gy = roundedRectSDF(px, py + e, rw, rh, r) - roundedRectSDF(px, py - e, rw, rh, r);
                const len = Math.hypot(gx, gy) || 1;
                dx = (gx / len) * m;
                dy = (gy / len) * m;
            }
            const i = (y * w + x) * 4;
            img.data[i] = Math.round(127.5 + 127.5 * dx);
            img.data[i + 1] = Math.round(127.5 + 127.5 * dy);
            img.data[i + 2] = 0;
            img.data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL();
}

function keepChannel(channel) {
    const rows = ['0 0 0 0 0', '0 0 0 0 0', '0 0 0 0 0'];
    rows[channel] = ['1 0 0 0 0', '0 1 0 0 0', '0 0 1 0 0'][channel];
    return `${rows.join('  ')}  0 0 0 1 0`;
}

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
 * displacement like the rect map; B packs the crisp glyph mask, which the
 * filter routes into alpha so the refracted video is clipped to the letters.
 */
function makeTextMap(el, width, height, dpr) {
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
    const r = Math.max(1, Math.round(TEXT_BEZEL * dpr / 3));
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
    return canvas.toDataURL();
}

// `s` is the internal layout scale of the canvas: displacement distances and
// blur live in filter user space, so they shrink with it. `strength`
// overrides the displacement, and `clip` cuts the result to the glyph mask
// packed in the map's B channel (glass text). `blur` frosts the glass
// (per-element via the --glass-blur CSS variable).
function filterContent(mapUrl, w, h, s, { strength = STRENGTH, clip = false, blur = BLUR } = {}) {
    const disp = (scale, result) =>
        `<feDisplacementMap in="SourceGraphic" in2="map" scale="${scale}" `
        + `xChannelSelector="R" yChannelSelector="G" result="${result}"/>`;
    const add = (a, b, result) =>
        `<feComposite in="${a}" in2="${b}" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="${result}"/>`;
    return `
        <feImage href="${mapUrl}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map"/>
        ${disp(strength * s * (1 + ABERRATION), 'dispR')}
        <feColorMatrix in="dispR" type="matrix" values="${keepChannel(0)}" result="chR"/>
        ${disp(strength * s, 'dispG')}
        <feColorMatrix in="dispG" type="matrix" values="${keepChannel(1)}" result="chG"/>
        ${disp(strength * s * (1 - ABERRATION), 'dispB')}
        <feColorMatrix in="dispB" type="matrix" values="${keepChannel(2)}" result="chB"/>
        ${add('chR', 'chG', 'chRG')}
        ${add('chRG', 'chB', 'chRGB')}
        <feGaussianBlur in="chRGB" stdDeviation="${blur * s}" result="frosted"/>
        <feColorMatrix in="frosted" type="saturate" values="${SATURATION}" result="graded"/>
        ${clip ? `
        <feComponentTransfer in="graded" result="lifted">
            <feFuncR type="linear" slope="1.25" intercept="0.02"/>
            <feFuncG type="linear" slope="1.25" intercept="0.02"/>
            <feFuncB type="linear" slope="1.25" intercept="0.02"/>
        </feComponentTransfer>
        <feColorMatrix in="map" type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0" result="glyphMask"/>
        <feComposite in="lifted" in2="glyphMask" operator="in"/>` : ''}`;
}

/**
 * Turn each element into a refracting glass surface over `video`.
 * The hidden <svg> holding the filters is appended to `container`, and the
 * redraw loop stops when `container` leaves the DOM - so everything dies
 * with the landing screen.
 */
export function applyLiquidGlass(elements, container = document.body,
    video = document.getElementById('fontVideo')) {
    if (!video) return;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    const defs = document.createElementNS(SVG_NS, 'defs');
    svg.appendChild(defs);
    container.appendChild(svg);

    const items = [];
    for (const el of elements) {
        const id = `liquid-glass-${uid++}`;
        const filter = document.createElementNS(SVG_NS, 'filter');
        filter.setAttribute('id', id);
        filter.setAttribute('x', '0');
        filter.setAttribute('y', '0');
        filter.setAttribute('width', '100%');
        filter.setAttribute('height', '100%');
        filter.setAttribute('color-interpolation-filters', 'sRGB');
        defs.appendChild(filter);

        // Clipped to the element's rounded shape; the canvas overflows it by
        // PADDING so the bevel can refract light from beyond the edges.
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

        items.push({ el, canvas, ctx: canvas.getContext('2d'), filter, id, key: '', text });
    }

    // The element's rounded-rect radius, resolved to px and clamped the way
    // the browser clamps it (pill shapes use radii up to half the box).
    const readRadius = (el, w, h) => {
        const raw = getComputedStyle(el).borderTopLeftRadius;
        let r = parseFloat(raw) || 0;
        if (raw.endsWith('%')) r = Math.min(w, h) * r / 100;
        return Math.min(r, w / 2, h / 2);
    };

    // Reading from a <video> element can force a GPU→CPU readback of the
    // whole frame on some browser/driver combos - doing it once per glass
    // canvas per rAF was the real per-frame cost (independent of any
    // resolution). So the video is copied ONCE per *video frame* into this
    // shared canvas, and the glass canvases blit from it (cheap
    // canvas→canvas copies). A glass canvas that hasn't moved while the
    // video frame is unchanged isn't redrawn at all, so its filter doesn't
    // re-run either.
    const shared = document.createElement('canvas');
    const sharedCtx = shared.getContext('2d', { alpha: false });
    let lastVideoTime = -1;

    // Every frame: rebuild the displacement map if the element's size,
    // border-radius or the zoom level changed (so live style edits stay in
    // sync), then redraw the moved/stale canvases with the video region
    // behind them (object-fit: cover mapping). Canvases outside the
    // viewport are skipped - their filter never re-runs since their
    // content is frozen.
    const draw = () => {
        if (!container.isConnected) return;
        for (const item of items) {
            const w = item.el.offsetWidth;
            const h = item.el.offsetHeight;
            if (!w || !h) continue;
            const radius = readRadius(item.el, w, h);
            // Frost only elements that carry .liquid-glass-blur themselves:
            // --glass-blur is an inherited custom property, so reading it
            // unconditionally would frost every glass descendant too.
            const blur = item.el.classList.contains('liquid-glass-blur')
                ? (parseFloat(getComputedStyle(item.el).getPropertyValue('--glass-blur')) || BLUR)
                : BLUR;
            const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
            const key = `${w}|${h}|${radius}|${dpr}`;
            if (key !== item.key) {
                item.key = key;
                item.blur = blur;
                const cw = w + 2 * PADDING;
                const ch = h + 2 * PADDING;
                const scale = Math.max(SCALE_MIN, Math.min(1,
                    Math.sqrt(MAX_FILTER_AREA / (cw * ch * dpr * dpr))));
                const lw = cw * scale;
                const lh = ch * scale;
                item.canvas.style.width = `${lw}px`;
                item.canvas.style.height = `${lh}px`;
                item.canvas.style.transformOrigin = '0 0';
                item.canvas.style.transform = `scale(${1 / scale})`;
                item.canvas.width = Math.round(lw * dpr);
                item.canvas.height = Math.round(lh * dpr);
                const mapUrl = item.text
                    ? makeTextMap(item.el, w, h, dpr * scale)
                    : makeDisplacementMap(w, h, radius, dpr * scale);
                item.filter.innerHTML = filterContent(mapUrl, lw, lh, scale,
                    item.text ? { strength: TEXT_STRENGTH, clip: true, blur } : { blur });
                item.canvas.style.filter = `url(#${item.id})`;
                item.scale = scale;
            } else if (blur !== item.blur) {
                // The hover transition animates --glass-blur every frame:
                // retune the existing feGaussianBlur in place instead of
                // regenerating the whole filter + displacement map.
                item.blur = blur;
                item.filter.querySelector('feGaussianBlur')
                    ?.setAttribute('stdDeviation', blur * item.scale);
            }
        }
        if (video.readyState >= 2 && video.videoWidth) {
            const vr = video.getBoundingClientRect();
            const videoChanged = video.currentTime !== lastVideoTime;
            if (videoChanged) {
                lastVideoTime = video.currentTime;
                const sw = Math.round(vr.width);
                const sh = Math.round(vr.height);
                if (shared.width !== sw || shared.height !== sh) {
                    shared.width = sw;
                    shared.height = sh;
                }
                // one video readback per video frame: cover-map it into the
                // shared canvas at the video's on-screen size
                const cover = Math.max(sw / video.videoWidth, sh / video.videoHeight);
                const dw = video.videoWidth * cover;
                const dh = video.videoHeight * cover;
                sharedCtx.drawImage(video, (sw - dw) / 2, (sh - dh) / 2, dw, dh);
            }
            for (const item of items) {
                const { canvas, ctx } = item;
                if (!canvas.width) continue;
                const r = canvas.getBoundingClientRect();
                if (r.bottom < -40 || r.top > window.innerHeight + 40
                    || r.right < -40 || r.left > window.innerWidth + 40) continue;
                const pos = `${r.left}|${r.top}|${r.width}`;
                if (!videoChanged && pos === item.lastPos) continue;
                item.lastPos = pos;
                ctx.drawImage(
                    shared,
                    r.left - vr.left, r.top - vr.top, r.width, r.height,
                    0, 0, canvas.width, canvas.height,
                );
            }
        }
        requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
}
