// For PI declaration:
#include <common>

// Declare uniforms for texture samplers
uniform sampler2D texturePosition;
uniform sampler2D textureVelocity;

// Declare uniforms for camera parameters and particle count
uniform float cameraConstant;
uniform float particlesCount;
// Declare constant for maximum acceleration that can be displayed
uniform float uMaxAccelerationColor;

// Declare uniform for luminosity
uniform float uLuminosity;
uniform float uHideDarkMatter;
// 1.0 in galaxy modes (position w flags gas), 0.0 in universe mode (position w flags dark matter)
uniform float uGasMode;
// World-space particle size; 0.0 falls back to 1-pixel points
uniform float uParticleSize;
// Gas rendering: overall gas glow strength and the neighbor count at which
// gas is considered "dense" (compressed in a spiral arm)
uniform float uGasBrightness;
uniform float uGasDensityScale;
// Layered rendering for the fluid gas pipeline: 0.0 renders every particle,
// 1.0 renders stars only, 2.0 renders gas only as OpenSPH-style volumetric
// splats (variable radius + constant per-particle emission, see below)
uniform float uRenderPass;
// Volumetric gas splats (after OpenSPH's VolumeRenderer): the splat radius
// spans [uGasFluidRadius, uGasFluidRadiusMax] with the local density -
// particles at or above uGasNeighborTarget neighbors sit on the min bound,
// isolated particles reach the max bound, in between the radius follows the
// equal-neighbor dilation curve (radius ~ neighbors^(-1/3)). Sparse gas
// fills the empty regions with large faint blobs while dense gas keeps
// small bright kernels.
uniform float uGasFluidRadius;
uniform float uGasFluidRadiusMax;
uniform float uGasNeighborTarget;
// Which particle kinds belong to the fluid layer (volumetric splats rendered
// in pass 2 and composited): the two toggles are independent, a kind that is
// not in the fluid layer renders normally in the main pass
uniform float uGasFluidOn;
uniform float uStarFluid;
// 1.0 in universe mode: star splats are sized by the packed acceleration
// (highest inside clusters) instead of the neighbor count, which is too
// sparse at the universe's low interaction rate to drive the dilation
uniform float uAccSplat;
// GUI-selectable colors: stars are a low->high acceleration ramp, gas blends
// from its diffuse to its dense color with the local density
uniform vec3 uStarLowColor;
uniform vec3 uStarHighColor;
uniform vec3 uGasDiffuseColor;
uniform vec3 uGasDenseColor;

// Declare varying variable for color
varying vec4 vColor;


// Normalize an acceleration value to a range of 0 to 1
float normalized(float acc){
    return (acc-0.)/(uMaxAccelerationColor-0.);
}

