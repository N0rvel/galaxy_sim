import * as THREE from 'three';
import Stats from 'three/examples/jsm/libs/stats.module';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import {
    BLOOM_STRENGTH_BY_TYPE,
    PHYSICS_INTERVAL_MS,
    QUALITY,
    SIMULATION_TYPE
} from './config/constants.js';
import { applyPhysicsDefaults, createBootPreset, createPreset } from './config/presets.js';
import { clearSimulationSettings, loadSimulationSettings, saveSimulationSettings } from './config/storage.js';
import { createEnvironment } from './rendering/environment.js';
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
        this.hideEnvironment = false;
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
        if (type === SIMULATION_TYPE.GALAXY_COLLISION
            || (this.quality === QUALITY.NORMAL && type === SIMULATION_TYPE.UNIVERSE)) {
            this.camera.position.set(15, 456, 504);
        }

        this.scene = new THREE.Scene();
        this.environment = createEnvironment(this.scene, this.camera);
        this.environment.setVisible(!this.hideEnvironment);

        this.renderer = new THREE.WebGLRenderer();
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        if (type === SIMULATION_TYPE.UNIVERSE) {
            this.controls.autoRotate = true;
            this.controls.autoRotateSpeed = -1.0;
        } else {
            this.controls.autoRotate = false;
        }

        this.computation = createComputation(this.renderer, controller, this.quality);

        // Show fps, ping, etc
        this.stats = new Stats();
        this.container.appendChild(this.stats.dom);
        this.stats.dom.style.display = this.showStats ? '' : 'none';

        this.gui = createGUI(this);

        const { particles, geometry, material, uniforms } = createParticles(controller, this.camera);
        this.particles = particles;
        this.geometry = geometry;
        this.material = material;
        this.particleUniforms = uniforms;
        this.scene.add(this.particles);

        this.syncUniforms();

        const { composer, bloomPass } = createComposer(this.renderer, this.scene, this.camera, this.bloom.strength);
        this.composer = composer;
        this.bloomPass = bloomPass;
    }

    /**
     * Dispose everything init() created, so init() can run again.
     */
    teardown() {
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
        this.particleUniforms['cameraConstant'].value = getCameraConstant(this.camera);
    };

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
            }
            this.particleUniforms['uMaxAccelerationColor'].value = controller.maxAccelerationColor;
        }
        updateMotionBlurPasses(this.composer, controller.motionBlur);
        this.particleUniforms['uLuminosity'].value = controller.luminosity;
        this.particleUniforms['uHideDarkMatter'].value = controller.hideDarkMatter;
        this.particleUniforms['uParticleSize'].value = controller.particleSize;
        this.particleUniforms['uGasBrightness'].value = controller.gasBrightness;
        this.particleUniforms['uGasDensityScale'].value = controller.gasDensityScale;
        this.composer.render();
    }
}

export const app = new GalaxyApp();
