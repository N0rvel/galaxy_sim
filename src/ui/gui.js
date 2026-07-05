import { GUI } from 'dat.gui';
import { SIMULATION_TYPE, SIMULATION_TYPE_OPTIONS } from '../config/constants.js';

/**
 * dat.gui control panel. Rebuilt from scratch on every simulation switch or
 * restart, since the available controls depend on the simulation type.
 *
 * @param app the GalaxyApp instance (state + restart/switch/sync callbacks)
 * @returns the GUI instance (destroyed by the app on teardown)
 */
export function createGUI(app) {
    const controller = app.effectController;
    const type = Number(controller.typeOfSimulation);
    const isGalaxyMode = type === SIMULATION_TYPE.GALAXY || type === SIMULATION_TYPE.GALAXY_COLLISION;
    const sync = () => app.syncUniforms();

    const gui = new GUI({ width: 350 });

    const folderDynamic = gui.addFolder('Dynamic Parameters');
    const folderGraphics = gui.addFolder('Graphics settings');
    const folderStatic = gui.addFolder('Static parameters (need to restart the simulation)');

    /* ---- Dynamic physics parameters ---- */
    folderDynamic.add(controller, 'gravity', 0.0, 1000.0, 0.05).onChange(sync).name('Gravitational force');
    folderDynamic.add(controller, 'interactionRate', 0.0, 1.0, 0.001).onChange(sync).name('Interaction rate (%)');
    folderDynamic.add(controller, 'timeStep', 0.0, 0.01, 0.0001).onChange(sync).name('Time step');
    folderDynamic.add(controller, 'softening', 0.0, 20.0, 0.05).onChange(sync).name('Gravity softening (Plummer)');
    folderDynamic.add(controller, 'hideDarkMatter')
        .name(type === SIMULATION_TYPE.UNIVERSE ? 'Hide dark matter' : 'Hide gas');

    /* ---- Graphics settings ---- */
    folderGraphics.add(controller, 'particleSize', 0.0, 2.0, 0.01).name('Particle size');
    folderGraphics.add(app.bloom, 'strength', 0.0, 2.0, 0.1).onChange(function (value) {
        app.bloomPass.strength = value;
    }).name('Bloom');
    folderGraphics.add(controller, 'motionBlur').name('Motion blur');

    if (isGalaxyMode) {
        folderDynamic.add(controller, 'blackHoleForce', 0.0, 10000.0, 1.0).onChange(sync).name('Black hole mass');
        folderDynamic.add(controller, 'stickiness', 0.0, 1.0, 0.01).onChange(sync).name('Gas stickiness');
        folderDynamic.add(controller, 'stickyRadius', 0.0, 20.0, 0.1).onChange(sync).name('Gas collision radius');
        folderDynamic.add(controller, 'gasPressure', 0.0, 30.0, 0.1).onChange(sync).name('Gas pressure');
        if (type === SIMULATION_TYPE.GALAXY) {
            folderDynamic.add(controller, 'haloMassFactor', 0.0, 10.0, 0.1).onChange(sync).name('Dark matter halo mass (x stars)');
        }
        folderGraphics.add(controller, 'gasBrightness', 0.0, 4.0, 0.05).name('Gas glow (arms)');
        folderGraphics.add(controller, 'gasDensityScale', 1.0, 100.0, 0.5).name('Gas glow threshold');
        folderGraphics.add(controller, 'maxAccelerationColorPercent', 0.01, 100, 0.01).onChange(function (value) {
            controller.maxAccelerationColor = value * 10;
            sync();
        }).name('Colors mix (%)');
        folderStatic.add(controller, 'numberOfStars', 2.0, 1000000.0, 1.0).name('Number of stars');
        folderStatic.add(controller, 'radius', 1.0, 1000.0, 1.0).name('Galaxy diameter');
        folderStatic.add(controller, 'height', 0.0, 50.0, 0.01).name('Galaxy height');
        folderStatic.add(controller, 'middleVelocity', 0.0, 20.0, 0.001).name('Central concentration');
        folderStatic.add(controller, 'gasFraction', 0.0, 1.0, 0.01).name('Gas fraction');
        folderStatic.add(controller, 'velocityDispersion', 0.0, 0.5, 0.005).name('Initial velocity dispersion');
    } else if (type === SIMULATION_TYPE.UNIVERSE) {
        folderGraphics.add(controller, 'luminosity', 0.0, 1.0, 0.0001).onChange(sync).name('Luminosity');
        folderGraphics.add(controller, 'maxAccelerationColorPercent', 0.01, 100, 0.01).onChange(function (value) {
            controller.maxAccelerationColor = value / 10;
            sync();
        }).name('Colors mix (%)');
        folderStatic.add(controller, 'numberOfStars', 2.0, 10000000.0, 1.0).name('Number of galaxies');
        folderStatic.add(controller, 'radius', 1.0, 1000.0, 1.0).name('Initial diameter of the universe');
        folderStatic.add(controller, 'autoRotation').name('Auto-rotation').listen().onChange(function () {
            app.autoRotation = !app.autoRotation;
            app.controls.autoRotate = app.autoRotation;
        });
    }

    /* ---- Simulation control buttons ---- */
    const actions = {
        restartSimulation: () => app.restartSimulation(),
        resetParameters: () => app.resetParameters(),
        pauseSimulation: function () {}
    };

    folderStatic.add(controller, 'typeOfSimulation', SIMULATION_TYPE_OPTIONS)
        .onChange(() => app.switchSimulation())
        .name('Type of simulation');
    folderStatic.add(actions, 'restartSimulation').name('Restart the simulation');
    folderStatic.add(actions, 'resetParameters').name('Reset parameters');
    const pauseController = folderStatic.add(actions, 'pauseSimulation').name('Pause');
    pauseController.onChange(function () {
        app.paused = !app.paused;
        pauseController.name(app.paused ? 'Resume' : 'Pause');
        pauseController.updateDisplay();
    });

    folderDynamic.open();
    folderStatic.open();
    folderGraphics.open();

    return gui;
}
