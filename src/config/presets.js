import { QUALITY, SIMULATION_TYPE } from './constants.js';

/**
 * Simulation presets (the "effectController" objects).
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
    [QUALITY.NORMAL]: {
        [SIMULATION_TYPE.GALAXY]: {
            gravity: 20,
            interactionRate: 0.5,
            timeStep: 0.001,
            blackHoleForce: 100.0,
            luminosity: 1.0,
            maxAccelerationColor: 4.0,
            maxAccelerationColorPercent: 0.4,

            numberOfStars: 10000,
            radius: 50,
            height: 5,
            middleVelocity: 2,
            typeOfSimulation: SIMULATION_TYPE.GALAXY,
            autoRotation: false
        },
        [SIMULATION_TYPE.UNIVERSE]: {
            gravity: 225.0,
            interactionRate: 0.05,
            timeStep: 0.0001,
            blackHoleForce: 100.0,
            luminosity: 0.25,
            maxAccelerationColor: 2.0,
            maxAccelerationColorPercent: 20,

            numberOfStars: 100000,
            radius: 2,
            height: 5,
            middleVelocity: 2,
            typeOfSimulation: SIMULATION_TYPE.UNIVERSE,
            autoRotation: true
        },
        [SIMULATION_TYPE.GALAXY_COLLISION]: {
            gravity: 40,
            interactionRate: 0.5,
            timeStep: 0.001,
            blackHoleForce: 100.0,
            luminosity: 1.0,
            maxAccelerationColor: 15.0,
            maxAccelerationColorPercent: 1.5,

            numberOfStars: 10000,
            radius: 50,
            height: 5,
            middleVelocity: 2,
            typeOfSimulation: SIMULATION_TYPE.GALAXY_COLLISION,
            autoRotation: false
        }
    },
    [QUALITY.EXPERIMENTAL]: {
        // Tuned for stable spiral arms: ~100k particles, sticky gas,
        // moderate dark matter halo
        [SIMULATION_TYPE.GALAXY]: {
            gravity: 20,
            interactionRate: 0.479,
            timeStep: 0.001,
            blackHoleForce: 100.0,
            luminosity: 1.0,
            // Slider "Colors mix (%)" maps percent * 10 to this value in galaxy mode
            maxAccelerationColor: 1000.0,
            maxAccelerationColorPercent: 100,
            stickiness: 0.3,
            stickyRadius: 2.8,
            gasPressure: 5.0,
            gasFraction: 0.4,
            haloMassFactor: 3.0,

            numberOfStars: 99856, // 316^2
            radius: 100,
            height: 5,
            middleVelocity: 2,
            typeOfSimulation: SIMULATION_TYPE.GALAXY,
            autoRotation: false
        },
        [SIMULATION_TYPE.UNIVERSE]: {
            gravity: 20.0,
            interactionRate: 0.05,
            timeStep: 0.0001,
            blackHoleForce: 100.0,
            luminosity: 0.25,
            maxAccelerationColor: 2.0,
            maxAccelerationColorPercent: 20,

            numberOfStars: 1000000,
            radius: 2,
            height: 5,
            middleVelocity: 2,
            typeOfSimulation: SIMULATION_TYPE.UNIVERSE,
            autoRotation: true
        },
        [SIMULATION_TYPE.GALAXY_COLLISION]: {
            gravity: 20,
            interactionRate: 1.0,
            timeStep: 0.001,
            blackHoleForce: 100.0,
            luminosity: 1.0,
            maxAccelerationColor: 19.0,
            maxAccelerationColorPercent: 1.9,

            numberOfStars: 99856,
            radius: 100,
            height: 5,
            middleVelocity: 2,
            typeOfSimulation: SIMULATION_TYPE.GALAXY_COLLISION,
            autoRotation: false
        }
    }
};

/**
 * Fresh effectController object for the given simulation type and quality.
 */
export function createPreset(type, quality) {
    return {
        motionBlur: false,
        hideDarkMatter: false,
        ...PRESETS[quality][type]
    };
}

/**
 * Preset loaded before the landing screen choice: the experimental galaxy,
 * with a slightly lower gas fraction than the one used when switching
 * simulations later.
 */
export function createBootPreset() {
    return {
        ...createPreset(SIMULATION_TYPE.GALAXY, QUALITY.EXPERIMENTAL),
        gasFraction: 0.3
    };
}

/**
 * Fill in physics parameters that older presets do not define, so every
 * effectController object gets consistent defaults for the gas / softening /
 * halo model without repeating them in each preset literal.
 */
export function applyPhysicsDefaults(controller) {
    const isGalaxyMode = controller.typeOfSimulation === SIMULATION_TYPE.GALAXY
        || controller.typeOfSimulation === SIMULATION_TYPE.GALAXY_COLLISION;
    if (controller.gasFraction === undefined) controller.gasFraction = isGalaxyMode ? 0.3 : 0.0;
    if (controller.velocityDispersion === undefined) controller.velocityDispersion = 0.08;
    // Plummer softening length: particles are clouds with a physical size, not points.
    // Universe mode needs a larger value because it previously relied on a hard
    // per-pair acceleration cap that the softening replaces.
    if (controller.softening === undefined) controller.softening = isGalaxyMode ? controller.radius * 0.02 : 10.0;
    // Fraction of the compressive relative velocity removed per gas-gas collision
    if (controller.stickiness === undefined) controller.stickiness = 0.5;
    if (controller.stickyRadius === undefined) controller.stickyRadius = controller.radius * 0.04;
    // Short-range repulsion between gas clouds (interstellar pressure floor)
    if (controller.gasPressure === undefined) controller.gasPressure = 5.0;
    // The static halo is only valid for a single galaxy centered at the origin
    if (controller.haloMassFactor === undefined) controller.haloMassFactor = controller.typeOfSimulation === SIMULATION_TYPE.GALAXY ? 3.0 : 0.0;
    // World-space particle sprite size (0 = plain 1-pixel points, used in universe mode)
    if (controller.particleSize === undefined) controller.particleSize = isGalaxyMode ? 0.25 : 0.0;
    // Gas rendering: dense (compressed) gas glows bright violet to highlight the
    // spiral arms, mimicking the young blue stars / HII regions that trace arms
    // in real galaxies. gasDensityScale is the neighbor count treated as "dense";
    if (controller.gasBrightness === undefined) controller.gasBrightness = 1;
    if (controller.gasDensityScale === undefined) controller.gasDensityScale = 1;
}
