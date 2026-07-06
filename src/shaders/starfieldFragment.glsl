varying vec3 vColor;
varying float vBrightness;

void main() {
    float r = length(gl_PointCoord - vec2(0.5)) * 2.0;
    float a = smoothstep(1.0, 0.0, r);
    a *= a;
    // Additive blending: brightness goes in rgb
    gl_FragColor = vec4(vColor * vBrightness * a, 1.0);
}
