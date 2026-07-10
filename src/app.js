import * as THREE from 'three';
import Stats from 'three/examples/jsm/libs/stats.module';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import {
    BLOOM_STRENGTH_BY_TYPE,
    HALO_MERGE_RADIUS_FACTOR,
    PHYSICS_INTERVAL_MS,
    QUALITY,
    SIMULATION_TYPE
} from './config/constants.js';
import { applyPhysicsDefaults, createBootPreset, createPreset } from './config/presets.js';
import { timeStepToMyrPerSec, universeTimeStepToMyrPerSec } from './config/units.js';
import { clearSimulationSettings, loadSimulationSettings, saveSimulationSettings } from './config/storage.js';
import { createEnvironment } from './rendering/environment.js';
import { GasFluid } from './rendering/gasFluid.js';
import { createComposer, updateMotionBlurPasses } from './rendering/postprocessing.js';
import { createComputation, stepSemiImplicit, syncDynamicUniforms } from './simulation/gpuComputation.js';
import { createParticles, getCameraConstant } from './simulation/particles.js';
import { createGUI } from './ui/gui.js';

/**
 * Application orchestrator: owns the Three.js scene, the GPGPU computation,
 * the GUI and the render loop, and handles the full teardown/re-init cycle
 * required when switching or restarting a simulation.
 *
 * `effectController` is the single source of truth for all simulation
 * parameters and is replaced wholesale on simulation switch.
 */
class GalaxyApp {
    constructor() {
        this.quality = QUALITY.NORMAL;
        this.effectController = createBootPreset();
        this.bloom = { strength: 0.6 };
        this.paused = false;
        this.autoRotation = true;
        this.hideEnvironment = true;
        this.showStats = true;
        this.running = false;
        this.nextPhysicsTime = 0;
    }

    /**
     * Entry point, called once from the landing screen.
     */
    start(quality) {
        this.quality = quality;
        if (quality === QUALITY.NORMAL) {
            this.effectController = createPreset(SIMULATION_TYPE.GALAXY, QUALITY.NORMAL);
        }
        this.applySavedParameters();
        this.init();
        if (!this.running) {
            this.running = true;
            window.addEventListener('resize', this.handleResize);
            this.animate();
        }
    }

    /**
     * Build the whole scene for the current effectController: renderer,
     * camera, GPGPU pipeline, particles, GUI and post-processing.
     */
    init() {
        const controller = this.effectController;
        applyPhysicsDefaults(controller);
        const type = Number(controller.typeOfSimulation);

        this.container = document.createElement('div');
        document.body.appendChild(this.container);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 9999999999999999999);
        this.camera.position.set(15, 112, 168);
        // The look-at point lives on the OrbitControls (created below), not on
        // the camera; both are needed to reproduce a panned view
        let cameraTarget = null;
        if (type === SIMULATION_TYPE.GALAXY_COLLISION) {
            if (this.quality === QUALITY.NORMAL) {
                this.camera.position.set(125.1, 128.3, -179.5);
                cameraTarget = new THREE.Vector3(71.4, 57.5, 52.3);
            } else {
                this.camera.position.set(259.5, 248.7, -289.8);
                cameraTarget = new THREE.Vector3(169.8, 130.5, 97.4);
            }
        } else if (this.quality === QUALITY.NORMAL && type === SIMULATION_TYPE.UNIVERSE) {
            this.camera.position.set(-120.3, 72.4, -574.1);
            cameraTarget = new THREE.Vector3(0.0, 0.0, 0.0);
        }

        this.scene = new THREE.Scene();
        this.hideEnvironment = controller.hideEnvironment;
        this.environment = createEnvironment(this.scene, this.camera);
        this.environment.setVisible(!this.hideEnvironment);

        this.renderer = new THREE.WebGLRenderer();
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        if (cameraTarget) this.controls.target.copy(cameraTarget);
        this.autoRotation = controller.autoRotation;
        this.controls.autoRotate = this.autoRotation;
        if (type === SIMULATION_TYPE.UNIVERSE) this.controls.autoRotateSpeed = -1.0;

