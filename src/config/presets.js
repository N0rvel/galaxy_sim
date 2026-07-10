import { QUALITY, SIMULATION_TYPE } from './constants.js';
import {
    BH_MSUN6_PER_FORCE,
    KLY_PER_UNIT,
    LY_PER_UNIT,
    MLY_PER_UNIT,
    myrPerSecToTimeStep,
    referenceGravity,
    referenceTimeStep,
    speedFactorToTimeStep
} from './units.js';

/**
 * Simulation presets (the "effectController" objects).
 *
 * The preset literals are written in the SAME units the GUI displays, so a
 * value read on a slider can be copied verbatim into a preset:
 *
 *   galaxy modes                          universe mode
 *   ------------                          -------------
 *   gravity                x G            gravity            x G
 *   timeStep               Myr/s          timeStep           speed x
 *   interactionRate        %              interactionRate    %
 *   blackHoleForce         10^6 Msun      radius             diameter, Mly
 *   radius                 diameter, kly  softening, stickyRadius,
 *   height                 ly             gasFluidRadius(Max)  Mly
 *   softening, stickyRadius,
 *   gasFluidRadius, gasFluidRadiusMax  ly
 *   stickiness, gasFraction,
 *   velocityDispersion     %              (stickiness, gasFraction: % too)
 *   maxAccelerationColorPercent  "Color mix" %
 *
 * createPreset() converts them to the internal simulation units through
 * presetToInternal(); everything downstream of it (the effectController, the
 * saved settings, the shaders) keeps using internal units.
 *
 * Every preset has two groups of fields:
 *  - dynamic parameters, applied live through the GUI (gravity, timeStep, ...)
 *  - static parameters that require a simulation restart (numberOfStars,
 *    radius, typeOfSimulation, ...)
 *
 * `numberOfStars` must be a perfect square because it becomes the GPGPU
 * texture dimensions.
 */

