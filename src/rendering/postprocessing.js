import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { SavePass } from 'three/examples/jsm/postprocessing/SavePass';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
import { BlendShader } from 'three/examples/jsm/shaders/BlendShader';
import { CopyShader } from 'three/examples/jsm/shaders/CopyShader';

/**
 * Post-processing pipeline: RenderPass -> UnrealBloomPass -> BlendPass (motion
 * blur) -> SavePass -> CopyShader output.
 *
 * Motion blur works by blending the current frame with the previous frame's
 * saved render target. The motion blur passes are created once and shared
 * across simulation restarts.
 */

const renderTargetParameters = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    stencilBuffer: false
};

// Holds the previous frame for the motion blur blend
const savePass = new SavePass(
    new THREE.WebGLRenderTarget(
        window.innerWidth,
        window.innerHeight,
        renderTargetParameters
    )
);

// Blends the current frame with the saved previous frame
const blendPass = new ShaderPass(BlendShader, 'tDiffuse1');
blendPass.uniforms['tDiffuse2'].value = savePass.renderTarget.texture;
blendPass.uniforms['mixRatio'].value = 0.5;

// Copies the blended result to the screen
const outputPass = new ShaderPass(CopyShader);
outputPass.renderToScreen = true;

/**
 * Build the effect composer for a fresh scene/camera.
 *
 * @returns {{composer, bloomPass}}
 */
export function createComposer(renderer, scene, camera, bloomStrength) {
    const renderScene = new RenderPass(scene, camera);

    const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0,
        0,
        0
    );
    bloomPass.strength = bloomStrength;

    const composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);
    composer.addPass(blendPass);
    composer.addPass(savePass);
    composer.addPass(outputPass);
    return { composer, bloomPass };
}

/**
 * Attach or detach the motion blur passes depending on the GUI toggle.
 * Called every frame; when disabled the composer renders bloom directly
 * to the screen.
 */
export function updateMotionBlurPasses(composer, enabled) {
    composer.removePass(blendPass);
    composer.removePass(savePass);
    composer.removePass(outputPass);
    if (enabled) {
        composer.addPass(blendPass);
        composer.addPass(savePass);
        composer.addPass(outputPass);
    }
}
