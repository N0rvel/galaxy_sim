// For PI declaration:
#include <common>

uniform float timeStep;
uniform float gravity;
uniform float interactionRate;
uniform float blackHoleForce;
uniform float uMaxAccelerationColor;
uniform float uSoftening;
uniform float uStickiness;
uniform float uStickyRadius;
uniform float uGasPressure;
uniform float uHaloGM;
uniform float uHaloRMax;
uniform float uGasMode;
uniform sampler2D uHaloProfile;


const float width = resolution.x;
const float height = resolution.y;
const float HALO_TABLE_SIZE = 256.0;

// Fraction of the dark matter halo mass enclosed within radius r.
// The Einasto profile is precomputed on the CPU into a 256x1 lookup texture
// (stored in the red channel), sampled here with manual linear interpolation.
float haloMassFraction( float r ) {
    float x = clamp( r / uHaloRMax, 0.0, 1.0 ) * ( HALO_TABLE_SIZE - 1.0 );
    float i0 = floor( x );
    float f = x - i0;
    float m0 = texture2D( uHaloProfile, vec2( ( i0 + 0.5 ) / HALO_TABLE_SIZE, 0.5 ) ).r;
    float m1 = texture2D( uHaloProfile, vec2( ( min( i0 + 1.0, HALO_TABLE_SIZE - 1.0 ) + 0.5 ) / HALO_TABLE_SIZE, 0.5 ) ).r;
    return mix( m0, m1, f );
}

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

    // In galaxy modes the position w component flags gas particles (sticky particle model);
    // in universe mode it flags dark matter and uGasMode is 0
    bool isGas = uGasMode > 0.5 && tmpPos.w > 0.5;

    // Initialize the acceleration to zero
    vec3 acceleration = vec3( 0.0 );

    // Sticky particle accumulators: summed inelastic collision impulses
    vec3 stickyImpulse = vec3( 0.0 );
    float collisionCount = 0.0;
    // Gas neighbors inside the collision radius: local density proxy used by the
    // render shader to make compressed gas (spiral arms) glow
    float neighborCount = 0.0;

    float softeningSq = uSoftening * uSoftening;
    float stickyRadiusSq = uStickyRadius * uStickyRadius;
    // Gas pressure acts below this separation, capping the gas density
    float coreRadius = uStickyRadius * 0.5;

    // Calculate the acceleration due to gravity from all other particles
    for ( float y = 0.0; y < height * interactionRate; y++ ) {
        for ( float x = 0.0; x < width * interactionRate; x++ ) {
            // Calculate the UV coordinate of the other particle
            vec2 secondParticleCoords = vec2( x + 0.5, y  + 0.5) / resolution.xy;
            // Sample the position of the other particle
            vec4 tmpPos2 = texture2D( texturePosition, secondParticleCoords );
            vec3 pos2 = tmpPos2.xyz;

            // Calculate the ID of the other particle
            float idParticle2 = secondParticleCoords.y * resolution.x + secondParticleCoords.x;

            // Skip the current particle
            if ( idParticle == idParticle2 ) {
                continue;
            }

            // Calculate the distance and displacement between the two particles
            vec3 dPos = pos2 - pos;
            float distanceSq = dot( dPos, dPos );

            // Plummer softening: each particle represents a cloud of physical size
            // uSoftening, so below that separation the force stops growing instead
            // of diverging to infinity
            float softenedSq = distanceSq + softeningSq + 0.0001;
            float invDist = inversesqrt( softenedSq );

            float massG = gravity;
            // Use a stronger force for the black hole (pinned at the origin)
            if ( pos2.x == 0.0 && pos2.y == 0.0 && pos2.z == 0.0 ) {
                massG = gravity * blackHoleForce;
            }

            // Add the acceleration to the total acceleration (dPos / d^3, softened)
            acceleration += massG * invDist * invDist * invDist * dPos;

            // Sticky particle model for gas-gas encounters inside the collision radius.
            // Only the approaching (compressive) component of the relative velocity is
            // damped, so orbital shear and rotation are preserved: the gas dissipates
            // into thin arms and filaments instead of collapsing into pointlike clumps.
            if ( isGas && tmpPos2.w > 0.5 && distanceSq < stickyRadiusSq && distanceSq > 0.0 ) {
                neighborCount += 1.0;
                float dist = sqrt( distanceSq );
                vec3 dir = dPos / dist;
                vec3 vel2 = texture2D( textureVelocity, secondParticleCoords ).xyz;
                float vRadial = dot( vel2 - vel, dir );
                if ( vRadial < 0.0 ) {
                    // Inelastic collision: each partner absorbs half the approach velocity
                    stickyImpulse += 0.5 * vRadial * dir;
                    collisionCount += 1.0;
                }
                // Short-range pressure: bounded repulsion that stops runaway clumping
                // and gives the gas a maximum density (no more glowing balls)
                if ( dist < coreRadius ) {
                    acceleration -= uGasPressure * ( 1.0 - dist / coreRadius ) * dir;
                }
            }
        }
    }

    // Static dark matter halo (Einasto profile) applied as an analytic central
    // potential instead of simulating dark matter particles
    float r = length( pos );
    if ( uHaloGM > 0.0 && r > 0.0 ) {
        acceleration -= uHaloGM * haloMassFraction( r ) / ( r * r + softeningSq ) * ( pos / r );
    }

    // Update the velocity based on the acceleration and elapsed time
    vel += timeStep * acceleration;

    // Apply the mean collision impulse (mean, not sum, so dense regions stay stable)
    if ( collisionCount > 0.0 ) {
        vel += uStickiness * stickyImpulse / collisionCount;
    }

    // Store the acceleration in the fourth component of the output color.
    // Gas particles store their local density (neighbor count) instead: the
    // render shader uses it to highlight compressed gas in the spiral arms.
    if ( isGas ) {
        accColor = neighborCount;
    } else {
        accColor = min( length( acceleration ), uMaxAccelerationColor );
    }

    // Output the velocity and acceleration in the output color
    gl_FragColor = vec4( vel, accColor );
}
