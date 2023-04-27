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
     gl_PointSize = 1.0;
     // Scale point size based on the distance of the particle from the camera
     gl_PointSize *= ( 1.0 / - mvPosition.z );

    // Calculate the final position of the particle using the projection matrix
    gl_Position = projectionMatrix * mvPosition;

    /**
    * Color
    */
    // Declare colors for low and high acceleration vec3(1.,0.843,0.388)
    vec3 hightAccelerationColor= vec3(1.,0.376,0.188);
    vec3 lowAccelerationColor= vec3(0.012,0.063,0.988);
    vec3 finalColor = vec3(0.0,0.0,0.0);
    if(uHideDarkMatter == 1.0) {
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
