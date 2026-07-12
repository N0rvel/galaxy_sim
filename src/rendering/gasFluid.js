import * as THREE from 'three';

/**
 * Fluid gas layer, modeled after OpenSPH's VolumeRenderer
 * (https://gitlab.com/sevecekp/sph gui/renderers/VolumeRenderer.cpp):
 *
 * Each gas particle is drawn as a volumetric splat whose radius is dilated
 * until it covers roughly a target number of neighbors (the neighbor count
 * comes from the sticky-gas physics pass, so no extra neighbor search is
 * needed). Sparse particles swell into large faint blobs that naturally fill
 * the empty regions; dense particles in the spiral arms stay small and sharp.
 * The splat profile follows the projected emission of a homogeneous sphere,
 * (1 - d^2)^2, so most of the light comes from the particle center, and the
 * total emission per particle is independent of the dilation - the light on
 * screen traces the real gas mass. All of this lives in the vertex/fragment
 * particle shaders under uRenderPass 2; this class just owns the HDR target
 * the gas-only pass renders into.
 *
 * The result is composited additively under the crisp star layer by the gas
 * composite pass in postprocessing.js (Reinhard tone mapping + exposure).
 */

const TARGET_OPTIONS = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false
};

export class GasFluid {
    constructor(width, height) {
        this.createTargets(width, height);
    }

    createTargets(width, height) {
        // Full resolution: the dense-gas kernels are only a few pixels wide
        // and are exactly the detail this renderer is meant to preserve
        this.target = new THREE.WebGLRenderTarget(Math.max(1, width), Math.max(1, height), TARGET_OPTIONS);
    }

    setSize(width, height) {
        this.disposeTargets();
        this.createTargets(width, height);
    }

    /** The rendered gas layer, ready to composite. */
    get texture() {
        return this.target.texture;
    }

    /**
     * Render the gas-only volumetric pass for this frame. The caller must
     * have hidden everything but the particle system; this method drives the
     * particle material's uRenderPass uniform for its own scene render.
     */
    update(renderer, scene, camera, particleUniforms) {
        const previousTarget = renderer.getRenderTarget();
        particleUniforms['uRenderPass'].value = 2.0;
        renderer.setRenderTarget(this.target);
        renderer.clear();
        renderer.render(scene, camera);
        renderer.setRenderTarget(previousTarget);
    }

    disposeTargets() {
        this.target.dispose();
    }

    dispose() {
        this.disposeTargets();
    }
}
