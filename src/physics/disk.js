import { EINASTO_ALPHA, HALO_RS_FACTOR } from '../config/constants.js';
import { einastoMassFraction } from './halo.js';
import { gaussianRandom } from './math.js';

/**
 * Generate a disk galaxy in the xz-plane centered at the origin.
 *
 * Positions follow an exponential surface density (realistic disk, no violent
 * central cusp). Initial velocities are set to the circular orbit speed
 * v = sqrt(a * R): the in-plane gravitational acceleration a is measured by
 * direct Monte-Carlo summation over a random subset of the disk itself, using
 * the exact force law of the compute shader (same Plummer softening, same
 * interactionRate subsampling), plus the analytic black hole and Einasto halo
 * terms. A small Gaussian dispersion is added so the disk starts close to a
 * relaxed, realistic state.
 *
 * @param count number of particles to generate
 * @param blackHoleMass central point mass in shader units (0 for none)
 * @param includeHalo whether the static Einasto halo contributes to the orbits
 * @param controller the effectController holding the physics parameters
 * @returns {{x, y, z, vx, vy, vz, gas}} typed arrays of length count
 */
export function makeDisk(count, blackHoleMass, includeHalo, controller) {
    const radius = controller.radius;
    const height = controller.height;
    const concentration = controller.middleVelocity;
    const gasFraction = controller.gasFraction;
    const dispersion = controller.velocityDispersion;
    const G = controller.gravity;
    const softeningSq = controller.softening * controller.softening;
    // The velocity shader adds timeStep * acceleration each frame while the position
    // shader integrates with a fixed 1/30 s step, so accelerations are effectively
    // scaled by timeStep / (1/30) when balancing circular orbits.
    const accelerationScale = controller.timeStep * 30.0;
    // When interactionRate < 1 both shader loop axes are truncated, so only
    // interactionRate^2 of the particle pairs actually contribute to gravity
    const sampledMassFraction = controller.interactionRate * controller.interactionRate;
    const haloGM = includeHalo ? G * controller.haloMassFactor * controller.numberOfStars : 0.0;
    const haloRs = radius * HALO_RS_FACTOR;
    // Exponential disk scale length; the "Central concentration" GUI value keeps
    // its meaning: higher values concentrate more mass in the center
    const scaleLength = radius / (2 * Math.max(concentration, 0.25));

    const x = new Float32Array(count);
    const y = new Float32Array(count);
    const z = new Float32Array(count);
    const vx = new Float32Array(count);
    const vy = new Float32Array(count);
    const vz = new Float32Array(count);
    const gas = new Uint8Array(count);

    for (let i = 0; i < count; i++) {
        // Rejection-sample the radius from Sigma(r) ~ exp(-r / scaleLength),
        // truncated at the disk radius (acceptance weight r * exp(-r/Rd), peak at r = Rd)
        let r;
        do {
            r = Math.random() * radius;
        } while (Math.random() > (r / scaleLength) * Math.exp(1 - r / scaleLength));
        const theta = Math.random() * 2 * Math.PI;

        gas[i] = Math.random() < gasFraction ? 1 : 0;
        x[i] = r * Math.cos(theta);
        z[i] = r * Math.sin(theta);
        // The gas disk is dynamically colder, hence thinner, than the stellar disk
        y[i] = (Math.random() * 2 - 1) * height * (gas[i] ? 0.3 : 1.0);
    }

    // Random subset of the disk used as gravity sources for the Monte-Carlo
    // acceleration measurement (each source represents count * rate^2 / sampleSize
    // shader particles of unit mass)
    const sampleSize = Math.min(1500, count);
    const sources = new Uint32Array(sampleSize);
    for (let s = 0; s < sampleSize; s++) {
        sources[s] = Math.floor(Math.random() * count);
    }
    const massPerSource = G * count * sampledMassFraction / sampleSize;

    for (let i = 0; i < count; i++) {
        const rCyl = Math.sqrt(x[i] * x[i] + z[i] * z[i]);
        const R = Math.sqrt(rCyl * rCyl + y[i] * y[i]);
        if (R < 1e-6 || rCyl < 1e-6) {
            continue;
        }

        // Direct summation over the source subset, mirroring the shader force law
        let ax = 0, ay = 0, az = 0;
        for (let s = 0; s < sampleSize; s++) {
            const j = sources[s];
            const dx = x[j] - x[i];
            const dy = y[j] - y[i];
            const dz = z[j] - z[i];
            const dSq = dx * dx + dy * dy + dz * dz + softeningSq;
            const inv = 1 / (dSq * Math.sqrt(dSq));
            ax += dx * inv;
            ay += dy * inv;
            az += dz * inv;
        }
        // Inward in-plane (radial) component of the disk acceleration
        let accel = -(ax * x[i] + az * z[i]) / rCyl * massPerSource;
        // Analytic central terms: black hole and static Einasto halo.
        // The black hole uses the same Plummer-softened law as the shader
        // (GM * R / (R^2 + s^2)^1.5), which vanishes at R = 0 instead of diverging.
        accel += G * blackHoleMass * R / Math.pow(R * R + softeningSq, 1.5);
        if (haloGM > 0) {
            accel += haloGM * einastoMassFraction(R, haloRs, EINASTO_ALPHA) / (R * R + softeningSq);
        }
        accel = Math.max(accel, 0);

        // Circular orbit speed: v = sqrt(a * R)
        const vCirc = Math.sqrt(accelerationScale * accel * rCyl);
        vx[i] = vCirc * z[i] / rCyl;
        vz[i] = -vCirc * x[i] / rCyl;

        // Small velocity dispersion so the disk reaches a realistic state quickly;
        // gas is colder than stars
        const sigma = vCirc * dispersion * (gas[i] ? 0.3 : 1.0);
        vx[i] += gaussianRandom() * sigma;
        vz[i] += gaussianRandom() * sigma;
        vy[i] = gaussianRandom() * sigma * 0.5;
    }

    return { x, y, z, vx, vy, vz, gas };
}