const PRESETS = {
    // Normal quality: tuned to run on modest GPUs (integrated graphics
    // included). 14400 particles at 45% interaction rate keep the pair loop
    // near the original 10k budget (~36M pair ops per physics step) while the
    // disk surface density stays close to the experimental preset, so the
    // same gas physics produces comparable structure. Neighbor-count driven
    // values (color mix, fluid neighbor target, glow threshold) are ~9x lower
    // than experimental because sampled counts scale with N x rate^2.
    [QUALITY.NORMAL]: {
        [SIMULATION_TYPE.GALAXY]: {
            gravity: 1,
            interactionRate: 47.9,
            softening: 1340,
            timeStep: 60,
            blackHoleForce: 50,
            luminosity: 1.0,
            maxAccelerationColorPercent: 100,
            stickiness: 12,
            stickyRadius: 900,
            gasPressure: 5.0,
            gasFraction: 30,
            haloMassFactor: 2.0,
            gasDensityScale: 1.0, //gas glow threshold
            gasFluidRadius: 390,
            gasFluidRadiusMax: 1260,
            gasFluidNeighbors: 32,
            gasFluidIntensity: 0.6,
            velocityDispersion: 0,

            numberOfStars: 14400, // 120^2
            radius: 40,
            height: 2446,
            middleVelocity: 2,
            typeOfSimulation: SIMULATION_TYPE.GALAXY,
            autoRotation: false,
            starLowColor: '#9348f7',
            starHighColor: '#ffffff',
            gasDiffuseColor: '#0000ff',
            gasDenseColor: '#ff8000'
        },
        [SIMULATION_TYPE.UNIVERSE]: {
            gravity: 1,
            interactionRate: 5,
            timeStep: 2,
            blackHoleForce: 100.0,
            luminosity: 0.25,
            maxAccelerationColorPercent: 20,
            stickiness: 30,
            stickyRadius: 10,
            gasPressure: 2.0,
            gasDensityScale: 1,
            gasFluidRadius: 29.5,
            gasFluidRadiusMax: 100,
            gasFluidNeighbors: 2,
            gasFluidIntensity: 1.7,

            numberOfStars: 100000,
            radius: 38,
            height: 5,
            middleVelocity: 2,
            gasFraction: 0.0,
            typeOfSimulation: SIMULATION_TYPE.UNIVERSE,
            autoRotation: true
        },
        [SIMULATION_TYPE.GALAXY_COLLISION]: {
            gravity: 1,
            interactionRate: 45,
            timeStep: 120,
            softening: 400,
            blackHoleForce: 50,
            luminosity: 1.0,
            maxAccelerationColorPercent: 60,
            stickiness: 15,
            stickyRadius: 900,
            gasPressure: 5.0,
            gasFraction: 30,
            haloMassFactor: 3.0,
            gasDensityScale: 1.0,
            gasFluidRadius: 390,
            gasFluidRadiusMax: 1260,
            gasFluidNeighbors: 32,
            gasFluidIntensity: 1.0,

            numberOfStars: 14400, // 120^2 -> 7200 particles per galaxy
            radius: 40,
            height: 2446,
            middleVelocity: 2,
            typeOfSimulation: SIMULATION_TYPE.GALAXY_COLLISION,
            autoRotation: false,
            hideEnvironment: false,

            starLowColor: '#00ffff',
            starHighColor: '#ff80ff',
            gasDiffuseColor: '#00ffff',
            gasDenseColor: '#ff80ff'
        }
    },
    [QUALITY.EXPERIMENTAL]: {
        // Tuned for stable spiral arms: ~100k particles, sticky gas,
        // moderate dark matter halo
        [SIMULATION_TYPE.GALAXY]: {
            gravity: 1,
            interactionRate: 47.9,
            timeStep: 120,
            blackHoleForce: 50,
            luminosity: 1.0,
            maxAccelerationColorPercent: 100,
            stickiness: 30,
            stickyRadius: 1370,
            gasPressure: 5.0,
            gasFraction: 30,
            haloMassFactor: 3.0,
            gasFluidRadius: 520,
            gasFluidRadiusMax: 1990,
            gasFluidNeighbors: 28,
            gasFluidIntensity: 0.6,

            numberOfStars: 99856, // 316^2
            radius: 97.84,
            height: 2446,
            middleVelocity: 2,
            typeOfSimulation: SIMULATION_TYPE.GALAXY,
            autoRotation: false
        },
        [SIMULATION_TYPE.UNIVERSE]: {
            gravity: 1,
            interactionRate: 5,
            timeStep: 1,
            blackHoleForce: 100.0,
            luminosity: 0.40,
            maxAccelerationColorPercent: 22.38,
            stickiness: 30,
            stickyRadius: 10,
            gasPressure: 2.0,
            gasDensityScale: 1,
            gasFluidRadius: 11,
            gasFluidRadiusMax: 100,
            gasFluidNeighbors: 1,
            gasFluidIntensity: 0.2,
            starFluid: true,
            gasFluid: false,

            numberOfStars: 1000000,
            radius: 20,
            height: 5,
            middleVelocity: 2,
            gasFraction: 0,
            typeOfSimulation: SIMULATION_TYPE.UNIVERSE,
            autoRotation: true
        },
        [SIMULATION_TYPE.GALAXY_COLLISION]: {
            // Two clones of the experimental galaxy preset (~50k particles
            // each, same physics, gas and dark-matter-halo parameters; each
            // halo is anchored to its galaxy's moving black hole)
            gravity: 1,
            interactionRate: 47.9,
            timeStep: 120,
            blackHoleForce: 50,
            luminosity: 1.0,
            maxAccelerationColorPercent: 100,
            stickiness: 15,
            stickyRadius: 3260,
            gasPressure: 5.0,
            gasFraction: 30,
            haloMassFactor: 3.0,
            gasFluidRadius: 1440,
            gasFluidRadiusMax: 6690,
            gasFluidNeighbors: 28,
            gasFluidIntensity: 1.0,
            gasDensityScale: 4.5,

            numberOfStars: 99856, // 316^2 -> 49928 particles per galaxy
            radius: 97.84,
            height: 2446,
            middleVelocity: 2,
            typeOfSimulation: SIMULATION_TYPE.GALAXY_COLLISION,
            autoRotation: false,
            hideEnvironment: false,

            starLowColor: '#00ffff',
            starHighColor: '#ff80ff',
            gasDiffuseColor: '#00ffff',
            gasDenseColor: '#ff80ff',
        }
    }
};

