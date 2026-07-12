import { QUALITY, SIMULATION_TYPE } from './constants.js';

/**
 * Physical calibration of the simulation's internal units, used by the GUI to
 * display real astronomical values. The physics itself keeps running on the
 * raw internal values; only the GUI converts back and forth.
 *
 * The anchor is the experimental galaxy preset read as the Milky Way:
 *  - radius 100 world units = 15 kpc disk radius  ->  1 unit = 0.15 kpc
 *  - 100k particles = 5e10 Msun of stars          ->  1 particle = 5e5 Msun
 *  - preset gravity is Newton's constant           ->  gravity / preset = xG
 *
 * Feeding those into the shader force law (per-particle G*m = gravity,
 * accelerations scaled by timeStep * 30, positions integrated at 1/30 s per
 * step, 60 steps per wall-clock second) fixes the time scale: at the preset
 * timeStep of 0.001 one wall-clock second simulates ~60 Myr. Orbital speeds
 * scale with sqrt(acceleration), so the simulated speed goes with
 * sqrt(timeStep).
 */

// Galaxy modes: 1 world unit = 0.15 kpc
export const LY_PER_UNIT = 489.2;          // light-years per world unit
export const KLY_PER_UNIT = 0.4892;        // thousands of light-years per unit
export const PARTICLE_MASS_MSUN = 5e5;     // solar masses per particle at reference gravity
export const BH_MSUN6_PER_FORCE = PARTICLE_MASS_MSUN / 1e6; // blackHoleForce -> 10^6 Msun

// Simulated megayears per wall-clock second at the reference timeStep
const TIMESTEP_REF = 0.001;
const MYR_PER_SEC_AT_REF = 60;

// Universe mode: particles are whole galaxies, 1 world unit = 10 Mly
export const MLY_PER_UNIT = 10;

// Internal gravity value displayed (and written in the presets) as "1.0 x G",
// per simulation type and quality. These are calibration constants: changing
// one rescales what every gravity figure in the GUI and presets means.
const REFERENCE_GRAVITY = {
    [QUALITY.NORMAL]: {
        [SIMULATION_TYPE.GALAXY]: 20,
        [SIMULATION_TYPE.UNIVERSE]: 225,
        [SIMULATION_TYPE.GALAXY_COLLISION]: 40
    },
    [QUALITY.EXPERIMENTAL]: {
        [SIMULATION_TYPE.GALAXY]: 20,
        [SIMULATION_TYPE.UNIVERSE]: 20,
        [SIMULATION_TYPE.GALAXY_COLLISION]: 20
    }
};

// Internal timeStep displayed (and written in the presets) as speed "1.0 x"
// in universe mode (galaxy modes use absolute Myr/s instead)
const REFERENCE_TIMESTEP_UNIVERSE = 0.0001;

/**
 * Internal gravity for the given simulation type/quality that the GUI
 * displays as "1.0 x G" (real Newtonian gravity for the calibrated masses).
 */
export function referenceGravity(type, quality) {
    return REFERENCE_GRAVITY[quality][type];
}

/** Internal timeStep displayed as speed "1.0 x" (universe mode). */
export function referenceTimeStep() {
    return REFERENCE_TIMESTEP_UNIVERSE;
}

/** timeStep -> simulated Myr per wall-clock second (galaxy calibration). */
export function timeStepToMyrPerSec(timeStep) {
    return MYR_PER_SEC_AT_REF * Math.sqrt(Math.max(timeStep, 0) / TIMESTEP_REF);
}

/** Simulated Myr per wall-clock second -> timeStep. */
export function myrPerSecToTimeStep(myrPerSec) {
    const ratio = Math.max(myrPerSec, 0) / MYR_PER_SEC_AT_REF;
    return TIMESTEP_REF * ratio * ratio;
}

// Universe mode: simulated megayears per wall-clock second at the reference
// timeStep. Calibration constant: the structure-formation run (~90 s of wall
// clock at speed 1) is read as ~13 Gyr of cosmic time.
const MYR_PER_SEC_UNIVERSE_AT_REF = 150;

/** Universe timeStep -> simulated Myr per wall-clock second. */
export function universeTimeStepToMyrPerSec(timeStep) {
    return MYR_PER_SEC_UNIVERSE_AT_REF * timeStepToSpeedFactor(timeStep, REFERENCE_TIMESTEP_UNIVERSE);
}

/** timeStep -> speed multiplier relative to a reference timeStep (universe mode). */
export function timeStepToSpeedFactor(timeStep, refTimeStep) {
    return Math.sqrt(Math.max(timeStep, 0) / refTimeStep);
}

/** Speed multiplier -> timeStep (universe mode). */
export function speedFactorToTimeStep(factor, refTimeStep) {
    return refTimeStep * factor * factor;
}
