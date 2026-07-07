/**
 * Global constants shared across the simulation modules.
 */

// Simulation types (value of effectController.typeOfSimulation)
export const SIMULATION_TYPE = {
    GALAXY: 1,
    UNIVERSE: 2,
    GALAXY_COLLISION: 3
};

// Quality mode picked on the landing screen
export const QUALITY = {
    NORMAL: 1,       // small particle counts
    EXPERIMENTAL: 2  // full counts, needs GTX 1070+
};

// Bloom strength applied when switching to each simulation type
export const BLOOM_STRENGTH_BY_TYPE = {
    [SIMULATION_TYPE.GALAXY]: 0.6,
    [SIMULATION_TYPE.UNIVERSE]: 0.7,
    [SIMULATION_TYPE.GALAXY_COLLISION]: 1.0
};

// Static dark matter halo (Einasto profile, applied as an analytic potential)
export const EINASTO_ALPHA = 0.17;
export const HALO_RS_FACTOR = 0.2;   // Einasto scale radius, as a fraction of the galaxy radius
export const HALO_RMAX_FACTOR = 6.0; // radius covered by the enclosed-mass lookup table
export const HALO_TABLE_SIZE = 256;
// Collision mode: once the two black holes come closer than this fraction of
// the galaxy radius, their halos coalesce into a single one (see app.js)
export const HALO_MERGE_RADIUS_FACTOR = 0.15;

// The shaders integrate a fixed 1/30 s timestep per compute step, so stepping
// once per display frame would tie simulation speed to the monitor refresh
// rate (a 240 Hz screen runs 8x faster). Step the physics at a fixed
// wall-clock cadence instead. On displays slower than this cadence the
// simulation slows down rather than running several catch-up steps per frame:
// each step costs a full N-body compute pass, so catching up would only drop
// the frame rate further.
export const PHYSICS_INTERVAL_MS = 1000 / 60;
