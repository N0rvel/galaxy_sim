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
// Volumetric gas splats (after OpenSPH's VolumeRenderer): each particle
// dilates its radius to reach roughly uGasNeighborTarget neighbors, capped at
// uGasMaxDistention times the base radius uGasFluidRadius, so sparse gas
// fills the empty regions with large faint blobs while dense gas keeps small
// bright kernels
uniform float uGasFluidRadius;
uniform float uGasNeighborTarget;
uniform float uGasMaxDistention;
// Which particle kinds belong to the fluid layer (volumetric splats rendered
// in pass 2 and composited): the two toggles are independent, a kind that is
// not in the fluid layer renders normally in the main pass
uniform float uGasFluidOn;
uniform float uStarFluid;
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
    // (pass 2) holds the gas and/or the stars depending on the two toggles.
    bool inFluidLayer = uGasMode > 0.5 && ( isGas ? uGasFluidOn > 0.5 : uStarFluid > 0.5 );
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
    float distention = 1.0;
    if ( uRenderPass > 1.5 ) {
        // Volumetric gas splat: dilate the radius so every particle covers
        // roughly the same number of neighbors (neighbor count within a fixed
        // radius scales with density, so the equal-neighbor radius goes with
        // count^(-1/3)). Isolated gas swells up to uGasMaxDistention and fills
        // the voids, compressed gas in the arms stays small and sharp.
        float neighbors = max( floor( acc ), 0.5 );
        distention = clamp( pow( uGasNeighborTarget / neighbors, 1.0 / 3.0 ), 1.0, uGasMaxDistention );
        // Stars are more point-like than gas clouds: smaller base radius
        float baseRadius = uGasFluidRadius * ( isGas ? 1.0 : 0.6 );
        pointSize = baseRadius * distention * cameraConstant / ( - mvPosition.z );
    }
    gl_PointSize = max( pointSize, 1.0 );

    // Flux conservation for sub-pixel particles (galaxy modes): a particle
    // smaller than the 1-pixel minimum is drawn at 1 pixel but dimmed by its
    // true area, so zooming out fades the image smoothly instead of stacking
    // thousands of clamped points into a solid white blob
    float subPixel = uGasMode > 0.5 ? clamp( pointSize * pointSize, 0.0, 1.0 ) : 1.0;

    // Calculate the final position of the particle using the projection matrix
    gl_Position = projectionMatrix * mvPosition;

    /**
    * Color
    */
    // Galaxy-mode stars pack local density (integer part) and normalized
    // acceleration (fractional part) in vel.w; universe mode stores the raw
    // acceleration magnitude
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

    // Volumetric splat: per-pixel surface brightness independent of both the
    // camera distance and the dilation, matching OpenSPH's per-ray emission
    // (chord * cosPhi^3 / distention^3). A dilated particle is larger and
    // fainter at constant total light, and zooming out shrinks the image at
    // constant brightness instead of concentrating the whole galaxy's light
    // into a few saturated pixels.
    if ( uRenderPass > 1.5 ) {
        // Stars vastly outnumber the gas, so they emit less per particle to
        // keep the tone-mapped disk from saturating
        float emission = ( isGas ? 0.2 : 0.15 ) / ( distention * distention ) * subPixel;
        vColor = vec4( finalColor * emission, 1.0 );
    }
}
