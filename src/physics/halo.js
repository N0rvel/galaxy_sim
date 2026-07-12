import * as THREE from 'three';
import { EINASTO_ALPHA, HALO_RMAX_FACTOR, HALO_RS_FACTOR, HALO_TABLE_SIZE } from '../config/constants.js';
import { lowerGammaRegularized } from './math.js';

/**
 * Static dark matter halo: Einasto density profile, applied in the compute
 * shader as an analytic central potential instead of simulated particles.
 */

/**
 * Fraction of the Einasto halo mass enclosed within radius r:
 * M(<r) / Mtot = P(3/alpha, (2/alpha) * (r/rs)^alpha)
 */
export function einastoMassFraction(r, rs, alpha) {
    if (r <= 0) return 0;
    return lowerGammaRegularized(3 / alpha, (2 / alpha) * Math.pow(r / rs, alpha));
}

/**
 * Precompute the Einasto enclosed-mass profile into a 256x1 float texture (red
 * channel) so the velocity compute shader can evaluate the halo with two texel
 * fetches. Float precision is required: the mass fraction near the center is
 * tiny, and quantization there would translate into huge force discontinuities
 * once multiplied by the halo GM.
 *
 * @param galaxyRadius the galaxy radius (effectController.radius)
 */
export function buildHaloTexture(galaxyRadius) {
    const rs = galaxyRadius * HALO_RS_FACTOR;
    const rMax = galaxyRadius * HALO_RMAX_FACTOR;
    const data = new Float32Array(HALO_TABLE_SIZE * 4);
    for (let i = 0; i < HALO_TABLE_SIZE; i++) {
        const r = rMax * i / (HALO_TABLE_SIZE - 1);
        data[i * 4] = einastoMassFraction(r, rs, EINASTO_ALPHA);
        data[i * 4 + 3] = 1.0;
    }
    const texture = new THREE.DataTexture(data, HALO_TABLE_SIZE, 1, THREE.RGBAFormat, THREE.FloatType);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    return texture;
}
