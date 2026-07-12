import * as THREE from 'three';
import backgroundVertex from '../shaders/backgroundVertex.glsl?raw';
import backgroundFragment from '../shaders/backgroundFragment.glsl?raw';
import starfieldVertex from '../shaders/starfieldVertex.glsl?raw';
import starfieldFragment from '../shaders/starfieldFragment.glsl?raw';

/**
 * Static space environment around the simulation
 *
 * Everything here is purely decorative and independent from the GPGPU
 * pipeline. All materials skip the depth buffer and render before the
 * simulation particles (negative renderOrder), so the additive particle
 * blending stacks on top.
 */

const STAR_COUNT = 10000;
const BACKGROUND_RADIUS = 400000;
const STARFIELD_RADIUS = 120000;

function createBackground() {
    const geometry = new THREE.SphereGeometry(BACKGROUND_RADIUS, 48, 32);
    const material = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        vertexShader: backgroundVertex,
        fragmentShader: backgroundFragment
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -3;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    return { mesh, geometry, material };
}

function createStarfield(uniforms) {
    const positions = new Float32Array(STAR_COUNT * 3);
    const colors = new Float32Array(STAR_COUNT * 3);
    const sizes = new Float32Array(STAR_COUNT);
    const twinkles = new Float32Array(STAR_COUNT * 2);

    for (let i = 0; i < STAR_COUNT; i++) {
        // Uniform direction on the sphere, radius jittered for parallax depth
        const z = Math.random() * 2 - 1;
        const theta = Math.random() * Math.PI * 2;
        const xy = Math.sqrt(1 - z * z);
        const r = STARFIELD_RADIUS * (0.6 + 0.4 * Math.random());
        positions[i * 3] = xy * Math.cos(theta) * r;
        positions[i * 3 + 1] = xy * Math.sin(theta) * r;
        positions[i * 3 + 2] = z * r;

        // Mostly small stars, a few prominent bright ones
        sizes[i] = 1.0 + Math.pow(Math.random(), 4) * 3.5;

        // White, with occasional cold blue or warm tints
        const tint = Math.random();
        let color;
        if (tint < 0.6) {
            color = [1.0, 1.0, 1.0];
        } else if (tint < 0.85) {
            color = [0.72, 0.82, 1.0];
        } else {
            color = [1.0, 0.90, 0.78];
        }
        const brightness = 0.4 + Math.random() * 0.6;
        colors[i * 3] = color[0] * brightness;
        colors[i * 3 + 1] = color[1] * brightness;
        colors[i * 3 + 2] = color[2] * brightness;

        twinkles[i * 2] = 0.3 + Math.random() * 1.5;
        twinkles[i * 2 + 1] = Math.random() * Math.PI * 2;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkles, 2));

    const material = new THREE.ShaderMaterial({
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        uniforms: uniforms,
        vertexShader: starfieldVertex,
        fragmentShader: starfieldFragment
    });

    const points = new THREE.Points(geometry, material);
    points.renderOrder = -2;
    points.frustumCulled = false;
    points.matrixAutoUpdate = false;
    return { points, geometry, material };
}

/**
 * Build the environment and add it to the scene.
 *
 * @returns {{update, dispose}} update(timeSeconds) animates twinkle/drift,
 *   dispose() removes everything from the scene and frees GPU resources.
 */
export function createEnvironment(scene, camera) {
    const starUniforms = {
        'uTime': { value: 0 },
        'uPixelRatio': { value: window.devicePixelRatio }
    };

    const background = createBackground();
    const starfield = createStarfield(starUniforms);

    scene.add(background.mesh);
    scene.add(starfield.points);

    return {
        update(timeSeconds) {
            starUniforms['uTime'].value = timeSeconds;
        },
        setVisible(visible) {
            background.mesh.visible = visible;
            starfield.points.visible = visible;
        },
        dispose() {
            scene.remove(background.mesh);
            scene.remove(starfield.points);
            background.geometry.dispose();
            background.material.dispose();
            starfield.geometry.dispose();
            starfield.material.dispose();
        }
    };
}
