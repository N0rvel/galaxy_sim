import { SIMULATION_TYPE } from '../config/constants.js';
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
function addSlider(parent, { label, min, max, step, value, onChange, restart = false }) {
    const decimals = stepDecimals(step);
    const row = el('div', 'sp-row', parent);
    const top = el('div', 'sp-row-top', row);
    const name = el('span', 'sp-label', top);
    name.textContent = label;
    if (restart) {
        name.textContent += ' *';
        row.title = 'Applied on the next restart';
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
    const simulation = tabPanes['simulation'];
    addSlider(simulation, {
        label: 'Gravity', min: 0, max: 1000, step: 0.05, value: controller.gravity,
        onChange: (v) => { controller.gravity = v; sync(); }
    });
    if (isGalaxyMode) {
        addSlider(simulation, {
            label: 'Black hole mass', min: 0, max: 10000, step: 1, value: controller.blackHoleForce,
            onChange: (v) => { controller.blackHoleForce = v; sync(); }
        });
        addSlider(simulation, {
            label: 'Stars', min: 2, max: 1000000, step: 1, value: controller.numberOfStars, restart: true,
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
        label: 'Interaction rate', min: 0, max: 1, step: 0.001, value: controller.interactionRate,
        onChange: (v) => { controller.interactionRate = v; sync(); }
    });
    addSlider(simulationAdvanced, {
        label: 'Time step', min: 0, max: 0.01, step: 0.0001, value: controller.timeStep,
        onChange: (v) => { controller.timeStep = v; sync(); }
    });
    addSlider(simulationAdvanced, {
        label: 'Gravity softening', min: 0, max: 20, step: 0.05, value: controller.softening,
        onChange: (v) => { controller.softening = v; sync(); }
    });
    if (isGalaxyMode) {
        addSlider(simulationAdvanced, {
            label: 'Gas stickiness', min: 0, max: 1, step: 0.01, value: controller.stickiness,
            onChange: (v) => { controller.stickiness = v; sync(); }
        });
        addSlider(simulationAdvanced, {
            label: 'Gas collision radius', min: 0, max: 20, step: 0.1, value: controller.stickyRadius,
            onChange: (v) => { controller.stickyRadius = v; sync(); }
        });
        addSlider(simulationAdvanced, {
            label: 'Gas pressure', min: 0, max: 30, step: 0.1, value: controller.gasPressure,
            onChange: (v) => { controller.gasPressure = v; sync(); }
        });
        if (type === SIMULATION_TYPE.GALAXY) {
            addSlider(simulationAdvanced, {
                label: 'Halo mass (x stars)', min: 0, max: 10, step: 0.1, value: controller.haloMassFactor,
                onChange: (v) => { controller.haloMassFactor = v; sync(); }
            });
        }
        addSlider(simulationAdvanced, {
            label: 'Galaxy diameter', min: 1, max: 1000, step: 1, value: controller.radius, restart: true,
            onChange: (v) => { controller.radius = v; }
        });
        addSlider(simulationAdvanced, {
            label: 'Galaxy height', min: 0, max: 50, step: 0.01, value: controller.height, restart: true,
            onChange: (v) => { controller.height = v; }
        });
        addSlider(simulationAdvanced, {
            label: 'Central concentration', min: 0, max: 20, step: 0.001, value: controller.middleVelocity, restart: true,
            onChange: (v) => { controller.middleVelocity = v; }
        });
        addSlider(simulationAdvanced, {
            label: 'Gas fraction', min: 0, max: 1, step: 0.01, value: controller.gasFraction, restart: true,
            onChange: (v) => { controller.gasFraction = v; }
        });
        addSlider(simulationAdvanced, {
            label: 'Velocity dispersion', min: 0, max: 0.5, step: 0.005, value: controller.velocityDispersion, restart: true,
            onChange: (v) => { controller.velocityDispersion = v; }
        });
    } else if (type === SIMULATION_TYPE.UNIVERSE) {
        addSlider(simulationAdvanced, {
            label: 'Universe diameter', min: 1, max: 1000, step: 1, value: controller.radius, restart: true,
            onChange: (v) => { controller.radius = v; }
        });
    }
    addNote(simulationAdvanced, '* applied on the next restart');

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
    addToggle(graphics, {
        label: 'Hide environment',
        value: app.hideEnvironment,
        onChange: (v) => {
            app.hideEnvironment = v;
            app.environment.setVisible(!v);
        }
    });

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
    if (isGalaxyMode) {
        addSlider(graphicsAdvanced, {
            label: 'Gas glow (arms)', min: 0, max: 4, step: 0.05, value: controller.gasBrightness,
            onChange: (v) => { controller.gasBrightness = v; }
        });
        addSlider(graphicsAdvanced, {
            label: 'Gas glow threshold', min: 1, max: 100, step: 0.5, value: controller.gasDensityScale,
            onChange: (v) => { controller.gasDensityScale = v; }
        });
        addSlider(graphicsAdvanced, {
            label: 'Color mix (%)', min: 0.01, max: 100, step: 0.01, value: controller.maxAccelerationColorPercent,
            onChange: (v) => {
                controller.maxAccelerationColorPercent = v;
                controller.maxAccelerationColor = v * 10;
                sync();
            }
        });
    } else if (type === SIMULATION_TYPE.UNIVERSE) {
        addSlider(graphicsAdvanced, {
            label: 'Luminosity', min: 0, max: 1, step: 0.0001, value: controller.luminosity,
            onChange: (v) => { controller.luminosity = v; sync(); }
        });
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
