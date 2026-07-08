import { SIMULATION_TYPE } from '../config/constants.js';
import {
    BH_MSUN6_PER_FORCE,
    KLY_PER_UNIT,
    LY_PER_UNIT,
    MLY_PER_UNIT,
    myrPerSecToTimeStep,
    referenceGravity,
    referenceTimeStep,
    speedFactorToTimeStep,
    timeStepToMyrPerSec,
    timeStepToSpeedFactor
} from '../config/units.js';
import { isAmbienceMuted, setAmbienceMuted } from '../audio/ambience.js';
import './gui.css';

/**
 * Custom control panel (no dat.gui): a tabbed panel (Settings / Simulation /
 * Graphics) with the essential controls per tab and a collapsible "Advanced"
 * section holding the rest. Action buttons (pause/restart/reset) stay visible
 * above the tabs. Rebuilt from scratch on every simulation switch or restart,
 * since the available controls depend on the simulation type.
 *
 * @param app the GalaxyApp instance (state + restart/switch/sync callbacks)
 * @returns {{destroy}} destroy() removes the panel from the DOM
 */

// UI state preserved across panel rebuilds (simulation switch / restart)
const uiState = {
    tab: 'settings',
    collapsed: false,
    advanced: { settings: false, simulation: false, graphics: false }
};

const ICONS = {
    pause: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2h3.2v12H4zM8.8 2H12v12H8.8z"/></svg>',
    play: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 2l9 6-9 6z"/></svg>',
    restart: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 2.5a5.5 5.5 0 1 1-5.43 4.6h1.53A4 4 0 1 0 8 4V6.8L3.8 3.9 8 1z"/></svg>',
    reset: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 8a5 5 0 1 0 1.5-3.6M4.5 1.8v2.8h2.8"/></svg>',
    save: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M2.5 2.5h8.5l2.5 2.5v8.5h-11z"/><path d="M5 2.5v3.5h5V2.5M4.5 13.5V9h7v4.5"/></svg>',
    check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3.2L13 4.5"/></svg>',
    tune: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 5h7M13 5h3M2 13h3M9 13h7"/><circle cx="11" cy="5" r="2"/><circle cx="7" cy="13" r="2"/></svg>',
    close: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
    volumeOn: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 6h2.5L8 3v10L4.5 10H2z"/><path d="M10 5.5a3.2 3.2 0 0 1 0 5M11.8 3.8a5.8 5.8 0 0 1 0 8.4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    volumeOff: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 6h2.5L8 3v10L4.5 10H2z"/><path d="M10.5 6.5l3.5 3.5M14 6.5l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    chevron: '<svg class="sp-chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 6l4 4 4-4"/></svg>'
};

function el(tag, className, parent) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (parent) parent.appendChild(node);
    return node;
}

function stepDecimals(step) {
    const s = String(step);
    return s.includes('.') ? s.split('.')[1].length : 0;
}

/**
 * Slider row: label + editable numeric value on top, range input below.
 */
function addSlider(parent, { label, min, max, step, value, onChange, restart = false, title = '' }) {
    const decimals = stepDecimals(step);
    const row = el('div', 'sp-row', parent);
    const top = el('div', 'sp-row-top', row);
    const name = el('span', 'sp-label', top);
    name.textContent = label;
    if (title) row.title = title;
    if (restart) {
        name.textContent += ' *';
        row.title = (title ? title + '. ' : '') + 'Applied on the next restart';
    }
    const num = el('input', 'sp-num', top);
    num.type = 'text';
    const range = el('input', 'sp-range', row);
    range.type = 'range';
    range.min = min;
    range.max = max;
    range.step = step;
    range.value = value;

    const paint = () => {
        const pct = ((Number(range.value) - min) / (max - min)) * 100;
        range.style.setProperty('--sp-fill', pct + '%');
    };
    const show = (v) => { num.value = Number(v.toFixed(decimals)).toString(); };
    show(value);
    paint();

    range.addEventListener('input', () => {
        const v = Number(range.value);
        show(v);
        paint();
        onChange(v);
    });
    num.addEventListener('change', () => {
        let v = Number(num.value.replace(',', '.'));
        if (!Number.isFinite(v)) {
            show(Number(range.value));
            return;
        }
        v = Math.min(max, Math.max(min, v));
        range.value = v;
        show(v);
        paint();
        onChange(v);
    });
    num.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') num.blur();
    });
}