/**
 * Convert a preset written in GUI display units (see the table above) to the
 * internal simulation units, in place. Only the fields present are converted,
 * mirroring exactly the conversions the GUI sliders apply.
 */
function presetToInternal(preset, quality) {
    const type = preset.typeOfSimulation;
    const isGalaxyMode = type !== SIMULATION_TYPE.UNIVERSE;
    const has = (key) => preset[key] !== undefined;

    if (has('gravity')) preset.gravity *= referenceGravity(type, quality);
    if (has('interactionRate')) preset.interactionRate /= 100;
    if (has('stickiness')) preset.stickiness /= 100;
    if (has('gasFraction')) preset.gasFraction /= 100;
    // "Color mix" slider: the internal cap is percent x 10 in galaxy modes,
    // percent / 10 in universe mode
    if (has('maxAccelerationColorPercent')) {
        preset.maxAccelerationColor = isGalaxyMode
            ? preset.maxAccelerationColorPercent * 10
            : preset.maxAccelerationColorPercent / 10;
    }
    if (isGalaxyMode) {
        if (has('timeStep')) preset.timeStep = myrPerSecToTimeStep(preset.timeStep);
        if (has('blackHoleForce')) preset.blackHoleForce /= BH_MSUN6_PER_FORCE;
        if (has('softening')) preset.softening /= LY_PER_UNIT;
        if (has('stickyRadius')) preset.stickyRadius /= LY_PER_UNIT;
        if (has('radius')) preset.radius /= 2 * KLY_PER_UNIT;
        if (has('height')) preset.height /= LY_PER_UNIT;
        if (has('velocityDispersion')) preset.velocityDispersion /= 100;
        if (has('gasFluidRadius')) preset.gasFluidRadius /= LY_PER_UNIT;
        if (has('gasFluidRadiusMax')) preset.gasFluidRadiusMax /= LY_PER_UNIT;
    } else {
        if (has('timeStep')) preset.timeStep = speedFactorToTimeStep(preset.timeStep, referenceTimeStep());
        if (has('softening')) preset.softening /= MLY_PER_UNIT;
        if (has('stickyRadius')) preset.stickyRadius /= MLY_PER_UNIT;
        if (has('radius')) preset.radius /= MLY_PER_UNIT;
        if (has('gasFluidRadius')) preset.gasFluidRadius /= MLY_PER_UNIT;
        if (has('gasFluidRadiusMax')) preset.gasFluidRadiusMax /= MLY_PER_UNIT;
    }
    return preset;
}

/**
 * Fresh effectController object (internal units) for the given simulation
 * type and quality.
 */
export function createPreset(type, quality) {
    return presetToInternal({
        motionBlur: false,
        hideDarkMatter: false,
        ...PRESETS[quality][type]
    }, quality);
}

/**
 * Preset loaded before the landing screen choice: the experimental galaxy,
 * with a slightly lower gas fraction than the one used when switching
 * simulations later.
 */
export function createBootPreset() {
    return {
        ...createPreset(SIMULATION_TYPE.GALAXY, QUALITY.EXPERIMENTAL),
        gasFraction: 0.3 // internal fraction (30 %)
    };
}

/**
 * Fill in physics parameters that older presets do not define, so every
 * effectController object gets consistent defaults for the gas / softening /
 * halo model without repeating them in each preset literal. Runs AFTER
 * presetToInternal: everything here is in internal units.
 */
