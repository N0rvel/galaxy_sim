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

    vec4 mvPosition = modelViewMatrix * vec4( pos, 1.0 );

    /**
     * Size
     */
     // Perspective-correct world-space size; gas clouds are drawn bigger and softer
     // than stars. Clamped to 1 pixel minimum (matches the old fixed-size look).
     float worldSize = uParticleSize * (hideDarkMatter > 0.5 && uGasMode == 1.0 ? 1.8 : 1.0);
     gl_PointSize = max( worldSize * cameraConstant / ( - mvPosition.z ), 1.0 );

    // Calculate the final position of the particle using the projection matrix
    gl_Position = projectionMatrix * mvPosition;

    /**
    * Color
    */
    // Declare colors for low and high acceleration vec3(1.,0.843,0.388)
    vec3 hightAccelerationColor= vec3(1.,0.376,0.188);
    vec3 lowAccelerationColor= vec3(0.012,0.063,0.988);
    // Gas clouds are drawn colder / bluer than stars
    vec3 gasHighColor = vec3(0.85,0.95,1.0);
    vec3 gasLowColor = vec3(0.15,0.45,1.0);
    vec3 finalColor = vec3(0.0,0.0,0.0);
    if(uGasMode == 1.0 && hideDarkMatter == 1.0) {
        // Gas particle (the hide toggle hides gas in galaxy modes)
        if(uHideDarkMatter == 1.0){
            finalColor = vec3(0.0,0.0,0.0);
        } else {
            finalColor = mix(gasLowColor, gasHighColor, normalized(acc));
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
