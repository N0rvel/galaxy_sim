import * as THREE from 'three';
import fragmentShader from '../shaders/fragment.glsl?raw';
import vertexShader from '../shaders/vertex.glsl?raw';
import { SIMULATION_TYPE } from '../config/constants.js';

/**
 * The rendered particle system (THREE.Points).
 *
 * The vertex shader reads position/velocity from the GPGPU textures, not from
 * the `position` attribute: the geometry's position buffer is unused
 * placeholder data. The UV coordinates are used as particle IDs to sample the
 * textures.
 */

export function getCameraConstant(camera) {
    return window.innerHeight / (Math.tan(THREE.MathUtils.DEG2RAD * 0.5 * camera.fov) / camera.zoom);
}

/**
 * Create the particle geometry, shader material and render uniforms.
 *
 * @returns {{particles, geometry, material, uniforms}}
 */
export function createParticles(controller, camera) {
    const particleCount = controller.numberOfStars;
    const geometry = new THREE.BufferGeometry();

    // Placeholder positions (the real positions come from the GPGPU texture)
    const positions = new Float32Array(particleCount * 3);

    // UV coordinates identifying each particle in the GPGPU textures
    const uvs = new Float32Array(particleCount * 2);
    const matrixSize = Math.sqrt(particleCount);
    let p = 0;
    for (let j = 0; j < matrixSize; j++) {
        for (let i = 0; i < matrixSize; i++) {
            uvs[p++] = i / (matrixSize - 1);
            uvs[p++] = j / (matrixSize - 1);
        }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    const uniforms = {
        'texturePosition': { value: null },
        'textureVelocity': { value: null },
        'cameraConstant': { value: getCameraConstant(camera) },
        'particlesCount': { value: particleCount },
        'uMaxAccelerationColor': { value: controller.maxAccelerationColor },
        'uLuminosity': { value: controller.luminosity },
        'uHideDarkMatter': { value: controller.hideDarkMatter },
        'uGasMode': { value: controller.typeOfSimulation === SIMULATION_TYPE.UNIVERSE ? 0.0 : 1.0 },
        'uParticleSize': { value: controller.particleSize },
        'uGasBrightness': { value: controller.gasBrightness },
        'uGasDensityScale': { value: controller.gasDensityScale }
    };

    const material = new THREE.ShaderMaterial({
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
        uniforms: uniforms,
        vertexShader: vertexShader,
        fragmentShader: fragmentShader
    });

    const particles = new THREE.Points(geometry, material);
    particles.frustumCulled = false;
    particles.matrixAutoUpdate = false;
    particles.updateMatrix();

    return { particles, geometry, material, uniforms };
}
