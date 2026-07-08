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
        if (type === SIMULATION_TYPE.GALAXY_COLLISION
            || (this.quality === QUALITY.NORMAL && type === SIMULATION_TYPE.UNIVERSE)) {
            this.camera.position.set(91.2, 252.6, -303.7);
            cameraTarget = new THREE.Vector3(97.7, 67.7, 67.4);
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

        // Show fps, ping, etc
        this.stats = new Stats();
        this.container.appendChild(this.stats.dom);
        this.stats.dom.style.display = this.showStats ? '' : 'none';

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
     * Collision mode: watch the separation of the two black holes (particles
     * 0 and 1 of the position texture) and, once they come closer than
     * HALO_MERGE_RADIUS_FACTOR x radius, fuse their dark matter halos into a
     * single one (uHalosMerged uniform, see computeShaderVelocity.glsl).
     * Without this the two rigid halos keep re-capturing their own stars and
     * the cores bounce off each other forever instead of forming one remnant.
     */
    checkHaloMerge() {
        if (this.halosMerged || !this.renderer.capabilities.isWebGL2) return;
        const uniforms = this.computation.velocityUniforms;
        if (uniforms['uHaloCount'].value < 2 || uniforms['uHaloGM'].value <= 0) return;
        const { gpuCompute, positionVariable } = this.computation;
        const pixels = new Float32Array(8);
        this.renderer.readRenderTargetPixels(gpuCompute.getCurrentRenderTarget(positionVariable), 0, 0, 2, 1, pixels);
        const dx = pixels[0] - pixels[4];
        const dy = pixels[1] - pixels[5];
        const dz = pixels[2] - pixels[6];
        const threshold = this.effectController.radius * HALO_MERGE_RADIUS_FACTOR;
        if (dx * dx + dy * dy + dz * dz < threshold * threshold) {
            this.halosMerged = true;
            uniforms['uHalosMerged'].value = 1.0;
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
                this.checkHaloMerge();
            }
            this.particleUniforms['uMaxAccelerationColor'].value = controller.maxAccelerationColor;
        }
        // Fluid layer: OpenSPH-style volumetric splatting. Gas and stars join
        // it independently (two GUI toggles); whatever is in the layer renders
        // into the GasFluid HDR target (variable radius + center-weighted
        // emission), leaves the main pass, and comes back tone-mapped through
        // the composite pass.
        const isGalaxyMode = Number(controller.typeOfSimulation) !== SIMULATION_TYPE.UNIVERSE;
        const gasInFluid = isGalaxyMode && controller.gasFluid && !controller.hideDarkMatter;
        const starInFluid = isGalaxyMode && controller.starFluid;
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
        // Position alone does not pin the view down: right-drag panning moves
        // the OrbitControls look-at target too, so show both
        const camPos = this.camera.position;
        const camTgt = this.controls.target;
        this.cameraDebug.textContent = `cam x ${camPos.x.toFixed(1)}  y ${camPos.y.toFixed(1)}  z ${camPos.z.toFixed(1)}`
            + `  |  tgt x ${camTgt.x.toFixed(1)}  y ${camTgt.y.toFixed(1)}  z ${camTgt.z.toFixed(1)}`;
        this.composer.render();
    }
}

export const app = new GalaxyApp();
