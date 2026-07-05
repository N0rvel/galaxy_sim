import { QUALITY } from '../config/constants.js';
import { makeDisk } from './disk.js';

/**
 * Initial conditions: fill the GPGPU position/velocity textures for each
 * simulation type.
 *
 * Texture layout:
 *  - position: xyz = position, w = isDarkMatter (universe) or isGas (galaxy modes)
 *  - velocity: xyz = velocity, w = acceleration/density color channel
 */

/**
 * Single galaxy. The first particle is the black hole pinned at the origin;
 * the rest form a disk of stars and sticky gas clouds on near-circular orbits
 * (v = sqrt(a * R)). Dark matter is not simulated with particles: it enters
 * as a static Einasto potential in the compute shader.
 */
export function seedGalaxy(texturePosition, textureVelocity, controller) {
    const posArray = texturePosition.image.data;
    const velArray = textureVelocity.image.data;
    const count = posArray.length / 4;

    const disk = makeDisk(count - 1, controller.blackHoleForce, controller.haloMassFactor > 0, controller);

    // Black hole
    posArray[0] = 0;
    posArray[1] = 0;
    posArray[2] = 0;
    posArray[3] = 0;
    velArray[0] = 0;
    velArray[1] = 0;
    velArray[2] = 0;
    velArray[3] = 0;

    for (let i = 0; i < count - 1; i++) {
        const k = (i + 1) * 4;
        posArray[k] = disk.x[i];
        posArray[k + 1] = disk.y[i];
        posArray[k + 2] = disk.z[i];
        // w flags gas particles (sticky particle model)
        posArray[k + 3] = disk.gas[i];

        velArray[k] = disk.vx[i];
        velArray[k + 1] = disk.vy[i];
        velArray[k + 2] = disk.vz[i];
        velArray[k + 3] = 0;
    }
}

/**
 * Expanding universe: particles uniformly distributed in a sphere, with a
 * radial velocity proportional to the distance from the center (Hubble-like
 * expansion pulse).
 */
export function seedUniverse(texturePosition, textureVelocity, controller, quality) {
    const posArray = texturePosition.image.data;
    const velArray = textureVelocity.image.data;

    const radius = controller.radius;

    // Expansion pulse strength
    const pulseScale = quality === QUALITY.NORMAL ? 3.18 : 5;

    for (let k = 0, kl = posArray.length; k < kl; k += 4) {
        // Generate random point within a unit sphere
        let x, y, z;
        do {
            x = (Math.random() * 2 - 1);
            y = (Math.random() * 2 - 1);
            z = (Math.random() * 2 - 1);
        } while (x * x + y * y + z * z > 1);

        // Scale point to desired radius
        x *= radius;
        y *= radius;
        z *= radius;

        posArray[k + 0] = x;
        posArray[k + 1] = y;
        posArray[k + 2] = z;
        // Flag 85% of the particles as dark matter (hidden by the GUI toggle)
        if (k > 0.85 * (posArray.length / 4)) {
            posArray[k + 3] = 1;
        } else {
            posArray[k + 3] = 0;
        }

        velArray[k + 0] = pulseScale * x;
        velArray[k + 1] = pulseScale * y;
        velArray[k + 2] = pulseScale * z;
        velArray[k + 3] = 0;
    }
}

/**
 * Two disk galaxies on a collision course: one at the origin, one offset and
 * tilted by 45 degrees. Each disk gets self-consistent circular velocities from
 * its own enclosed mass (no black hole particle and no static halo here, since
 * the halo potential is pinned at the origin and the galaxies move).
 */
export function seedGalaxyCollision(texturePosition, textureVelocity, controller) {
    const posArray = texturePosition.image.data;
    const velArray = textureVelocity.image.data;
    const count = posArray.length / 4;

    const countA = Math.floor(count / 2);
    const countB = count - countA;
    const galaxyA = makeDisk(countA, 0, false, controller);
    const galaxyB = makeDisk(countB, 0, false, controller);

    const angle = -Math.PI / 4;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    for (let i = 0; i < count; i++) {
        const k = i * 4;
        let x, y, z, vx, vy, vz, gas;
        if (i < countA) {
            x = galaxyA.x[i];
            y = galaxyA.y[i];
            z = galaxyA.z[i];
            vx = galaxyA.vx[i];
            vy = galaxyA.vy[i];
            vz = galaxyA.vz[i];
            gas = galaxyA.gas[i];
        } else {
            const j = i - countA;
            // Tilt the second galaxy around the x-axis, then offset it
            x = galaxyB.x[j] + 200;
            y = (galaxyB.y[j] * cosA - galaxyB.z[j] * sinA) + 200;
            z = (galaxyB.y[j] * sinA + galaxyB.z[j] * cosA) + 10;
            vx = galaxyB.vx[j];
            vy = galaxyB.vy[j] * cosA - galaxyB.vz[j] * sinA;
            vz = galaxyB.vy[j] * sinA + galaxyB.vz[j] * cosA;
            gas = galaxyB.gas[j];
        }

        posArray[k] = x;
        posArray[k + 1] = y;
        posArray[k + 2] = z;
        // w flags gas particles (sticky particle model)
        posArray[k + 3] = gas;

        velArray[k] = vx;
        velArray[k + 1] = vy;
        velArray[k + 2] = vz;
        velArray[k + 3] = 0;
    }
}