/**
 * Dual-handle slider row: one track with two thumbs (low / high bound of a
 * range) plus two editable numeric values. Guarantees low <= high.
 */
function addDualSlider(parent, { label, min, max, step, valueLow, valueHigh, onChange, title = '' }) {
    const decimals = stepDecimals(step);
    const row = el('div', 'sp-row', parent);
    if (title) row.title = title;
    const top = el('div', 'sp-row-top', row);
    el('span', 'sp-label', top).textContent = label;
    const nums = el('div', 'sp-dual-nums', top);
    const numLo = el('input', 'sp-num sp-num-dual', nums);
    numLo.type = 'text';
    el('span', 'sp-dual-sep', nums).textContent = '–';
    const numHi = el('input', 'sp-num sp-num-dual', nums);
    numHi.type = 'text';

    const track = el('div', 'sp-dual', row);
    const lo = el('input', 'sp-dual-range', track);
    const hi = el('input', 'sp-dual-range', track);
    for (const range of [lo, hi]) {
        range.type = 'range';
        range.min = min;
        range.max = max;
        range.step = step;
    }
    lo.value = valueLow;
    hi.value = valueHigh;

    const show = () => {
        numLo.value = Number(Number(lo.value).toFixed(decimals)).toString();
        numHi.value = Number(Number(hi.value).toFixed(decimals)).toString();
    };
    const paint = () => {
        track.style.setProperty('--sp-lo', ((Number(lo.value) - min) / (max - min)) * 100 + '%');
        track.style.setProperty('--sp-hi', ((Number(hi.value) - min) / (max - min)) * 100 + '%');
    };
    const commit = () => {
        show();
        paint();
        onChange(Number(lo.value), Number(hi.value));
    };

    lo.addEventListener('input', () => {
        if (Number(lo.value) > Number(hi.value)) lo.value = hi.value;
        commit();
    });
    hi.addEventListener('input', () => {
        if (Number(hi.value) < Number(lo.value)) hi.value = lo.value;
        commit();
    });
    const bindNum = (num, range, clampOther) => {
        num.addEventListener('change', () => {
            let v = Number(num.value.replace(',', '.'));
            if (!Number.isFinite(v)) {
                show();
                return;
            }
            range.value = Math.min(max, Math.max(min, v));
            clampOther();
            commit();
        });
        num.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') num.blur();
        });
    };
    bindNum(numLo, lo, () => { if (Number(lo.value) > Number(hi.value)) hi.value = lo.value; });
    bindNum(numHi, hi, () => { if (Number(hi.value) < Number(lo.value)) lo.value = hi.value; });
    show();
    paint();
}

/**
 * Toggle row: label + switch.
 */
function addToggle(parent, { label, value, onChange }) {
    const row = el('label', 'sp-row sp-toggle-row', parent);
    el('span', 'sp-label', row).textContent = label;
    const input = el('input', 'sp-toggle-input', row);
    input.type = 'checkbox';
    input.checked = value;
    el('span', 'sp-switch', row);
    input.addEventListener('change', () => onChange(input.checked));
}

/**
 * Color row: label + native color picker swatch. onChange fires live while
 * the user drags inside the browser's picker.
 */
function addColor(parent, { label, value, onChange }) {
    const row = el('label', 'sp-row sp-color-row', parent);
    el('span', 'sp-label', row).textContent = label;
    const input = el('input', 'sp-color-input', row);
    input.type = 'color';
    input.value = value;
    input.addEventListener('input', () => onChange(input.value));
}

/**
 * Segmented picker (one active option among a few).
 */