export function applyPhysicsDefaults(controller) {
    const isGalaxyMode = controller.typeOfSimulation === SIMULATION_TYPE.GALAXY
        || controller.typeOfSimulation === SIMULATION_TYPE.GALAXY_COLLISION;
    // View flags read by GalaxyApp.init(): backdrop visibility and camera
    // auto-rotation (both were previously app-level only and ignored the
    // preset values)
    if (controller.hideEnvironment === undefined) controller.hideEnvironment = true;
    if (controller.autoRotation === undefined) {
        controller.autoRotation = controller.typeOfSimulation === SIMULATION_TYPE.UNIVERSE;
    }
    // Universe mode: a share of the particles is sticky intergalactic gas
    // (the old inert "dark matter" population), the rest are galaxies
    if (controller.gasFraction === undefined) controller.gasFraction = 0.3;
    if (controller.velocityDispersion === undefined) controller.velocityDispersion = 0.08;
    // Plummer softening length: particles are clouds with a physical size, not points.
    // Universe mode pairs it with the per-pair acceleration cap in the compute
    // shader (particles are whole galaxies): softening 1.0 reproduces the
    // original d^2 + 1 force law, the cap handles close encounters.
    if (controller.softening === undefined) controller.softening = isGalaxyMode ? controller.radius * 0.02 : 1.0;
    // Fraction of the compressive relative velocity removed per gas-gas collision
    if (controller.stickiness === undefined) controller.stickiness = 0.5;
    if (controller.stickyRadius === undefined) controller.stickyRadius = controller.radius * 0.04;
    // Short-range repulsion between gas clouds (interstellar pressure floor)
    if (controller.gasPressure === undefined) controller.gasPressure = 5.0;
    // One analytic halo per galaxy, anchored to that galaxy's black hole
    if (controller.haloMassFactor === undefined) controller.haloMassFactor = isGalaxyMode ? 3.0 : 0.0;
    // World-space particle sprite size (0 = plain 1-pixel points, used in universe mode)
    if (controller.particleSize === undefined) controller.particleSize = isGalaxyMode ? 0.25 : 0.0;
    // Gas rendering: dense (compressed) gas glows bright violet to highlight the
    // spiral arms, mimicking the young blue stars / HII regions that trace arms
    // in real galaxies. gasDensityScale is the neighbor count treated as "dense";
    if (controller.gasBrightness === undefined) controller.gasBrightness = 1;
    if (controller.gasDensityScale === undefined) controller.gasDensityScale = 1;
    // Fluid gas rendering (OpenSPH-style volumetric splatting, see
    // rendering/gasFluid.js): splat radius range (world units; dense clouds
    // shrink to gasFluidRadius, isolated ones swell up to gasFluidRadiusMax),
    // the neighbor count each particle dilates to cover, and the composite
    // exposure
    if (controller.gasFluid === undefined) controller.gasFluid = true;
    // Render the stars as volumetric splats too (same dilation model)
    if (controller.starFluid === undefined) controller.starFluid = true;
    if (controller.gasFluidRadius === undefined) controller.gasFluidRadius = isGalaxyMode ? 1.5 : 0.2;
    if (controller.gasFluidRadiusMax === undefined) {
        // Back-compat: settings saved before gasFluidRadiusMax existed carry
        // the old dilation factor instead
        const dilation = controller.gasFluidMaxDistention !== undefined ? controller.gasFluidMaxDistention : 20;
        controller.gasFluidRadiusMax = controller.gasFluidRadius * dilation;
    }
    if (controller.gasFluidNeighbors === undefined) controller.gasFluidNeighbors = 28;
    if (controller.gasFluidIntensity === undefined) controller.gasFluidIntensity = 1.0;
    // Particle colors (hex strings for the GUI color inputs): stars ramp from
    // low to high acceleration, gas blends diffuse -> dense with local density.
    // Universe mode keeps the original deep blue -> orange-red ramp (galaxies
    // falling into clusters light up); galaxy modes ramp blue -> white.
    if (controller.starLowColor === undefined) {
        controller.starLowColor = isGalaxyMode ? '#0000ff' : '#0310fc';
    }
    if (controller.starHighColor === undefined) {
        controller.starHighColor = isGalaxyMode ? '#ffffff' : '#ff6030';
    }
    if (controller.gasDiffuseColor === undefined) controller.gasDiffuseColor = '#0000ff';
    if (controller.gasDenseColor === undefined) controller.gasDenseColor = '#ff8000';
}