        this.computation = createComputation(this.renderer, controller, this.quality);
        this.halosMerged = false;
        this.trackedCenter = null;

        // Show fps, ping, etc
        this.stats = new Stats();
        this.container.appendChild(this.stats.dom);
        this.stats.dom.style.display = this.showStats ? '' : 'none';

        // Elapsed simulated time, top center: live counter of the years that
        // have passed since the simulation (re)started
        this.simulatedMyr = 0;
        this.timeRateDisplay = document.createElement('div');
        this.timeRateDisplay.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:100;'
            + 'font:600 16px/1.4 "Segoe UI",system-ui,sans-serif;color:rgba(255,255,255,0.85);'
            + 'letter-spacing:0.05em;white-space:nowrap;'
            + 'pointer-events:none;user-select:none;text-shadow:0 1px 4px rgba(0,0,0,0.9);';
        this.container.appendChild(this.timeRateDisplay);
        this.lastTimeRateText = null;

        // Debug overlay: live camera coordinates, bottom-right corner
        this.cameraDebug = document.createElement('div');
        this.cameraDebug.style.cssText = 'position:fixed;right:8px;bottom:6px;z-index:100;'
            + 'font:10px/1.4 monospace;color:rgba(255,255,255,0.5);'
            + 'pointer-events:none;user-select:none;text-shadow:0 1px 2px rgba(0,0,0,0.8);';
        this.container.appendChild(this.cameraDebug);

        this.gui = createGUI(this);

        const { particles, geometry, material, uniforms } = createParticles(controller, this.camera);
        this.particles = particles;
        this.geometry = geometry;
        this.material = material;
        this.particleUniforms = uniforms;
        this.scene.add(this.particles);

        this.syncUniforms();

