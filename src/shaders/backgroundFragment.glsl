varying vec3 vDir;

// Value noise + fbm with domain warping: wispy, filament-like dark clouds
// instead of blobby patches. Static on a background sphere.
float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i + vec3(0.0, 0.0, 0.0)), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
                   mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
               mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
                   mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}

float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p *= 2.03;
        a *= 0.5;
    }
    return v;
}

void main() {
    vec3 dir = normalize(vDir);
    vec3 p = dir * 2.6;

    // Domain warp: fbm fed with fbm gives stretched, wispy structure
    vec3 q = vec3(
        fbm(p),
        fbm(p + vec3(5.2, 1.3, 2.8)),
        fbm(p + vec3(1.7, 9.2, 3.5))
    );
    float n = fbm(p + 1.8 * q);

    // Near-black blue base
    vec3 color = vec3(0.003, 0.005, 0.010);

    // Faint desaturated blue-grey haze, only in the densest regions
    float clouds = smoothstep(0.40, 0.95, n);
    vec3 haze = mix(vec3(0.028, 0.042, 0.075), vec3(0.045, 0.040, 0.080), q.x);
    color += haze * clouds;

    // Slightly brighter filaments deep inside the clouds
    color += vec3(0.030, 0.050, 0.085) * pow(clouds, 3.0) * fbm(p * 3.0 + q);

    // Bright glowing cores: rare, small pockets deep inside the densest
    // clouds that flare white-blue (bloom picks them up)
    float coreNoise = fbm(p * 1.4 + q * 2.2);
    float cores = smoothstep(0.32, 0.82, coreNoise) * smoothstep(0.35, 0.80, n);
    vec3 coreColor = mix(vec3(0.075, 0.0, 0.20), vec3(1.0, 0.549, 0.0), cores);
    color += coreColor * cores * cores * 0.9;

    gl_FragColor = vec4(color, 1.0);
}