function addSegmented(parent, { options, value, onChange }) {
    const wrap = el('div', 'sp-seg', parent);
    options.forEach((opt) => {
        const btn = el('button', 'sp-seg-btn' + (opt.value === value ? ' active' : ''), wrap);
        btn.type = 'button';
        btn.textContent = opt.label;
        btn.addEventListener('click', () => {
            if (opt.value !== value) onChange(opt.value);
        });
    });
}

/**
 * Collapsible "Advanced" section; open/closed state persists per tab.
 */
function addAdvanced(parent, tabKey) {
    const box = el('div', 'sp-advanced', parent);
    const head = el('button', 'sp-advanced-head', box);
    head.type = 'button';
    head.innerHTML = '<span>Advanced</span>' + ICONS.chevron;
    const body = el('div', 'sp-advanced-body', box);
    const apply = () => box.classList.toggle('open', uiState.advanced[tabKey]);
    head.addEventListener('click', () => {
        uiState.advanced[tabKey] = !uiState.advanced[tabKey];
        apply();
    });
    apply();
    return body;
}

function addNote(parent, text) {
    el('div', 'sp-note', parent).textContent = text;
}

export function createGUI(app) {
    const controller = app.effectController;
    const type = Number(controller.typeOfSimulation);
    const isGalaxyMode = type === SIMULATION_TYPE.GALAXY || type === SIMULATION_TYPE.GALAXY_COLLISION;
    const sync = () => app.syncUniforms();

    const root = el('div', 'sp-root', document.body);

    /* ---- Floating button shown while the panel is collapsed ---- */
    const fab = el('button', 'sp-fab', root);
    fab.type = 'button';
    fab.title = 'Open controls';
    fab.innerHTML = ICONS.tune;

    /* ---- Floating ambience mute button, next to the panel ---- */
    const muteFab = el('button', 'sp-fab sp-mute-fab', root);
    muteFab.type = 'button';
    const paintMute = () => {
        const muted = isAmbienceMuted();
        muteFab.innerHTML = muted ? ICONS.volumeOff : ICONS.volumeOn;
        muteFab.title = muted ? 'Unmute ambience' : 'Mute ambience';
        muteFab.classList.toggle('sp-muted', muted);
    };
    muteFab.addEventListener('click', () => {
        setAmbienceMuted(!isAmbienceMuted());
        paintMute();
    });
    paintMute();

    /* ---- Panel ---- */
    const panel = el('div', 'sp-panel', root);

    const applyCollapsed = () => {
        panel.classList.toggle('sp-hidden', uiState.collapsed);
        fab.classList.toggle('sp-visible', uiState.collapsed);
        muteFab.classList.toggle('sp-shifted', uiState.collapsed);
    };
    fab.addEventListener('click', () => {
        uiState.collapsed = false;
        applyCollapsed();
    });

    const header = el('div', 'sp-header', panel);
    el('div', 'sp-title', header).textContent = 'Galaxy Simulation';
    const closeBtn = el('button', 'sp-icon-btn', header);
    closeBtn.type = 'button';
    closeBtn.title = 'Hide controls';
    closeBtn.innerHTML = ICONS.close;
    closeBtn.addEventListener('click', () => {
        uiState.collapsed = true;
        applyCollapsed();
    });
    applyCollapsed();

    /* ---- Action buttons (always visible) ---- */
    const actions = el('div', 'sp-actions', panel);
    const pauseBtn = el('button', 'sp-btn', actions);
    pauseBtn.type = 'button';
    const paintPause = () => {
        pauseBtn.innerHTML = app.paused
            ? ICONS.play + '<span>Resume</span>'
            : ICONS.pause + '<span>Pause</span>';
        pauseBtn.classList.toggle('sp-btn-accent', app.paused);
    };
    pauseBtn.addEventListener('click', () => {
        app.paused = !app.paused;
        paintPause();
    });
    paintPause();

    const restartBtn = el('button', 'sp-btn', actions);
    restartBtn.type = 'button';
    restartBtn.innerHTML = ICONS.restart + '<span>Restart</span>';
    restartBtn.addEventListener('click', () => app.restartSimulation());

    const saveBtn = el('button', 'sp-btn', actions);
    saveBtn.type = 'button';
    saveBtn.title = 'Save the current parameters in the browser; they are restored on the next visit';
    const paintSave = () => { saveBtn.innerHTML = ICONS.save + '<span>Save</span>'; };
    paintSave();
    let saveFeedbackTimer = null;
    saveBtn.addEventListener('click', () => {
        const ok = app.saveParameters();
        saveBtn.innerHTML = ok
            ? ICONS.check + '<span>Saved</span>'
            : ICONS.close + '<span>Failed</span>';
        saveBtn.classList.toggle('sp-btn-accent', ok);
        clearTimeout(saveFeedbackTimer);
        saveFeedbackTimer = setTimeout(() => {
            saveBtn.classList.remove('sp-btn-accent');
            paintSave();
        }, 1200);
    });

    const resetBtn = el('button', 'sp-btn', actions);
    resetBtn.type = 'button';
    resetBtn.title = 'Reset all parameters to the preset and forget the saved ones';
    resetBtn.innerHTML = ICONS.reset + '<span>Reset</span>';
    resetBtn.addEventListener('click', () => app.resetParameters());

    /* ---- Tabs ---- */
    const tabs = el('nav', 'sp-tabs', panel);
    const content = el('div', 'sp-content', panel);
    const tabButtons = {};
    const tabPanes = {};
    [['settings', 'Settings'], ['simulation', 'Simulation'], ['graphics', 'Graphics']].forEach(([key, label]) => {
        const btn = el('button', 'sp-tab', tabs);
        btn.type = 'button';
        btn.textContent = label;
        btn.addEventListener('click', () => {
            uiState.tab = key;
            applyTab();
        });
        tabButtons[key] = btn;
        tabPanes[key] = el('div', 'sp-pane', content);
    });
    const applyTab = () => {
        for (const key of Object.keys(tabButtons)) {
            tabButtons[key].classList.toggle('active', uiState.tab === key);
            tabPanes[key].classList.toggle('active', uiState.tab === key);
        }
    };
    applyTab();

    /* ================== Settings tab ================== */
    const settings = tabPanes['settings'];
    el('div', 'sp-group-title', settings).textContent = 'Simulation type';
    addSegmented(settings, {
        options: [
            { label: 'Galaxy', value: SIMULATION_TYPE.GALAXY },
            { label: 'Universe', value: SIMULATION_TYPE.UNIVERSE },
            { label: 'Collision', value: SIMULATION_TYPE.GALAXY_COLLISION }
        ],
        value: type,
        onChange: (v) => {
            controller.typeOfSimulation = v;
            app.switchSimulation();
        }
    });

    const settingsAdvanced = addAdvanced(settings, 'settings');
    addToggle(settingsAdvanced, {
        label: 'Auto-rotation',
        value: app.controls.autoRotate,
        onChange: (v) => {
            controller.autoRotation = v;
            app.autoRotation = v;
            app.controls.autoRotate = v;
        }
    });
    addToggle(settingsAdvanced, {
        label: 'Show FPS panel',
        value: app.showStats,
        onChange: (v) => {
            app.showStats = v;
            app.stats.dom.style.display = v ? '' : 'none';
        }
    });

    /* ================== Simulation tab ================== */
    // Sliders show real astronomical values (see config/units.js for the
    // calibration); the conversions here are the only place they exist,
    // the controller keeps the raw internal values.
    const simulation = tabPanes['simulation'];
    const gRef = referenceGravity(type, app.quality);
    addSlider(simulation, {
        label: 'Gravity (× G)', min: 0, max: Math.round(1000 / gRef), step: 0.01,
        value: controller.gravity / gRef,
        title: 'Strength of gravity as a multiple of Newton\'s constant (1 = real gravity)',
        onChange: (v) => { controller.gravity = v * gRef; sync(); }
    });
    if (isGalaxyMode) {
        addSlider(simulation, {
            label: 'Black hole mass (10⁶ M☉)', min: 0, max: 5000, step: 1,
            value: controller.blackHoleForce * BH_MSUN6_PER_FORCE,
            title: 'Millions of solar masses. Sagittarius A*, the Milky Way\'s black hole, is 4.3',
            onChange: (v) => { controller.blackHoleForce = v / BH_MSUN6_PER_FORCE; sync(); }
        });
        addSlider(simulation, {
            label: 'Stars', min: 2, max: 1000000, step: 1, value: controller.numberOfStars, restart: true,
            title: 'Each particle stands for a cluster of ~500,000 solar masses of stars',
            onChange: (v) => { controller.numberOfStars = v; }
        });
    } else {
        addSlider(simulation, {
            label: 'Galaxies', min: 2, max: 10000000, step: 1, value: controller.numberOfStars, restart: true,
            onChange: (v) => { controller.numberOfStars = v; }
        });
    }

    const simulationAdvanced = addAdvanced(simulation, 'simulation');
    addSlider(simulationAdvanced, {
        label: 'Interaction rate (%)', min: 0, max: 100, step: 0.1,
        value: controller.interactionRate * 100,
        title: 'Fraction of the other particles each particle actually attracts (accuracy vs speed)',
        onChange: (v) => { controller.interactionRate = v / 100; sync(); }
    });
    if (isGalaxyMode) {
        addSlider(simulationAdvanced, {
            label: 'Simulation speed (Myr/s)', min: 0, max: 190, step: 0.5,
            value: timeStepToMyrPerSec(controller.timeStep),
            title: 'Simulated megayears per real-time second. The Sun orbits the galaxy in ~220 Myr',
            onChange: (v) => { controller.timeStep = myrPerSecToTimeStep(v); sync(); }
        });
        addSlider(simulationAdvanced, {
            label: 'Gravity softening (ly)', min: 0, max: 9800, step: 10,
            value: controller.softening * LY_PER_UNIT,
            title: 'Physical size given to each particle so close encounters stay finite',
            onChange: (v) => { controller.softening = v / LY_PER_UNIT; sync(); }
        });
        addSlider(simulationAdvanced, {
            label: 'Gas stickiness (%)', min: 0, max: 100, step: 1,
            value: controller.stickiness * 100,
            title: 'Share of the approach velocity lost when two gas clouds collide',
            onChange: (v) => { controller.stickiness = v / 100; sync(); }
        });
        addSlider(simulationAdvanced, {
            label: 'Gas collision radius (ly)', min: 0, max: 9800, step: 10,
            value: controller.stickyRadius * LY_PER_UNIT,
            title: 'Distance below which two gas clouds collide',
            onChange: (v) => { controller.stickyRadius = v / LY_PER_UNIT; sync(); }
        });
        addSlider(simulationAdvanced, {
            label: 'Gas pressure', min: 0, max: 30, step: 0.1, value: controller.gasPressure,
            title: 'Short-range repulsion capping the gas density (interstellar pressure floor)',
            onChange: (v) => { controller.gasPressure = v; sync(); }
        });
        addSlider(simulationAdvanced, {
            label: 'Halo mass (× stellar mass)', min: 0, max: 10, step: 0.1, value: controller.haloMassFactor,
            title: 'Dark matter halo mass per galaxy, as a multiple of its stars (~5 for the Milky Way)',
            onChange: (v) => { controller.haloMassFactor = v; sync(); }
        });
        addSlider(simulationAdvanced, {
            label: 'Galaxy diameter (kly)', min: 1, max: 980, step: 1,
            value: controller.radius * 2 * KLY_PER_UNIT, restart: true,
            title: 'Thousands of light-years. The Milky Way\'s stellar disk spans ~100 kly',
            onChange: (v) => { controller.radius = v / (2 * KLY_PER_UNIT); }
        });
        addSlider(simulationAdvanced, {
            label: 'Galaxy thickness (ly)', min: 0, max: 24500, step: 10,
            value: controller.height * LY_PER_UNIT, restart: true,
            title: 'Vertical extent of the disk. The Milky Way\'s thin disk is ~1,000 ly thick',
            onChange: (v) => { controller.height = v / LY_PER_UNIT; }
        });
        addSlider(simulationAdvanced, {
            label: 'Central concentration', min: 0, max: 20, step: 0.001, value: controller.middleVelocity, restart: true,
            title: 'How strongly the stars pile up toward the center (disk scale length)',
            onChange: (v) => { controller.middleVelocity = v; }
        });
        addSlider(simulationAdvanced, {
            label: 'Gas fraction (%)', min: 0, max: 100, step: 1,
            value: controller.gasFraction * 100, restart: true,
            title: 'Share of the particles that are gas clouds instead of stars (~15% in the Milky Way)',
            onChange: (v) => { controller.gasFraction = v / 100; }
        });
        addSlider(simulationAdvanced, {
            label: 'Velocity dispersion (%)', min: 0, max: 50, step: 0.5,
            value: controller.velocityDispersion * 100, restart: true,
            title: 'Random stellar motion as a share of the orbital velocity (~10% for the Sun\'s neighbors)',
            onChange: (v) => { controller.velocityDispersion = v / 100; }
        });
    } else if (type === SIMULATION_TYPE.UNIVERSE) {
        const tsRef = referenceTimeStep(type, app.quality);
        addSlider(simulationAdvanced, {
            label: 'Simulation speed (×)', min: 0, max: 10, step: 0.1,
            value: timeStepToSpeedFactor(controller.timeStep, tsRef),
            title: 'Speed multiplier relative to the preset',
            onChange: (v) => { controller.timeStep = speedFactorToTimeStep(v, tsRef); sync(); }
        });
        addSlider(simulationAdvanced, {
            label: 'Gravity softening (Mly)', min: 0, max: 200, step: 1,
            value: controller.softening * MLY_PER_UNIT,
            title: 'Physical size given to each galaxy so close encounters stay finite',
            onChange: (v) => { controller.softening = v / MLY_PER_UNIT; sync(); }
        });
        addSlider(simulationAdvanced, {
            label: 'Universe diameter (Mly)', min: 10, max: 10000, step: 10,
            value: controller.radius * MLY_PER_UNIT, restart: true,
            title: 'Millions of light-years. Initial size of the expanding region',
            onChange: (v) => { controller.radius = v / MLY_PER_UNIT; }
        });
    }
    addNote(simulationAdvanced, '* applied on the next restart');
    if (isGalaxyMode) {
        addNote(simulation, 'Scale: 1 particle ≈ 5×10⁵ M☉, Milky Way preset ≈ 100 kly across');
    }

    /* ================== Graphics tab ================== */
    const graphics = tabPanes['graphics'];
    addSlider(graphics, {
        label: 'Particle size', min: 0, max: 2, step: 0.01, value: controller.particleSize,
        onChange: (v) => { controller.particleSize = v; }
    });
    addSlider(graphics, {
        label: 'Bloom', min: 0, max: 2, step: 0.1, value: app.bloom.strength,
        onChange: (v) => {
            app.bloom.strength = v;
            app.bloomPass.strength = v;
        }
    });
    if (isGalaxyMode) {
        addToggle(graphics, {
            label: 'Fluid gas rendering',
            value: controller.gasFluid,
            onChange: (v) => { controller.gasFluid = v; }
        });
        addToggle(graphics, {
            label: 'Fluid star rendering',
            value: controller.starFluid,
            onChange: (v) => { controller.starFluid = v; }
        });
    }
    addToggle(graphics, {
        label: 'Hide environment',
        value: app.hideEnvironment,
        onChange: (v) => {
            controller.hideEnvironment = v;
            app.hideEnvironment = v;
            app.environment.setVisible(!v);
        }
    });

    // Particle colors, applied to the render uniforms immediately
    const setColor = (uniform) => (v) => app.particleUniforms[uniform].value.set(v);
    el('div', 'sp-group-title', graphics).textContent = 'Colors';
    addColor(graphics, {
        label: 'Stars (low acceleration)', value: controller.starLowColor,
        onChange: (v) => { controller.starLowColor = v; setColor('uStarLowColor')(v); }
    });
    addColor(graphics, {
        label: 'Stars (high acceleration)', value: controller.starHighColor,
        onChange: (v) => { controller.starHighColor = v; setColor('uStarHighColor')(v); }
    });
    if (isGalaxyMode) {
        addColor(graphics, {
            label: 'Gas (diffuse)', value: controller.gasDiffuseColor,
            onChange: (v) => { controller.gasDiffuseColor = v; setColor('uGasDiffuseColor')(v); }
        });
        addColor(graphics, {
            label: 'Gas (dense, spiral arms)', value: controller.gasDenseColor,
            onChange: (v) => { controller.gasDenseColor = v; setColor('uGasDenseColor')(v); }
        });
    }

    const graphicsAdvanced = addAdvanced(graphics, 'graphics');
    addToggle(graphicsAdvanced, {
        label: 'Motion blur',
        value: controller.motionBlur,
        onChange: (v) => { controller.motionBlur = v; }
    });
    addToggle(graphicsAdvanced, {
        label: type === SIMULATION_TYPE.UNIVERSE ? 'Hide dark matter' : 'Hide gas',
        value: controller.hideDarkMatter,
        onChange: (v) => { controller.hideDarkMatter = v; }
    });
    addSlider(graphicsAdvanced, {
        label: 'Luminosity', min: 0, max: 3, step: 0.0001, value: controller.luminosity,
        title: 'Exposure of the particles: bright regions are tone mapped instead of clipping to white, so raising it brings out the dark colors without burning the light ones',
        onChange: (v) => { controller.luminosity = v; sync(); }
    });
    if (isGalaxyMode) {
        addDualSlider(graphicsAdvanced, {
            label: 'Fluid cloud size (ly)', min: 10, max: 15000, step: 10,
            valueLow: controller.gasFluidRadius * LY_PER_UNIT,
            valueHigh: controller.gasFluidRadiusMax * LY_PER_UNIT,
            title: 'Cloud splat radius range: dense clouds shrink to the left handle, isolated clouds swell up to the right handle to fill the empty regions',
            onChange: (lo, hi) => {
                controller.gasFluidRadius = lo / LY_PER_UNIT;
                controller.gasFluidRadiusMax = hi / LY_PER_UNIT;
            }
        });
        addSlider(graphicsAdvanced, {
            label: 'Fluid neighbor target', min: 1, max: 32, step: 1, value: controller.gasFluidNeighbors,
            title: 'Each gas cloud grows until it covers this many neighbors: higher = smoother, mistier fluid',
            onChange: (v) => { controller.gasFluidNeighbors = v; }
        });
        addSlider(graphicsAdvanced, {
            label: 'Fluid brightness', min: 0, max: 6, step: 0.1, value: controller.gasFluidIntensity,
            title: 'Exposure of the gas layer',
            onChange: (v) => { controller.gasFluidIntensity = v; }
        });
        addSlider(graphicsAdvanced, {
            label: 'Gas glow (arms)', min: 0, max: 4, step: 0.05, value: controller.gasBrightness,
            onChange: (v) => { controller.gasBrightness = v; }
        });
        addSlider(graphicsAdvanced, {
            label: 'Gas glow threshold', min: 1, max: 100, step: 0.5, value: controller.gasDensityScale,
            onChange: (v) => { controller.gasDensityScale = v; }
        });
        addSlider(graphicsAdvanced, {
            label: 'Color mix (%)', min: 0.01, max: 200, step: 0.01, value: controller.maxAccelerationColorPercent,
            onChange: (v) => {
                controller.maxAccelerationColorPercent = v;
                controller.maxAccelerationColor = v * 10;
                sync();
            }
        });
    } else if (type === SIMULATION_TYPE.UNIVERSE) {
        addSlider(graphicsAdvanced, {
            label: 'Color mix (%)', min: 0.01, max: 100, step: 0.01, value: controller.maxAccelerationColorPercent,
            onChange: (v) => {
                controller.maxAccelerationColorPercent = v;
                controller.maxAccelerationColor = v / 10;
                sync();
            }
        });
    }

    return {
        destroy() {
            root.remove();
        }
    };
}
