import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { SavePass } from 'three/examples/jsm/postprocessing/SavePass';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
import { BlendShader } from 'three/examples/jsm/shaders/BlendShader';
import { CopyShader } from 'three/examples/jsm/shaders/CopyShader';

/**
 * Post-processing pipeline: RenderPass -> ToneMapPass -> GasCompositePass ->
 * UnrealBloomPass -> BlendPass (motion blur) -> SavePass -> CopyShader output.
 *
 * The composer accumulates into a half-float (HDR) target: the additive star
 * blending can stack far above 1.0 without clipping per channel, and the tone
 * map pass then compresses the result into displayable range while preserving
 * hue (same Reinhard-on-luminance as the gas composite). Without this, a few
 * overlapping light-colored particles saturate all three channels to pure
 * white and the hue is lost.
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

// Tone maps the HDR star render (Reinhard on the luminance, hue-preserving):
// dense regions compress toward white smoothly instead of clipping channel by
// channel, so light star colors keep their tint in the core while raising the
// luminosity still brings out the dark end of the ramp
const ToneMapShader = {
    uniforms: {
        'tDiffuse': { value: null }
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }`,
    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        varying vec2 vUv;
        void main() {
            vec4 color = texture2D( tDiffuse, vUv );
            float lum = dot( color.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
            gl_FragColor = vec4( color.rgb / ( 1.0 + lum ), color.a );
        }`
};

// Additively composites the denoised fluid gas layer (see rendering/gasFluid.js)
// under the star render, before bloom so the gas glows too
const GasCompositeShader = {
    uniforms: {
        'tDiffuse': { value: null },
        'tGas': { value: null },
        'uIntensity': { value: 1.0 }
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }`,
    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform sampler2D tGas;
        uniform float uIntensity;
        varying vec2 vUv;
        void main() {
            // The gas layer is HDR (additive accumulation of thousands of
            // particles reaches values far above 1 in the core). Reinhard
            // tone mapping on the LUMINANCE compresses it into displayable
            // range while preserving the hue, so dense cores stay saturated
            // orange instead of blowing out to pure white. uIntensity acts
            // as exposure.
            vec3 gas = texture2D( tGas, vUv ).rgb * uIntensity;
            float lum = dot( gas, vec3( 0.2126, 0.7152, 0.0722 ) );
            gas *= 1.0 / ( 1.0 + lum );
            gl_FragColor = texture2D( tDiffuse, vUv ) + vec4( gas, 0.0 );
        }`
};

/**
 * Build the effect composer for a fresh scene/camera.
 *
 * @returns {{composer, bloomPass, gasCompositePass}}
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

    const toneMapPass = new ShaderPass(ToneMapShader);

    const gasCompositePass = new ShaderPass(GasCompositeShader);
    gasCompositePass.enabled = false;

    // Half-float target so the additive star accumulation keeps its dynamic
    // range until the tone map pass (the default composer target is 8-bit and
    // clips every channel at 1.0). Sized like the default composer target.
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const hdrTarget = new THREE.WebGLRenderTarget(size.width, size.height, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.HalfFloatType,
        stencilBuffer: false
    });

    const composer = new EffectComposer(renderer, hdrTarget);
    composer.addPass(renderScene);
    composer.addPass(toneMapPass);
    composer.addPass(gasCompositePass);
    composer.addPass(bloomPass);
    composer.addPass(blendPass);
    composer.addPass(savePass);
    composer.addPass(outputPass);
    return { composer, bloomPass, gasCompositePass };
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
