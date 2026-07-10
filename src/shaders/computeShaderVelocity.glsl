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
// Number of dark matter halos: 1 in single-galaxy mode (centered on the
// pinned black hole), 2 in collision mode (each anchored to its galaxy's
// moving black hole, stored at particle indices 0 and 1)
uniform float uHaloCount;
// 1.0 once the two collision black holes have come close enough that their
// halos coalesce into a single halo of the combined mass (set from the CPU,
// which watches the black hole separation; sticky until the next restart)
uniform float uHalosMerged;
uniform float uGasMode;
// Universe mode: per-pair acceleration cap (0 disables it). Particles are
// whole galaxies, so a close pair is a merging group, not a Keplerian
// encounter; the capped (flat) short-range force drives the clustering.
uniform float uPairForceCap;
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

    // The position w component flags gas particles (1.0, sticky particle
    // model) and black holes (2.0). Universe-mode gas is the intergalactic
    // medium, galaxy-mode gas the interstellar clouds - same model.
    bool isGas = uGasMode > 0.5 && tmpPos.w > 0.5 && tmpPos.w < 1.5;

    // Initialize the acceleration to zero
    vec3 acceleration = vec3( 0.0 );

    // Halo anchors: in collision mode the black holes at particle indices
    // 0..uHaloCount-1 carry the moving analytic halos. They must feel the
    // reaction of their halo's pull on every particle (Newton's third law):
    // that back-reaction is the dynamical friction that lets colliding
    // galaxies shed orbital energy and merge instead of oscillating forever.
    // The single-galaxy anchor is pinned at the origin, so it is skipped.
    float pIndex = floor( gl_FragCoord.y ) * width + floor( gl_FragCoord.x );
    bool isHaloAnchor = uHaloGM > 0.0 && uHaloCount > 1.5 && tmpPos.w > 1.5 && pIndex < uHaloCount;
    vec3 haloReaction = vec3( 0.0 );

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
            // Black holes (position w = 2.0) are blackHoleForce times heavier
            // than a regular particle; they move freely, so each galaxy of a
            // collision carries its own
            if ( tmpPos2.w > 1.5 ) {
                massG = gravity * blackHoleForce;
            }

            // Add the acceleration to the total acceleration (dPos / d^3, softened)
            vec3 pairAcc = massG * invDist * invDist * invDist * dPos;
            if ( uPairForceCap > 0.0 ) {
                float mag = length( pairAcc );
                if ( mag > uPairForceCap ) pairAcc *= uPairForceCap / mag;
            }
            acceleration += pairAcc;

            // Reaction of this anchor's halo pulling on the other particle.
            // The halo center-of-mass acceleration is independent of the halo
            // mass (a = F / M_halo with F proportional to M_halo), so the per-source
            // term is just the pair force weighted by the enclosed-mass fraction.
            if ( isHaloAnchor ) {
                haloReaction += massG * haloMassFraction( sqrt( distanceSq ) ) * invDist * invDist * invDist * dPos;
            }

            // Sticky particle model for gas-gas encounters inside the collision radius.
            // Only the approaching (compressive) component of the relative velocity is
            // damped, so orbital shear and rotation are preserved: the gas dissipates
            // into thin arms and filaments instead of collapsing into pointlike clumps.
            if ( isGas && tmpPos2.w > 0.5 && tmpPos2.w < 1.5 && distanceSq < stickyRadiusSq && distanceSq > 0.0 ) {
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
            } else if ( uGasMode > 0.5 && !isGas && distanceSq < stickyRadiusSq && distanceSq > 0.0 ) {
                // Galaxy-mode stars: local density (neighbors of any kind),
                // used by the volumetric star rendering to size the splats
                neighborCount += 1.0;
            }
        }
    }

    // Dark matter halos (Einasto profile) applied as analytic potentials
    // instead of simulating dark matter particles. Each halo is anchored to
    // its galaxy's black hole, whose current position is read back from the
    // position texture, so the halos move with their galaxies in collisions.
    if ( uHaloGM > 0.0 ) {
        if ( uHalosMerged > 0.5 ) {
            // Merger remnant: a single halo of the combined mass, centered on
            // the black hole pair's barycenter, so the stars relax into one
            // clump instead of being re-captured by two separate wells
            vec3 c0 = texture2D( texturePosition, vec2( 0.5 / resolution.x, 0.5 / resolution.y ) ).xyz;
            vec3 c1 = texture2D( texturePosition, vec2( 1.5 / resolution.x, 0.5 / resolution.y ) ).xyz;
            vec3 dHalo = pos - 0.5 * ( c0 + c1 );
            float rHalo = length( dHalo );
            if ( rHalo > 0.0 ) {
                acceleration -= 2.0 * uHaloGM * haloMassFraction( rHalo ) / ( rHalo * rHalo + softeningSq ) * ( dHalo / rHalo );
            }
        } else {
            for ( int h = 0; h < 2; h++ ) {
                if ( float( h ) >= uHaloCount ) break;
                vec3 haloCenter = texture2D( texturePosition, vec2( ( float( h ) + 0.5 ) / resolution.x, 0.5 / resolution.y ) ).xyz;
                vec3 dHalo = pos - haloCenter;
                float rHalo = length( dHalo );
                if ( rHalo > 0.0 ) {
                    acceleration -= uHaloGM * haloMassFraction( rHalo ) / ( rHalo * rHalo + softeningSq ) * ( dHalo / rHalo );
                }
            }
        }
    }

    // The pair loop only samples interactionRate^2 of the particles as gravity
    // sources while the forward halo force applies to all of them: rescale the
    // sampled reaction so action and reaction match.
    if ( isHaloAnchor ) {
        acceleration += haloReaction / ( interactionRate * interactionRate );
    }

    // Update the velocity based on the acceleration and elapsed time
    vel += timeStep * acceleration;

    // Once the halos have merged, the black hole pair coalesces too: drag each
    // anchor's velocity toward the pair average (momentum-conserving) so the
    // binary decays into a single central object instead of orbiting inside
    // the merged remnant forever.
    if ( isHaloAnchor && uHalosMerged > 0.5 ) {
        vec2 otherUv = vec2( ( 1.0 - pIndex ) + 0.5, 0.5 ) / resolution.xy;
        vec3 velOther = texture2D( textureVelocity, otherUv ).xyz;
        vel = mix( vel, 0.5 * ( vel + velOther ), 0.1 );
    }

    // Apply the mean collision impulse (mean, not sum, so dense regions stay stable)
    if ( collisionCount > 0.0 ) {
        vel += uStickiness * stickyImpulse / collisionCount;
    }

    // Store the acceleration in the fourth component of the output color.
    // Gas particles store their local density (neighbor count) instead: the
    // render shader uses it to highlight compressed gas in the spiral arms.
    // Galaxy-mode stars pack both: local density in the integer part (sizes
    // the volumetric star splats) and the normalized acceleration in the
    // fractional part (drives the color ramp).
    if ( isGas ) {
        accColor = neighborCount;
    } else if ( uGasMode > 0.5 ) {
        float accNorm = clamp( length( acceleration ) / uMaxAccelerationColor, 0.0, 1.0 ) * 0.99;
        accColor = neighborCount + accNorm;
    } else {
        accColor = min( length( acceleration ), uMaxAccelerationColor );
    }

    // Output the velocity and acceleration in the output color
    gl_FragColor = vec4( vel, accColor );
}
