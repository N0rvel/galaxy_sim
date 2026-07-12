
uniform float uRenderPass;

varying vec4 vColor;


void main()
{
    float d = length( gl_PointCoord - vec2( 0.5 ) ) * 2.0;
    float falloff;
    if ( uRenderPass > 1.5 ) {
        // Volumetric gas splat (OpenSPH VolumeRenderer): the emission of a ray
        // through a homogeneous sphere goes with chord * cosPhi^3, which
        // projects to (1 - d^2)^2 on screen - most of the light comes from the
        // particle center, fading smoothly to zero at the edge
        float t = max( 1.0 - d * d, 0.0 );
        falloff = t * t;
    } else {
        // Soft round sprite: radial falloff from the point center so particles
        // render as small glows instead of hard squares (additive blending)
        falloff = smoothstep( 1.0, 0.0, d );
    }
    gl_FragColor = vec4( vColor.rgb * falloff, vColor.a );
}
