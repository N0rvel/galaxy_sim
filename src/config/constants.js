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
    [SIMULATION_TYPE.GALAXY_COLLISION]: 0.3
};

// Static dark matter halo (Einasto profile, applied as an analytic potential)
export const EINASTO_ALPHA = 0.17;
export const HALO_RS_FACTOR = 0.2;   // Einasto scale radius, as a fraction of the galaxy radius
export const HALO_RMAX_FACTOR = 6.0; // radius covered by the enclosed-mass lookup table
export const HALO_TABLE_SIZE = 256;
// Collision mode: once the two black holes come closer than this fraction of
// the galaxy radius, their halos coalesce into a single one (see app.js)
export const HALO_MERGE_RADIUS_FACTOR = 0.15;

// The velocity pass costs N x (N x rate^2) pair interactions. Issued as ONE
// draw call, extreme settings make that call take longer than the ~2 s the
// Windows driver watchdog (TDR) tolerates: every screen goes black while the
// driver resets and the browser loses its WebGL contexts. The pass is
// therefore split into scissored tiles spread over successive frames:
// physics slows down arbitrarily far under heavy settings but the page, the
// camera and the OS stay responsive.
//
// The tile size (in pair interactions per draw call) is a closed loop, not a
// constant: the app measures the real frame time and halves the budget when
// frames run long / regrows it when they are comfortable, so the camera and
// the UI settle at full frame rate on ANY GPU and the simulation alone
// absorbs the slowdown. The cap is ~the cost of the heaviest shipped preset
// ((99856 x 0.479)^2 ~ 2.3e9, interactive on the target GPUs) so a single
// draw call is never TDR-dangerous even before the loop converges.
export const CHUNK_PAIR_BUDGET_MAX = 2.5e9;
export const CHUNK_PAIR_BUDGET_MIN = 1e7;
// Smoothed-frame-time thresholds driving the loop (ms): shrink above HIGH,
// grow below LOW. Both sit ABOVE the 60 Hz vsync period (16.7 ms): under
// vsync a healthy frame reports ~16.7 ms however little GPU work it does,
// so a grow threshold below that dead-locks the budget at the floor.
export const CHUNK_FRAME_HIGH_MS = 21;
export const CHUNK_FRAME_LOW_MS = 17.5;


// The shaders integrate a fixed 1/30 s timestep per compute step, so stepping
// once per display frame would tie simulation speed to the monitor refresh
// rate (a 240 Hz screen runs 8x faster). Step the physics at a fixed
// wall-clock cadence instead. On displays slower than this cadence the
// simulation slows down rather than running several catch-up steps per frame:
// each step costs a full N-body compute pass, so catching up would only drop
// the frame rate further.
export const PHYSICS_INTERVAL_MS = 1000 / 60;
