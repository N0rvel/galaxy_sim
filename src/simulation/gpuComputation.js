import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer';
import computeShaderPosition from '../shaders/computeShaderPosition.glsl?raw';
import computeShaderVelocity from '../shaders/computeShaderVelocity.glsl?raw';
import { HALO_RMAX_FACTOR, SIMULATION_TYPE } from '../config/constants.js';
import { buildHaloTexture } from '../physics/halo.js';
import { seedGalaxy, seedGalaxyCollision, seedUniverse } from '../physics/seed.js';

/**
 * GPGPU particle physics. Particle state lives in two WebGL textures of size
 * sqrt(N) x sqrt(N); each frame two compute passes run:
 *  - computeShaderVelocity.glsl: N-body gravity, updates velocities
 *  - computeShaderPosition.glsl: integrates positions (fixed 1/30 s timestep)
 */

/**
 * Create the GPGPU pipeline for the given controller: seed the initial
 * position/velocity textures and declare the velocity shader uniforms.
 *
 * @returns {{gpuCompute, positionVariable, velocityVariable, velocityUniforms, particleCount}}
 */
export function createComputation(renderer, controller, quality) {
    const textureSize = Math.round(Math.sqrt(controller.numberOfStars));
    const gpuCompute = new GPUComputationRenderer(textureSize, textureSize, renderer);
    if (renderer.capabilities.isWebGL2 === false) {
        gpuCompute.setDataType(THREE.HalfFloatType);
    }

    const dtPosition = gpuCompute.createTexture();
    const dtVelocity = gpuCompute.createTexture();

    const type = Number(controller.typeOfSimulation);
    if (type === SIMULATION_TYPE.GALAXY) {
        seedGalaxy(dtPosition, dtVelocity, controller);
    } else if (type === SIMULATION_TYPE.UNIVERSE) {
        seedUniverse(dtPosition, dtVelocity, controller, quality);
    } else if (type === SIMULATION_TYPE.GALAXY_COLLISION) {
        seedGalaxyCollision(dtPosition, dtVelocity, controller);
    }

    const velocityVariable = gpuCompute.addVariable('textureVelocity', computeShaderVelocity, dtVelocity);
    const positionVariable = gpuCompute.addVariable('texturePosition', computeShaderPosition, dtPosition);

    gpuCompute.setVariableDependencies(velocityVariable, [positionVariable, velocityVariable]);
    gpuCompute.setVariableDependencies(positionVariable, [positionVariable, velocityVariable]);

    const velocityUniforms = velocityVariable.material.uniforms;
    velocityUniforms['gravity'] = { value: 0.0 };
    velocityUniforms['interactionRate'] = { value: 0.0 };
    velocityUniforms['timeStep'] = { value: 0.0 };
    velocityUniforms['uMaxAccelerationColor'] = { value: 0.0 };
    velocityUniforms['blackHoleForce'] = { value: 0.0 };
    velocityUniforms['luminosity'] = { value: 0.0 };
    velocityUniforms['uSoftening'] = { value: 0.0 };
    velocityUniforms['uStickiness'] = { value: 0.0 };
    velocityUniforms['uStickyRadius'] = { value: 0.0 };
    velocityUniforms['uGasPressure'] = { value: 0.0 };
    velocityUniforms['uHaloGM'] = { value: 0.0 };
    velocityUniforms['uHaloCount'] = { value: 0.0 };
    // Set to 1.0 by the app when the two collision black holes get close
    // enough that their halos coalesce; reset by the next restart
    velocityUniforms['uHalosMerged'] = { value: 0.0 };
    velocityUniforms['uHaloRMax'] = { value: controller.radius * HALO_RMAX_FACTOR };
    velocityUniforms['uHaloProfile'] = { value: buildHaloTexture(controller.radius) };
    // Every mode runs the gas model now: galaxy modes flag gas clouds, the
    // universe flags intergalactic gas (same sticky physics at Mly scale)
    velocityUniforms['uGasMode'] = { value: 1.0 };
    // Universe mode caps the per-pair pull (particles are whole galaxies, a
    // close pair is a merger): the flat force out to ~sqrt(gravity) units is
    // what drives the clustering into groups and filaments. 0 disables it.
    velocityUniforms['uPairForceCap'] = { value: type === SIMULATION_TYPE.UNIVERSE ? 1.0 : 0.0 };

    const error = gpuCompute.init();
    if (error !== null) {
        console.error(error);
    }

    // Particle count captured at creation: the "Number of stars" slider changes
    // the controller immediately but only takes effect after a restart
    return { gpuCompute, positionVariable, velocityVariable, velocityUniforms, particleCount: controller.numberOfStars };
}

