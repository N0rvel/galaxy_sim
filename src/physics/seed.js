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

    // Black hole: w = 2.0 flags it as blackHoleForce times heavier in the
    // compute shader; sitting exactly at the origin, the position shader
    // keeps it pinned there
    posArray[0] = 0;
    posArray[1] = 0;
    posArray[2] = 0;
    posArray[3] = 2;
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
 * tilted by 45 degrees. Each galaxy is built with the same generator and the
 * same parameters as the single-galaxy scenario, including its own central
 * black hole - flagged with w = 2.0 and placed slightly off the exact origin
 * so the position shader does not pin it (each galaxy must fall freely) -
 * and its own Einasto dark matter halo, which the compute shader anchors to
 * that black hole (particles 0 and 1) so the halos move with their galaxies.
 *
 * The two galaxies are interleaved in the particle textures (even index = A,
 * odd index = B): the compute shader only samples the first interactionRate
 * fraction of the texture as gravity sources, so a contiguous layout would
 * starve one galaxy of its own gravity at interactionRate < 1.
 */
export function seedGalaxyCollision(texturePosition, textureVelocity, controller) {
    const posArray = texturePosition.image.data;
    const velArray = textureVelocity.image.data;
    const count = posArray.length / 4;

    const countA = Math.ceil(count / 2);
    const countB = count - countA;
    const includeHalo = controller.haloMassFactor > 0;
    const galaxyA = makeDisk(countA - 1, controller.blackHoleForce, includeHalo, controller);
    const galaxyB = makeDisk(countB - 1, controller.blackHoleForce, includeHalo, controller);

    const angle = -Math.PI / 4;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const offsetB = [200, 200, 10];

    // Element j of a galaxy stream: j = 0 is the black hole at the galaxy
    // center, the rest is the disk (galaxy B tilted around x, then offset)
    const elementA = (j) => {
        if (j === 0) return { x: 0.01, y: 0.01, z: 0.01, vx: 0, vy: 0, vz: 0, w: 2 };
        const d = j - 1;
        return { x: galaxyA.x[d], y: galaxyA.y[d], z: galaxyA.z[d], vx: galaxyA.vx[d], vy: galaxyA.vy[d], vz: galaxyA.vz[d], w: galaxyA.gas[d] };
    };
    const elementB = (j) => {
        if (j === 0) return { x: offsetB[0], y: offsetB[1], z: offsetB[2], vx: 0, vy: 0, vz: 0, w: 2 };
        const d = j - 1;
        return {
            x: galaxyB.x[d] + offsetB[0],
            y: (galaxyB.y[d] * cosA - galaxyB.z[d] * sinA) + offsetB[1],
            z: (galaxyB.y[d] * sinA + galaxyB.z[d] * cosA) + offsetB[2],
            vx: galaxyB.vx[d],
            vy: galaxyB.vy[d] * cosA - galaxyB.vz[d] * sinA,
            vz: galaxyB.vy[d] * sinA + galaxyB.vz[d] * cosA,
            w: galaxyB.gas[d]
        };
    };

    let nextA = 0;
    let nextB = 0;
    for (let i = 0; i < count; i++) {
        const useA = nextB >= countB || (i % 2 === 0 && nextA < countA);
        const p = useA ? elementA(nextA++) : elementB(nextB++);

        const k = i * 4;
        posArray[k] = p.x;
        posArray[k + 1] = p.y;
        posArray[k + 2] = p.z;
        // w: 0 = star, 1 = gas (sticky particle model), 2 = black hole
        posArray[k + 3] = p.w;

        velArray[k] = p.vx;
        velArray[k + 1] = p.vy;
        velArray[k + 2] = p.vz;
        velArray[k + 3] = 0;
    }
}
