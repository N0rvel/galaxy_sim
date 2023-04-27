export default `
// For PI declaration:
#include <common>

uniform float timeStep;
uniform float gravity;
uniform float interactionRate;
uniform float blackHoleForce;
uniform float uMaxAccelerationColor;


const float width = resolution.x;
const float height = resolution.y;


void main()	{

    // Calculate the ID and UV coordinate of the current pixel
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    float idParticle = uv.y * resolution.x + uv.x;

    // Sample the position and velocity of the current particle from the input textures
    vec4 tmpPos = texture2D( texturePosition, uv );
    vec3 pos = tmpPos.xyz;

    vec4 tmpVel = texture2D( textureVelocity, uv );
    vec3 vel = tmpVel.xyz;

    float accColor = tmpVel.w;

    // Initialize the acceleration to zero
    vec3 acceleration = vec3( 0.0 );

    // Calculate the acceleration due to gravity from all other particles
    for ( float y = 0.0; y < height * interactionRate; y++ ) {
        for ( float x = 0.0; x < width * interactionRate; x++ ) {
            // Calculate the UV coordinate of the other particle
            vec2 secondParticleCoords = vec2( x + 0.5, y  + 0.5) / resolution.xy;
            // Sample the position and velocity of the other particle
            vec3 pos2 = texture2D( texturePosition, secondParticleCoords ).xyz;
            vec4 velTemp2 = texture2D( textureVelocity, secondParticleCoords );
            vec3 vel2 = velTemp2.xyz;

            // Calculate the ID of the other particle
            float idParticle2 = secondParticleCoords.y * resolution.x + secondParticleCoords.x;

            // Skip the current particle
            if ( idParticle == idParticle2 ) {
                continue;
            }

            // Calculate the distance and displacement between the two particles
            vec3 dPos = pos2 - pos;
            float distance = length( dPos );

            // Calculate the acceleration due to gravity using Newton's law of universal gravitation
            float distanceSq = (distance * distance) + 1.0;
            float gravityField = gravity * 1.0 / distanceSq;

            // Limit the maximum acceleration due to gravity
            gravityField = min( gravityField, 1.0 );
            // Use a stronger force for the black hole
                        if(pos2.x == 0.0 && pos2.y == 0.0 && pos2.z == 0.0){
                            gravityField = gravity * blackHoleForce / distanceSq;
                        }
            // Add the acceleration to the total acceleration
            acceleration += gravityField * normalize( dPos );
        }
    }

    // Update the velocity based on the acceleration and elapsed time
    vel += timeStep * acceleration;

    // Store the acceleration in the fourth component of the output color
    accColor = length(acceleration);
    if (length(accColor) > uMaxAccelerationColor) {
      // If it does, set it to the maximum value
      accColor = normalize(accColor) * uMaxAccelerationColor;
    }

    // Output the velocity and acceleration in the output color
    gl_FragColor = vec4( vel, accColor );
}
`