/**
 * Push the GUI-adjustable physics parameters into the velocity shader uniforms.
 */
export function syncDynamicUniforms(computation, controller) {
    const uniforms = computation.velocityUniforms;
    uniforms['gravity'].value = controller.gravity;
    uniforms['interactionRate'].value = controller.interactionRate;
    uniforms['timeStep'].value = controller.timeStep;
    uniforms['uMaxAccelerationColor'].value = controller.maxAccelerationColor;
    uniforms['blackHoleForce'].value = controller.blackHoleForce;
    uniforms['luminosity'].value = controller.luminosity;
    uniforms['uSoftening'].value = controller.softening;
    uniforms['uStickiness'].value = controller.stickiness;
    uniforms['uStickyRadius'].value = controller.stickyRadius;
    uniforms['uGasPressure'].value = controller.gasPressure;
    // One halo per galaxy: single galaxy mode has one at the origin, collision
    // mode one per moving black hole. Halo mass is a multiple of its own
    // galaxy's luminous (particle) mass, so each collision galaxy gets the
    // same halo/stars ratio as the single-galaxy scenario.
    const type = Number(controller.typeOfSimulation);
    const haloCount = type === SIMULATION_TYPE.GALAXY ? 1
        : type === SIMULATION_TYPE.GALAXY_COLLISION ? 2 : 0;
    uniforms['uHaloCount'].value = haloCount;
    uniforms['uHaloGM'].value = haloCount > 0
        ? controller.gravity * controller.haloMassFactor * computation.particleCount / haloCount
        : 0.0;
}

/**
 * Run the two compute passes with semi-implicit (symplectic) Euler coupling.
 *
 * gpuCompute.compute() would feed BOTH passes the previous frame's textures, so
 * the position pass would integrate with the OLD velocity (explicit Euler).
 * Explicit Euler injects energy every frame proportionally to the square of the
 * orbital frequency: the galaxy center (fastest orbits) empties into a ring
 * within one orbital period and the disk slowly evaporates. Feeding the
 * position pass the freshly computed velocity instead makes the integrator
 * symplectic and orbits stable.
 */
export function stepSemiImplicit(computation) {
    const { gpuCompute, positionVariable, velocityVariable } = computation;
    const cur = gpuCompute.currentTextureIndex;
    const nxt = cur === 0 ? 1 : 0;

    // Velocity pass: reads previous position and velocity
    const velUniforms = velocityVariable.material.uniforms;
    velUniforms['texturePosition'].value = positionVariable.renderTargets[cur].texture;
    velUniforms['textureVelocity'].value = velocityVariable.renderTargets[cur].texture;
    gpuCompute.doRenderTarget(velocityVariable.material, velocityVariable.renderTargets[nxt]);

    // Position pass: reads previous position but the NEW velocity
    const posUniforms = positionVariable.material.uniforms;
    posUniforms['texturePosition'].value = positionVariable.renderTargets[cur].texture;
    posUniforms['textureVelocity'].value = velocityVariable.renderTargets[nxt].texture;
    gpuCompute.doRenderTarget(positionVariable.material, positionVariable.renderTargets[nxt]);

    gpuCompute.currentTextureIndex = nxt;
}