        const { composer, bloomPass, gasCompositePass } = createComposer(this.renderer, this.scene, this.camera, this.bloom.strength);
        this.composer = composer;
        this.bloomPass = bloomPass;
        this.gasCompositePass = gasCompositePass;
        this.gasFluid = new GasFluid(window.innerWidth, window.innerHeight);
    }

    /**
     * Dispose everything init() created, so init() can run again.
     */
    teardown() {
        this.gasFluid.dispose();
        this.environment.dispose();
        this.scene.remove(this.particles);
        this.material.dispose();
        this.geometry.dispose();
        this.gui.destroy();
        this.container.remove();
        // Release the old WebGL context (browsers only allow a handful alive at once)
        this.renderer.dispose();
    }

    /**
     * Restart the current simulation, keeping the parameter values.
     */
    restartSimulation() {
        this.paused = false;
        this.teardown();
        this.init();
    }

    /**
     * Switch to the simulation type selected in the GUI dropdown, replacing
     * all parameters with the preset for the current quality mode (overridden
     * by the parameters previously saved for that type, if any).
     */
    switchSimulation() {
        const type = Number(this.effectController.typeOfSimulation);
        this.paused = false;
        this.bloom.strength = BLOOM_STRENGTH_BY_TYPE[type];
        this.effectController = createPreset(type, this.quality);
        this.applySavedParameters();
        this.teardown();
        this.init();
    }

    /**
     * Reset all parameters of the current simulation type to their preset,
     * discarding the saved parameters for that type.
     */
    resetParameters() {
        clearSimulationSettings(Number(this.effectController.typeOfSimulation), this.quality);
        this.switchSimulation();
    }

    /**
     * Persist the current parameters in localStorage; they are reapplied on
     * the next visit and every time this simulation type is selected.
     */
    saveParameters() {
        return saveSimulationSettings(Number(this.effectController.typeOfSimulation), this.quality, {
            controller: { ...this.effectController },
            bloomStrength: this.bloom.strength
        });
    }

    /**
     * Overlay the parameters saved for the current simulation type (if any)
     * onto the current effectController.
     */
    applySavedParameters() {
        const type = Number(this.effectController.typeOfSimulation);
        const saved = loadSimulationSettings(type, this.quality);
        if (!saved) return;
        Object.assign(this.effectController, saved.controller);
        this.effectController.typeOfSimulation = type;
        if (typeof saved.bloomStrength === 'number') this.bloom.strength = saved.bloomStrength;
    }

    /**
     * Push the GUI-adjustable physics parameters into the compute shader.
     */
    syncUniforms() {
        syncDynamicUniforms(this.computation, this.effectController);
    }

    handleResize = () => {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.gasFluid.setSize(window.innerWidth, window.innerHeight);
        this.particleUniforms['cameraConstant'].value = getCameraConstant(this.camera);
    };

    /**
     * Track the halo anchors (the black holes carrying the analytic dark
     * matter halos, particles 0..uHaloCount-1 of the position texture).
     *
     * Collision mode (two anchors):
     *  - once they come closer than HALO_MERGE_RADIUS_FACTOR x radius, fuse
     *    their dark matter halos into a single one (uHalosMerged uniform, see
     *    computeShaderVelocity.glsl). Without this the two rigid halos keep
     *    re-capturing their own stars and the cores bounce off each other
     *    forever instead of forming one remnant.
     *  - keep the camera centered on the pair: the view (camera + orbit
     *    target) is translated by the frame-to-frame motion of the midpoint
     *    between the two anchors, so the encounter and the drifting merger
     *    remnant stay in frame while the user's orbit angle, zoom and pan
     *    offset are preserved.
     *
     * The single galaxy's anchor is pinned at the origin, which is already
     * the default orbit target: no readback needed.
     */
    trackHaloAnchors() {
        if (!this.renderer.capabilities.isWebGL2) return;
        const uniforms = this.computation.velocityUniforms;
        if (uniforms['uHaloCount'].value < 2 || uniforms['uHaloGM'].value <= 0) return;
        const { gpuCompute, positionVariable } = this.computation;
        const pixels = new Float32Array(8);
        this.renderer.readRenderTargetPixels(gpuCompute.getCurrentRenderTarget(positionVariable), 0, 0, 2, 1, pixels);
        if (!this.halosMerged) {
            const dx = pixels[0] - pixels[4];
            const dy = pixels[1] - pixels[5];
            const dz = pixels[2] - pixels[6];
            const threshold = this.effectController.radius * HALO_MERGE_RADIUS_FACTOR;
            if (dx * dx + dy * dy + dz * dz < threshold * threshold) {
                this.halosMerged = true;
                uniforms['uHalosMerged'].value = 1.0;
            }
        }
        // Camera follow: center of the anchors (midpoint of the two halos)
        const cx = 0.5 * (pixels[0] + pixels[4]);
        const cy = 0.5 * (pixels[1] + pixels[5]);
        const cz = 0.5 * (pixels[2] + pixels[6]);
        if (this.trackedCenter) {
            const delta = new THREE.Vector3(cx, cy, cz).sub(this.trackedCenter);
            this.camera.position.add(delta);
            this.controls.target.add(delta);
            this.trackedCenter.set(cx, cy, cz);
        } else {
            this.trackedCenter = new THREE.Vector3(cx, cy, cz);
        }
    }

    animate = () => {
        this.controls.update();
        requestAnimationFrame(this.animate);
        this.render();
        this.stats.update();
    };

    render() {
        const controller = this.effectController;
        this.environment.update(performance.now() / 1000);
        if (!this.paused) {
            const now = performance.now();
            if (now >= this.nextPhysicsTime) {
                // Keep a fixed wall-clock physics cadence; if we fell behind by
                // more than one interval (hidden tab, pause, slow frame), skip
                // the missed steps instead of running catch-up compute passes
                this.nextPhysicsTime = Math.max(this.nextPhysicsTime + PHYSICS_INTERVAL_MS, now);
                stepSemiImplicit(this.computation);
                const { gpuCompute, positionVariable, velocityVariable } = this.computation;
                this.particleUniforms['texturePosition'].value = gpuCompute.getCurrentRenderTarget(positionVariable).texture;
                this.particleUniforms['textureVelocity'].value = gpuCompute.getCurrentRenderTarget(velocityVariable).texture;
                this.trackHaloAnchors();
                // Advance the simulated-time counter by this step's worth of
                // megayears (the calibration reads timeStep as Myr per wall
                // second at the nominal physics cadence)
                const myrPerSec = Number(controller.typeOfSimulation) === SIMULATION_TYPE.UNIVERSE
                    ? universeTimeStepToMyrPerSec(controller.timeStep)
                    : timeStepToMyrPerSec(controller.timeStep);
                this.simulatedMyr += myrPerSec * (PHYSICS_INTERVAL_MS / 1000);
            }
            this.particleUniforms['uMaxAccelerationColor'].value = controller.maxAccelerationColor;
        }
        // Fluid layer: OpenSPH-style volumetric splatting. Gas and stars join
        // it independently (two GUI toggles); whatever is in the layer renders
        // into the GasFluid HDR target (variable radius + center-weighted
        // emission), leaves the main pass, and comes back tone-mapped through
        // the composite pass. In universe mode the "stars" are whole galaxies
        // and the gas is the intergalactic medium.
        const gasInFluid = controller.gasFluid && !controller.hideDarkMatter;
        const starInFluid = controller.starFluid;
        const fluidOn = gasInFluid || starInFluid;
        this.particleUniforms['uGasFluidOn'].value = gasInFluid ? 1.0 : 0.0;
        this.particleUniforms['uStarFluid'].value = starInFluid ? 1.0 : 0.0;
        if (fluidOn) {
            this.environment.setVisible(false);
            this.gasFluid.update(this.renderer, this.scene, this.camera, this.particleUniforms);
            this.environment.setVisible(!this.hideEnvironment);
            this.particleUniforms['uRenderPass'].value = 1.0;
            this.gasCompositePass.uniforms['tGas'].value = this.gasFluid.texture;
            this.gasCompositePass.uniforms['uIntensity'].value = controller.gasFluidIntensity;
        } else {
            this.particleUniforms['uRenderPass'].value = 0.0;
        }
        this.gasCompositePass.enabled = fluidOn;

        updateMotionBlurPasses(this.composer, controller.motionBlur);
        this.particleUniforms['uLuminosity'].value = controller.luminosity;
        this.particleUniforms['uHideDarkMatter'].value = controller.hideDarkMatter;
        this.particleUniforms['uParticleSize'].value = controller.particleSize;
        this.particleUniforms['uGasBrightness'].value = controller.gasBrightness;
        this.particleUniforms['uGasDensityScale'].value = controller.gasDensityScale;
        this.particleUniforms['uGasFluidRadius'].value = controller.gasFluidRadius;
        this.particleUniforms['uGasFluidRadiusMax'].value = controller.gasFluidRadiusMax;
        this.particleUniforms['uGasNeighborTarget'].value = controller.gasFluidNeighbors;
        // Elapsed simulated time readout (top center), counting up in real
        // time; freezes while paused (the counter only advances with the
        // physics steps)
        const timeText = `Simulation Time: ${formatSimulatedTime(this.simulatedMyr)}`;
        if (timeText !== this.lastTimeRateText) {
            this.timeRateDisplay.textContent = timeText;
            this.lastTimeRateText = timeText;
        }
        this.timeRateDisplay.style.opacity = this.paused ? '0.45' : '1';

        // Position alone does not pin the view down: right-drag panning moves
        // the OrbitControls look-at target too, so show both
        const camPos = this.camera.position;
        const camTgt = this.controls.target;
        this.cameraDebug.textContent = `cam x ${camPos.x.toFixed(1)}  y ${camPos.y.toFixed(1)}  z ${camPos.z.toFixed(1)}`
            + `  |  tgt x ${camTgt.x.toFixed(1)}  y ${camTgt.y.toFixed(1)}  z ${camTgt.z.toFixed(1)}`;
        this.composer.render();
    }
}

/**
 * Human-readable elapsed simulated time from megayears:
 * 245.7 -> "245 million years", 4580 -> "4.58 billion years".
 */
function formatSimulatedTime(myr) {
    if (myr >= 1000) return `${(myr / 1000).toFixed(2)} billion years`;
    if (myr >= 1) return `${Math.floor(myr)} million years`;
    return `${Math.floor(myr * 1000)} thousand years`;
}

export const app = new GalaxyApp();
