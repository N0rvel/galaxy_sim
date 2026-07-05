export default `

varying vec4 vColor;


void main()
{
    // Soft round sprite: radial falloff from the point center so particles
    // render as small glows instead of hard squares (additive blending)
    float d = length( gl_PointCoord - vec2( 0.5 ) ) * 2.0;
    float falloff = smoothstep( 1.0, 0.0, d );
    gl_FragColor = vec4( vColor.rgb * falloff, vColor.a );
}
`
