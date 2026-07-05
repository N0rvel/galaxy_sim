export default `
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

    // In galaxy modes the position w component flags gas particles
    bool isGas = uGasMode > 0.5 && hideDarkMatter > 0.5;

    vec4 mvPosition = modelViewMatrix * vec4( pos, 1.0 );

    /**
     * Size
     */
     // Perspective-correct world-space size, clamped to 1 pixel minimum
     // (matches the old fixed-size look). Gas clouds render slightly larger
     // than stars for a diffuse, nebular look.
     gl_PointSize = max( uParticleSize * ( isGas ? 1.5 : 1.0 ) * cameraConstant / ( - mvPosition.z ), 1.0 );

    // Calculate the final position of the particle using the projection matrix
    gl_Position = projectionMatrix * mvPosition;

    /**
    * Color
    */
    // Declare colors for low and high acceleration vec3(1.,0.843,0.388)
    vec3 hightAccelerationColor= vec3(1.,0.376,0.188);
    vec3 lowAccelerationColor= vec3(0.012,0.063,0.988);
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
            vec3 gasDiffuseColor = vec3(0.07, 0.05, 0.35);
            vec3 gasDenseColor = vec3(0.55, 0.35, 1.0);
            finalColor = mix(gasDiffuseColor, gasDenseColor, density)
                       * uGasBrightness * (0.3 + 1.7 * density);
        }
    } else if(uHideDarkMatter == 1.0) {
        if(hideDarkMatter == 0.0){
            // Interpolate color based on acceleration
            finalColor = mix(lowAccelerationColor, hightAccelerationColor, normalized(acc));
        } else {
            finalColor = vec3(0.0,0.0,0.0);
        }
    } else {
        finalColor = mix(lowAccelerationColor, hightAccelerationColor, normalized(acc));
    }


    // Set the color of the particle
    vColor = vec4(finalColor, uLuminosity);
}
`