void main() {
    // Retrieve position data from texture
    vec4 posTemp = texture2D( texturePosition, uv );
    vec3 pos = posTemp.xyz;
    float hideDarkMatter = posTemp.w;

    // Retrieve velocity data from texture and calculate acceleration
    vec4 velTemp = texture2D( textureVelocity, uv );
    vec3 vel = velTemp.xyz;
    float acc = velTemp.w;

    // In galaxy modes the position w component flags gas particles (1.0)
    // and black holes (2.0, rendered like stars)
    bool isGas = uGasMode > 0.5 && hideDarkMatter > 0.5 && hideDarkMatter < 1.5;

    // Particles excluded from the current render pass are moved outside the
    // clip volume so they are culled before rasterization. The fluid layer
    // (pass 2) holds the gas and/or the stars depending on the two toggles;
    // universe-mode particles all count as stars.
    bool inFluidLayer = isGas ? uGasFluidOn > 0.5 : uStarFluid > 0.5;
    bool masked = uRenderPass > 1.5 ? !inFluidLayer : ( uRenderPass > 0.5 && inFluidLayer );
    if ( masked ) {
        gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
        gl_PointSize = 1.0;
        vColor = vec4( 0.0 );
        return;
    }

    vec4 mvPosition = modelViewMatrix * vec4( pos, 1.0 );

    /**
     * Size
     */
    // Perspective-correct world-space size, clamped to 1 pixel minimum
    // (matches the old fixed-size look). Gas clouds render slightly larger
    // than stars for a diffuse, nebular look.
    float pointSize = uParticleSize * ( isGas ? 1.5 : 1.0 ) * cameraConstant / ( - mvPosition.z );
    float splatRadius = 1.0;
    if ( uRenderPass > 1.5 ) {
        float t;
        if ( uAccSplat > 0.5 && !isGas ) {
            // Universe star (= galaxy) splats: normalized acceleration as the
            // density proxy - clustered galaxies stay small and sharp, void
            // galaxies swell into large faint blobs
            t = 1.0 - fract( acc ) / 0.99;
        } else {
            // Volumetric splat radius: the equal-neighbor dilation law
            // (radius ~ neighbors^(-1/3)) remapped onto the user's radius range.
            // dRaw is 1.0 at the neighbor target and peaks at dIso for a fully
            // isolated particle (neighbor floor 0.5); normalizing by dIso makes
            // both bounds attainable: dense clouds sit on uGasFluidRadius,
            // isolated ones reach uGasFluidRadiusMax.
            float neighbors = max( floor( acc ), 0.5 );
            float dRaw = pow( uGasNeighborTarget / neighbors, 1.0 / 3.0 );
            float dIso = pow( uGasNeighborTarget / 0.5, 1.0 / 3.0 );
            t = clamp( ( dRaw - 1.0 ) / max( dIso - 1.0, 1e-4 ), 0.0, 1.0 );
        }
        splatRadius = mix( uGasFluidRadius, uGasFluidRadiusMax, t );
        // Stars are more point-like than gas clouds: smaller radius
        pointSize = splatRadius * ( isGas ? 1.0 : 0.6 ) * cameraConstant / ( - mvPosition.z );
    }

    // Fill-rate guard: a splat close to the camera projects to a huge screen
    // disc, and with additive blending a handful of those cover the viewport
    // many times over - flying the camera into the fluid used to collapse the
    // frame rate.
    // - Galaxy modes: fade out (and finally cull) the clouds the camera has
    //   entered - a flat sprite cannot represent a volume seen from inside,
    //   and the smooth fade avoids popping.
    // - Universe mode (uAccSplat): hard-cull anything that would cover more
    //   than ~1/5 of the viewport height. Popping is acceptable there and the
    //   frame rate is not: this bounds the worst-case fill per splat instead
    //   of still rasterizing capped near-discs.
    float nearFade = 1.0;
    if ( uRenderPass > 1.5 ) {
        bool cull;
        if ( uAccSplat > 0.5 ) {
            cull = pointSize > 0.2 * cameraConstant;
        } else {
            nearFade = smoothstep( 0.5 * splatRadius, 1.5 * splatRadius, - mvPosition.z );
            cull = nearFade < 0.01;
        }
        if ( cull ) {
            gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
            gl_PointSize = 1.0;
            vColor = vec4( 0.0 );
            return;
        }
    }
    // Cap the screen footprint of the remaining nearby splats/sprites: the
    // per-pixel emission is unchanged, the cloud simply stops growing as it
    // approaches the camera
    pointSize = min( pointSize, 0.35 * cameraConstant );
    gl_PointSize = max( pointSize, 1.0 );

    // Flux conservation for sub-pixel particles (galaxy modes): a particle
    // smaller than the 1-pixel minimum is drawn at 1 pixel but dimmed by its
    // true area, so zooming out fades the image smoothly instead of stacking
    // thousands of clamped points into a solid white blob. Universe mode
    // (uAccSplat) keeps full alpha instead: its cluster kernels are sub-pixel
    // at the typical camera distance, and their stacked saturation is what
    // makes the collapsed structures glow.
    float subPixel = ( pointSize > 0.0 && uAccSplat < 0.5 ) ? clamp( pointSize * pointSize, 0.0, 1.0 ) : 1.0;

    // Calculate the final position of the particle using the projection matrix
    gl_Position = projectionMatrix * mvPosition;

    /**
    * Color
    */
    // Stars pack local density (integer part) and normalized acceleration
    // (fractional part) in vel.w; the raw-magnitude fallback only remains for
    // a hypothetical uGasMode 0
    float starRamp = uGasMode > 0.5 ? fract( acc ) / 0.99 : normalized( acc );
    vec3 finalColor = vec3(0.0,0.0,0.0);
    if(isGas) {
        // Gas particle: acc holds the local gas density (neighbor count).
        // Spiral density waves compress the gas in the arms, which in real
        // galaxies lights up as young blue stars and HII regions - so dense
        // gas glows bright violet while diffuse gas stays a faint deep blue.
        // (the hide toggle hides gas in galaxy modes)
        if(uHideDarkMatter == 1.0){
            finalColor = vec3(0.0,0.0,0.0);
        } else {
            float density = 1.0 - exp( -acc / uGasDensityScale );
            finalColor = mix(uGasDiffuseColor, uGasDenseColor, density)
                       * uGasBrightness * (0.3 + 1.7 * density);
        }
    } else if(uHideDarkMatter == 1.0) {
        if(hideDarkMatter == 0.0){
            // Interpolate color based on acceleration
            finalColor = mix(uStarLowColor, uStarHighColor, starRamp);
        } else {
            finalColor = vec3(0.0,0.0,0.0);
        }
    } else {
        finalColor = mix(uStarLowColor, uStarHighColor, starRamp);
    }


    // Set the color of the particle
    vColor = vec4(finalColor, uLuminosity * subPixel);

    // Volumetric splat: the per-pixel emission is the particle's column
    // density, constant total light / world-space cross-section. The total
    // light of a particle is thus independent of the size bounds AND of the
    // camera distance (surface brightness invariance): resizing the clouds
    // redistributes their light instead of dimming or blowing out the image.
    if ( uRenderPass > 1.5 ) {
        // Stars vastly outnumber the gas, so they emit less per particle to
        // keep the tone-mapped disk from saturating
        float emission = ( isGas ? 0.23 : 0.17 ) / ( splatRadius * splatRadius ) * subPixel * nearFade;
        vColor = vec4( finalColor * emission, 1.0 );
    }
}
