import galaxyVortexShader from '/src/shaders/vertex.glsl';
import galaxyFragmentShader from '/src/shaders/fragment.glsl';
import computeShaderVelocity from '/src/shaders/computeShaderVelocity.glsl';
import computeShaderPosition from '/src/shaders/computeShaderPosition.glsl';
import {GUI} from "dat.gui";
import * as THREE from "three";
import Stats from "three/examples/jsm/libs/stats.module";

import {OrbitControls} from "three/examples/jsm/controls/OrbitControls";
import {GPUComputationRenderer} from "three/examples/jsm/misc/GPUComputationRenderer";
import {EffectComposer} from "three/examples/jsm/postprocessing/EffectComposer";
import {UnrealBloomPass} from "three/examples/jsm/postprocessing/UnrealBloomPass";
import {RenderPass} from "three/examples/jsm/postprocessing/RenderPass";
import {ShaderPass} from "three/examples/jsm/postprocessing/ShaderPass";
import {BlendShader} from "three/examples/jsm/shaders/BlendShader";
import {SavePass} from "three/examples/jsm/postprocessing/SavePass";
import {CopyShader} from "three/examples/jsm/shaders/CopyShader";

let container, stats;
let camera, scene, renderer, geometry, composer;


let gpuCompute;
let velocityVariable;
let positionVariable;
let velocityUniforms;
let particleUniforms;
let effectController;
let particles;
let material;
let controls;
let luminosity;
let paused = false;
let autoRotation = true;
let bloom = { strength: 1.0};
let bloomPass;
// motion blur
let renderTargetParameters;
let savePass;
let blendPass;
/*--------------------------INITIALISATION-----------------------------------------------*/
const gravity = 20;
const interactionRate = 1.0;
const timeStep = 0.001;
const blackHoleForce = 100.0;
const constLuminosity = 1.0;
// Brute-force N^2 gravity on the GPU: ~100k particles (must stay a perfect square, 316^2)
const numberOfStars = 99856;
const radius = 100;
const height = 5;
const middleVelocity = 2;
const velocity = 15;
// Static dark matter halo (Einasto profile, applied as an analytic potential)
const EINASTO_ALPHA = 0.17;
const HALO_RS_FACTOR = 0.2;   // Einasto scale radius, as a fraction of the galaxy radius
const HALO_RMAX_FACTOR = 6.0; // radius covered by the enclosed-mass lookup table
const HALO_TABLE_SIZE = 256;
const typeOfSimulation = { "Galaxie": 1, "Univers": 2, "Collision de galaxies": 3 };
renderTargetParameters = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    stencilBuffer: false
};

// save pass
savePass = new SavePass(
    new THREE.WebGLRenderTarget(
        window.innerWidth,
        window.innerHeight,
        renderTargetParameters
    )
);

// blend pass
blendPass = new ShaderPass(BlendShader, "tDiffuse1");
blendPass.uniforms["tDiffuse2"].value = savePass.renderTarget.texture;
blendPass.uniforms["mixRatio"].value = 0.5;

// output pass
const outputPass = new ShaderPass(CopyShader);
outputPass.renderToScreen = true;

// Experimental-mode galaxy preset, tuned for stable spiral arms:
// ~100k particles, sticky gas, moderate dark matter halo
effectController = {
    // Can be changed dynamically
    gravity: gravity,
    interactionRate: 0.479,
    timeStep: timeStep,
    blackHoleForce: blackHoleForce,
    luminosity: constLuminosity,
    maxAccelerationColor: 50.0,
    maxAccelerationColorPercent: 5,
    motionBlur: false,
    hideDarkMatter: false,
    stickiness: 0.3,
    stickyRadius: 2.8,
    gasPressure: 5.0,
    gasFraction: 0.3,
    haloMassFactor: 3.0,

    // Must restart simulation
    numberOfStars: numberOfStars,
    radius: radius,
    height: height,
    middleVelocity: middleVelocity,
    velocity: velocity,
    typeOfSimulation: 1,
    autoRotation: false
};

let PARTICLES = effectController.numberOfStars;

// 1 = normal mode ; 2 = experimental mode
let selectedChoice = 1;
document.getElementById("choice1").addEventListener("click", () => selectChoice(1));
document.getElementById("choice2").addEventListener("click", () => selectChoice(2));
function selectChoice(choice) {
    selectedChoice = choice;
    document.getElementById("main-container").remove();
    if (selectedChoice === 1){
        effectController = {
            // Can be changed dynamically
            gravity: gravity,
            interactionRate: 0.5,
            timeStep: timeStep,
            blackHoleForce: blackHoleForce,
            luminosity: constLuminosity,
            maxAccelerationColor: 4.0,
            maxAccelerationColorPercent: 0.4,
            motionBlur: false,
            hideDarkMatter: false,

            // Must restart simulation
            numberOfStars: 10000,
            radius: 50,
            height: height,
            middleVelocity: middleVelocity,
            velocity: 7,
            typeOfSimulation: 1,
            autoRotation: false
        };
    }
    init(effectController.typeOfSimulation.toString());
    animate();
}


/*-------------------------------------------------------------------------*/

/**
 * Fill in physics parameters that older presets do not define, so every
 * effectController object gets consistent defaults for the gas / softening /
 * halo model without repeating them in each preset literal.
 */
function applyPhysicsDefaults(controller) {
    const isGalaxyMode = controller.typeOfSimulation === 1 || controller.typeOfSimulation === 3;
    if (controller.gasFraction === undefined) controller.gasFraction = isGalaxyMode ? 0.3 : 0.0;
    if (controller.velocityDispersion === undefined) controller.velocityDispersion = 0.08;
    // Plummer softening length: particles are clouds with a physical size, not points.
    // Universe mode needs a larger value because it previously relied on a hard
    // per-pair acceleration cap that the softening replaces.
    if (controller.softening === undefined) controller.softening = isGalaxyMode ? controller.radius * 0.02 : 10.0;
    // Fraction of the compressive relative velocity removed per gas-gas collision
    if (controller.stickiness === undefined) controller.stickiness = 0.5;
    if (controller.stickyRadius === undefined) controller.stickyRadius = controller.radius * 0.04;
    // Short-range repulsion between gas clouds (interstellar pressure floor)
    if (controller.gasPressure === undefined) controller.gasPressure = 5.0;
    // The static halo is only valid for a single galaxy centered at the origin
    if (controller.haloMassFactor === undefined) controller.haloMassFactor = controller.typeOfSimulation === 1 ? 3.0 : 0.0;
    // World-space particle sprite size (0 = plain 1-pixel points, used in universe mode)
    if (controller.particleSize === undefined) controller.particleSize = isGalaxyMode ? 0.25 : 0.0;
    // Gas rendering: dense (compressed) gas glows bright violet to highlight the
    // spiral arms, mimicking the young blue stars / HII regions that trace arms
    // in real galaxies. gasDensityScale is the neighbor count treated as "dense";
    // its default matches the expected mean neighbor count so the arm contrast
    // stays similar across particle counts and modes.
    if (controller.gasBrightness === undefined) controller.gasBrightness = 1.4;
    if (controller.gasDensityScale === undefined) {
        const meanNeighbors = 3.0 * controller.numberOfStars * controller.gasFraction
            * controller.interactionRate * controller.interactionRate
            * Math.pow(controller.stickyRadius / controller.radius, 2);
        controller.gasDensityScale = Math.max(2.0, meanNeighbors);
    }
}

/**
 * ln(Gamma(x)) via the Lanczos approximation.
 */
function lnGamma(x) {
    const coefficients = [
        76.18009172947146, -86.50532032941677, 24.01409824083091,
        -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5
    ];
    let y = x;
    let tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    let ser = 1.000000000190015;
    for (let j = 0; j < 6; j++) {
        ser += coefficients[j] / ++y;
    }
    return -tmp + Math.log(2.5066282746310005 * ser / x);
}

/**
 * Regularized lower incomplete gamma function P(s, x) = gamma(s, x) / Gamma(s).
 * Series expansion for x < s + 1, Lentz continued fraction otherwise.
 */
function lowerGammaRegularized(s, x) {
    if (x <= 0) return 0;
    const logPrefix = -x + s * Math.log(x) - lnGamma(s);
    if (x < s + 1) {
        let ap = s;
        let sum = 1 / s;
        let del = sum;
        for (let n = 0; n < 300; n++) {
            ap++;
            del *= x / ap;
            sum += del;
            if (Math.abs(del) < Math.abs(sum) * 1e-8) break;
        }
        return sum * Math.exp(logPrefix);
    }
    let b = x + 1 - s;
    let c = 1e300;
    let d = 1 / b;
    let h = d;
    for (let i = 1; i < 300; i++) {
        const an = -i * (i - s);
        b += 2;
        d = an * d + b;
        if (Math.abs(d) < 1e-300) d = 1e-300;
        c = b + an / c;
        if (Math.abs(c) < 1e-300) c = 1e-300;
        d = 1 / d;
        const delta = d * c;
        h *= delta;
        if (Math.abs(delta - 1) < 1e-8) break;
    }
    return 1 - Math.exp(logPrefix) * h;
}

/**
 * Fraction of the Einasto halo mass enclosed within radius r:
 * M(<r) / Mtot = P(3/alpha, (2/alpha) * (r/rs)^alpha)
 */
function einastoMassFraction(r, rs, alpha) {
    if (r <= 0) return 0;
    return lowerGammaRegularized(3 / alpha, (2 / alpha) * Math.pow(r / rs, alpha));
}

/**
 * Precompute the Einasto enclosed-mass profile into a 256x1 float texture (red
 * channel) so the velocity compute shader can evaluate the halo with two texel
 * fetches. Float precision is required: the mass fraction near the center is
 * tiny, and quantization there would translate into huge force discontinuities
 * once multiplied by the halo GM.
 */
function buildHaloTexture() {
    const rs = effectController.radius * HALO_RS_FACTOR;
    const rMax = effectController.radius * HALO_RMAX_FACTOR;
    const data = new Float32Array(HALO_TABLE_SIZE * 4);
    for (let i = 0; i < HALO_TABLE_SIZE; i++) {
        const r = rMax * i / (HALO_TABLE_SIZE - 1);
        data[i * 4] = einastoMassFraction(r, rs, EINASTO_ALPHA);
        data[i * 4 + 3] = 1.0;
    }
    const texture = new THREE.DataTexture(data, HALO_TABLE_SIZE, 1, THREE.RGBAFormat, THREE.FloatType);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    return texture;
}

/**
 * Standard normal random number (Box-Muller).
 */
function gaussianRandom() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Generate a disk galaxy in the xz-plane centered at the origin.
 *
 * Positions follow an exponential surface density (realistic disk, no violent
 * central cusp). Initial velocities are set to the circular orbit speed
 * v = sqrt(a * R): the in-plane gravitational acceleration a is measured by
 * direct Monte-Carlo summation over a random subset of the disk itself, using
 * the exact force law of the compute shader (same Plummer softening, same
 * interactionRate subsampling), plus the analytic black hole and Einasto halo
 * terms. A small Gaussian dispersion is added so the disk starts close to a
 * relaxed, realistic state.
 *
 * @param count number of particles to generate
 * @param blackHoleMass central point mass in shader units (0 for none)
 * @param includeHalo whether the static Einasto halo contributes to the orbits
 * @returns {{x, y, z, vx, vy, vz, gas}} typed arrays of length count
 */
function makeDisk(count, blackHoleMass, includeHalo) {
    const radius = effectController.radius;
    const height = effectController.height;
    const concentration = effectController.middleVelocity;
    const gasFraction = effectController.gasFraction;
    const dispersion = effectController.velocityDispersion;
    const G = effectController.gravity;
    const softeningSq = effectController.softening * effectController.softening;
    // The velocity shader adds timeStep * acceleration each frame while the position
    // shader integrates with a fixed 1/30 s step, so accelerations are effectively
    // scaled by timeStep / (1/30) when balancing circular orbits.
    const accelerationScale = effectController.timeStep * 30.0;
    // When interactionRate < 1 both shader loop axes are truncated, so only
    // interactionRate^2 of the particle pairs actually contribute to gravity
    const sampledMassFraction = effectController.interactionRate * effectController.interactionRate;
    const haloGM = includeHalo ? G * effectController.haloMassFactor * PARTICLES : 0.0;
    const haloRs = radius * HALO_RS_FACTOR;
    // Exponential disk scale length; the "Central concentration" GUI value keeps
    // its meaning: higher values concentrate more mass in the center
    const scaleLength = radius / (2 * Math.max(concentration, 0.25));

    const x = new Float32Array(count);
    const y = new Float32Array(count);
    const z = new Float32Array(count);
    const vx = new Float32Array(count);
    const vy = new Float32Array(count);
    const vz = new Float32Array(count);
    const gas = new Uint8Array(count);

    for (let i = 0; i < count; i++) {
        // Rejection-sample the radius from Sigma(r) ~ exp(-r / scaleLength),
        // truncated at the disk radius (acceptance weight r * exp(-r/Rd), peak at r = Rd)
        let r;
        do {
            r = Math.random() * radius;
        } while (Math.random() > (r / scaleLength) * Math.exp(1 - r / scaleLength));
        const theta = Math.random() * 2 * Math.PI;

        gas[i] = Math.random() < gasFraction ? 1 : 0;
        x[i] = r * Math.cos(theta);
        z[i] = r * Math.sin(theta);
        // The gas disk is dynamically colder, hence thinner, than the stellar disk
        y[i] = (Math.random() * 2 - 1) * height * (gas[i] ? 0.3 : 1.0);
    }

    // Random subset of the disk used as gravity sources for the Monte-Carlo
    // acceleration measurement (each source represents count * rate^2 / sampleSize
    // shader particles of unit mass)
    const sampleSize = Math.min(1500, count);
    const sources = new Uint32Array(sampleSize);
    for (let s = 0; s < sampleSize; s++) {
        sources[s] = Math.floor(Math.random() * count);
    }
    const massPerSource = G * count * sampledMassFraction / sampleSize;

    for (let i = 0; i < count; i++) {
        const rCyl = Math.sqrt(x[i] * x[i] + z[i] * z[i]);
        const R = Math.sqrt(rCyl * rCyl + y[i] * y[i]);
        if (R < 1e-6 || rCyl < 1e-6) {
            continue;
        }

        // Direct summation over the source subset, mirroring the shader force law
        let ax = 0, ay = 0, az = 0;
        for (let s = 0; s < sampleSize; s++) {
            const j = sources[s];
            const dx = x[j] - x[i];
            const dy = y[j] - y[i];
            const dz = z[j] - z[i];
            const dSq = dx * dx + dy * dy + dz * dz + softeningSq;
            const inv = 1 / (dSq * Math.sqrt(dSq));
            ax += dx * inv;
            ay += dy * inv;
            az += dz * inv;
        }
        // Inward in-plane (radial) component of the disk acceleration
        let accel = -(ax * x[i] + az * z[i]) / rCyl * massPerSource;
        // Analytic central terms: black hole and static Einasto halo.
        // The black hole uses the same Plummer-softened law as the shader
        // (GM * R / (R^2 + s^2)^1.5), which vanishes at R = 0 instead of diverging.
        accel += G * blackHoleMass * R / Math.pow(R * R + softeningSq, 1.5);
        if (haloGM > 0) {
            accel += haloGM * einastoMassFraction(R, haloRs, EINASTO_ALPHA) / (R * R + softeningSq);
        }
        accel = Math.max(accel, 0);

        // Circular orbit speed: v = sqrt(a * R)
        const vCirc = Math.sqrt(accelerationScale * accel * rCyl);
        vx[i] = vCirc * z[i] / rCyl;
        vz[i] = -vCirc * x[i] / rCyl;

        // Small velocity dispersion so the disk reaches a realistic state quickly;
        // gas is colder than stars
        const sigma = vCirc * dispersion * (gas[i] ? 0.3 : 1.0);
        vx[i] += gaussianRandom() * sigma;
        vz[i] += gaussianRandom() * sigma;
        vy[i] = gaussianRandom() * sigma * 0.5;
    }

    return { x, y, z, vx, vy, vz, gas };
}

/**
 *
 * @param typeOfSimulation
 */
function init(typeOfSimulation) {

    applyPhysicsDefaults(effectController);


    container = document.createElement( 'div' );
    document.body.appendChild( container );

    camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.01, 9999999999999999999 );
    camera.position.x = 15
    camera.position.y = 112;
    camera.position.z = 168;

    if (effectController.typeOfSimulation === 3){
        camera.position.x = 15
        camera.position.y = 456;
        camera.position.z = 504;
    }

    if (selectedChoice === 1 && effectController.typeOfSimulation === 2){
        camera.position.x = 15
        camera.position.y = 456;
        camera.position.z = 504;
    }


    scene = new THREE.Scene();

    renderer = new THREE.WebGLRenderer();
    renderer.setPixelRatio( window.devicePixelRatio );
    renderer.setSize( window.innerWidth, window.innerHeight );
    container.appendChild( renderer.domElement );

    controls = new OrbitControls( camera, renderer.domElement );
    if (effectController.typeOfSimulation === 1 || effectController.typeOfSimulation === 3) {
        controls.autoRotate = false;
    } else if (effectController.typeOfSimulation === 2){
        controls.autoRotate = true;
        controls.autoRotateSpeed = -1.0;
    }

    initComputeRenderer(typeOfSimulation);

    // Show fps, ping, etc
    stats = new Stats();
    container.appendChild( stats.dom );

    window.addEventListener( 'resize', onWindowResize );

    initGUI();
    initParticles(typeOfSimulation);
    dynamicValuesChanger();
    const renderScene = new RenderPass( scene, camera );

    /* ---- Adding bloom effect ---- */
    bloomPass = new UnrealBloomPass(
        new THREE.Vector2( window.innerWidth, window.innerHeight ),
        0,
        0,
        0
    );
    bloomPass.strength = bloom.strength;

    composer = new EffectComposer( renderer );
    composer.addPass( renderScene );
    composer.addPass( bloomPass );
    composer.addPass(blendPass);
    composer.addPass(savePass);
    composer.addPass(outputPass);
}

function initComputeRenderer(typeOfSimulation) {
    let textureSize = Math.round(Math.sqrt(effectController.numberOfStars));
    gpuCompute = new GPUComputationRenderer( textureSize, textureSize, renderer );
    if ( renderer.capabilities.isWebGL2 === false ) {
        gpuCompute.setDataType( THREE.HalfFloatType );
    }

    const dtPosition = gpuCompute.createTexture();
    const dtVelocity = gpuCompute.createTexture();

    if (typeOfSimulation === "1"){
        fillTextures( dtPosition, dtVelocity );
    } else if (typeOfSimulation === "2"){
        fillUniverseTextures( dtPosition, dtVelocity )
    }  else if (typeOfSimulation === "3"){
        fillGalaxiesCollisionTextures( dtPosition, dtVelocity )
    }

    velocityVariable = gpuCompute.addVariable( 'textureVelocity', computeShaderVelocity, dtVelocity );
    positionVariable = gpuCompute.addVariable( 'texturePosition', computeShaderPosition, dtPosition );

    gpuCompute.setVariableDependencies( velocityVariable, [ positionVariable, velocityVariable ] );
    gpuCompute.setVariableDependencies( positionVariable, [ positionVariable, velocityVariable ] );

    velocityUniforms = velocityVariable.material.uniforms;
    velocityUniforms[ 'gravity' ] = { value: 0.0 };
    velocityUniforms[ 'interactionRate' ] = { value: 0.0 };
    velocityUniforms[ 'timeStep' ] = { value: 0.0 };
    velocityUniforms[ 'uMaxAccelerationColor' ] = { value: 0.0 };
    velocityUniforms[ 'blackHoleForce' ] = { value: 0.0 };
    velocityUniforms[ 'luminosity' ] = { value: 0.0 };
    velocityUniforms[ 'uSoftening' ] = { value: 0.0 };
    velocityUniforms[ 'uStickiness' ] = { value: 0.0 };
    velocityUniforms[ 'uStickyRadius' ] = { value: 0.0 };
    velocityUniforms[ 'uGasPressure' ] = { value: 0.0 };
    velocityUniforms[ 'uHaloGM' ] = { value: 0.0 };
    velocityUniforms[ 'uHaloRMax' ] = { value: effectController.radius * HALO_RMAX_FACTOR };
    velocityUniforms[ 'uHaloProfile' ] = { value: buildHaloTexture() };
    velocityUniforms[ 'uGasMode' ] = { value: effectController.typeOfSimulation === 2 ? 0.0 : 1.0 };

    const error = gpuCompute.init();

    if ( error !== null ) {
        console.error( error );
    }
}

/**
 * Init particles (material, positions, uvs coordinates)
 * @param typeOfSimulation
 */
function initParticles(typeOfSimulation) {

    // Create a buffer geometry to store the particle data
    geometry = new THREE.BufferGeometry();

    // Create array to store the position of the particles
    const positions = new Float32Array( PARTICLES * 3 );

    // Create an array to store the UV coordinates of each particle
    const uvs = new Float32Array( PARTICLES * 2 );

    // Calculate the size of the matrix based on the number of particles
    let matrixSize = Math.sqrt(effectController.numberOfStars);
    let p = 0;
    for ( let j = 0; j < matrixSize; j ++ ) {
        for ( let i = 0; i < matrixSize; i ++ ) {
            uvs[ p ++ ] = i / ( matrixSize - 1 );
            uvs[ p ++ ] = j / ( matrixSize - 1 );
        }
    }

    geometry.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
    geometry.setAttribute( 'uv', new THREE.BufferAttribute( uvs, 2 ) );

    particleUniforms = {
        'texturePosition': { value: null },
        'textureVelocity': { value: null },
        'cameraConstant': { value: getCameraConstant( camera ) },
        'particlesCount': { value: PARTICLES },
        'uMaxAccelerationColor': { value: effectController.maxAccelerationColor },
        'uLuminosity' : { value: luminosity},
        'uHideDarkMatter' : { value: effectController.hideDarkMatter},
        'uGasMode' : { value: effectController.typeOfSimulation === 2 ? 0.0 : 1.0},
        'uParticleSize' : { value: effectController.particleSize},
        'uGasBrightness' : { value: effectController.gasBrightness},
        'uGasDensityScale' : { value: effectController.gasDensityScale},
    };

    // THREE.ShaderMaterial
    // Create the material of the particles
    material = new THREE.ShaderMaterial( {
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
        uniforms: particleUniforms,
        vertexShader:  galaxyVortexShader,
        fragmentShader:  galaxyFragmentShader
    });
    if (typeOfSimulation === "2"){
        material = new THREE.ShaderMaterial( {
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            vertexColors: true,
            uniforms: particleUniforms,
            vertexShader:  galaxyVortexShader,
            fragmentShader:  galaxyFragmentShader
        });
    }

    particles = new THREE.Points( geometry, material );
    particles.frustumCulled = false;
    particles.matrixAutoUpdate = false;
    particles.updateMatrix();
    scene.add( particles );
}

/**
 * Init positions et volocities for all particles.
 * The first particle is the black hole pinned at the origin; the rest form a disk
 * of stars and sticky gas clouds on near-circular orbits (v = sqrt(a * R)).
 * Dark matter is not simulated with particles: it enters as a static Einasto
 * potential in the compute shader.
 * @param texturePosition array that contain positions of particles
 * @param textureVelocity array that contain velocities of particles
 */
function fillTextures( texturePosition, textureVelocity ) {

    const posArray = texturePosition.image.data;
    const velArray = textureVelocity.image.data;
    const count = posArray.length / 4;

    const disk = makeDisk(count - 1, effectController.blackHoleForce, effectController.haloMassFactor > 0);

    // Black hole
    posArray[0] = 0;
    posArray[1] = 0;
    posArray[2] = 0;
    posArray[3] = 0;
    velArray[0] = 0;
    velArray[1] = 0;
    velArray[2] = 0;
    velArray[3] = 0;

    for ( let i = 0; i < count - 1; i++ ) {
        const k = (i + 1) * 4;
        posArray[ k ] = disk.x[i];
        posArray[ k + 1 ] = disk.y[i];
        posArray[ k + 2 ] = disk.z[i];
        // w flags gas particles (sticky particle model)
        posArray[ k + 3 ] = disk.gas[i];

        velArray[ k ] = disk.vx[i];
        velArray[ k + 1 ] = disk.vy[i];
        velArray[ k + 2 ] = disk.vz[i];
        velArray[ k + 3 ] = 0;
    }
}

/**
 * Init positions et volocities for all particles
 * @param texturePosition array that contain positions of particles
 * @param textureVelocity array that contain velocities of particles
 */
function fillUniverseTextures( texturePosition, textureVelocity ) {

    const posArray = texturePosition.image.data;
    const velArray = textureVelocity.image.data;

    // Set the radius of the sphere
    const radius = effectController.radius;

    // Set the pulse strength
    let pulseScale = 5;
    if (selectedChoice === 1){
        pulseScale = 3.18;
    }

    for ( let k = 0, kl = posArray.length; k < kl; k += 4 ) {
        // Generate random point within a unit sphere
        let x, y, z;
        do {
            x = ( Math.random() * 2 - 1 );
            y = ( Math.random() * 2 - 1 );
            z = ( Math.random() * 2 - 1 );
        } while ( x*x + y*y + z*z > 1 );

        // Scale point to desired radius
        x *= radius;
        y *= radius;
        z *= radius;

        // Velocity
        const vx = pulseScale * x;
        const vy = pulseScale * y;
        const vz = pulseScale * z;

        // Fill in texture values
        posArray[ k + 0 ] = x;
        posArray[ k + 1 ] = y;
        posArray[ k + 2 ] = z;
        // Hide dark matter (hide 85% of stars)
        if (k > 0.85 * (posArray.length / 4)){
            posArray[ k + 3 ] = 1;
        } else {
            posArray[ k + 3 ] = 0;
        }

        velArray[ k + 0 ] = vx;
        velArray[ k + 1 ] = vy;
        velArray[ k + 2 ] = vz;
        velArray[ k + 3 ] = 0;
    }
}

/**
 * Two disk galaxies on a collision course: one at the origin, one offset and
 * tilted by 45 degrees. Each disk gets self-consistent circular velocities from
 * its own enclosed mass (no black hole particle and no static halo here, since
 * the halo potential is pinned at the origin and the galaxies move).
 * @param texturePosition array that contain positions of particles
 * @param textureVelocity array that contain velocities of particles
 */
function fillGalaxiesCollisionTextures( texturePosition, textureVelocity ){
    const posArray = texturePosition.image.data;
    const velArray = textureVelocity.image.data;
    const count = posArray.length / 4;

    const countA = Math.floor(count / 2);
    const countB = count - countA;
    const galaxyA = makeDisk(countA, 0, false);
    const galaxyB = makeDisk(countB, 0, false);

    const angle = -Math.PI / 4;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    for ( let i = 0; i < count; i++ ) {
        const k = i * 4;
        let x, y, z, vx, vy, vz, gas;
        if (i < countA) {
            x = galaxyA.x[i];
            y = galaxyA.y[i];
            z = galaxyA.z[i];
            vx = galaxyA.vx[i];
            vy = galaxyA.vy[i];
            vz = galaxyA.vz[i];
            gas = galaxyA.gas[i];
        } else {
            const j = i - countA;
            // Tilt the second galaxy around the x-axis, then offset it
            x = galaxyB.x[j] + 200;
            y = (galaxyB.y[j] * cosA - galaxyB.z[j] * sinA) + 200;
            z = (galaxyB.y[j] * sinA + galaxyB.z[j] * cosA) + 10;
            vx = galaxyB.vx[j];
            vy = galaxyB.vy[j] * cosA - galaxyB.vz[j] * sinA;
            vz = galaxyB.vy[j] * sinA + galaxyB.vz[j] * cosA;
            gas = galaxyB.gas[j];
        }

        posArray[ k ] = x;
        posArray[ k + 1 ] = y;
        posArray[ k + 2 ] = z;
        // w flags gas particles (sticky particle model)
        posArray[ k + 3 ] = gas;

        velArray[ k ] = vx;
        velArray[ k + 1 ] = vy;
        velArray[ k + 2 ] = vz;
        velArray[ k + 3 ] = 0;
    }
}

/**
 * Restart the simulation
 */
function restartSimulation() {
    paused = false;
    scene.remove(particles);
    material.dispose();
    geometry.dispose();
    document.getElementsByClassName('dg ac').item(0).removeChild(document.getElementsByClassName('dg main a').item(0));

    document.body.removeChild(document.querySelector('canvas').parentNode);

    PARTICLES = effectController.numberOfStars;

    init(effectController.typeOfSimulation.toString());
}

function resetParameters(){
    switchSimulation();
}

/**
 * manage the resize of the windows to keep the scene centered
 */
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize( window.innerWidth, window.innerHeight );
    particleUniforms[ 'cameraConstant' ].value = getCameraConstant( camera );
}

function dynamicValuesChanger() {
    velocityUniforms[ 'gravity' ].value = effectController.gravity;
    velocityUniforms[ 'interactionRate' ].value = effectController.interactionRate;
    velocityUniforms[ 'timeStep' ].value = effectController.timeStep;
    velocityUniforms[ 'uMaxAccelerationColor' ].value = effectController.maxAccelerationColor;
    velocityUniforms[ 'blackHoleForce' ].value = effectController.blackHoleForce;
    velocityUniforms[ 'luminosity' ].value = effectController.luminosity;
    velocityUniforms[ 'uSoftening' ].value = effectController.softening;
    velocityUniforms[ 'uStickiness' ].value = effectController.stickiness;
    velocityUniforms[ 'uStickyRadius' ].value = effectController.stickyRadius;
    velocityUniforms[ 'uGasPressure' ].value = effectController.gasPressure;
    // Halo mass is expressed as a multiple of the total luminous (particle) mass
    velocityUniforms[ 'uHaloGM' ].value = effectController.gravity * effectController.haloMassFactor * PARTICLES;
}

/**
 * Init the menu
 */
function initGUI() {

    const gui = new GUI( { width: 350 } );

    const folder1 = gui.addFolder( 'Dynamic Parameters' );

    const folderGraphicSettings = gui.addFolder( 'Graphics settings' );

    const folder2 = gui.addFolder( 'Static parameters (need to restart the simulation)' );

    folder1.add( effectController, 'gravity', 0.0, 1000.0, 0.05 ).onChange( dynamicValuesChanger ).name("Gravitational force");
    folder1.add( effectController, 'interactionRate', 0.0, 1.0, 0.001 ).onChange( dynamicValuesChanger ).name("Interaction rate (%)");
    folder1.add( effectController, 'timeStep', 0.0, 0.01, 0.0001 ).onChange( dynamicValuesChanger ).name("Time step");
    folder1.add( effectController, 'softening', 0.0, 20.0, 0.05 ).onChange( dynamicValuesChanger ).name("Gravity softening (Plummer)");
    folder1.add( effectController, 'hideDarkMatter', 0, 1, 1 ).onChange( function ( value ) {
        effectController.hideDarkMatter =  value ;
    }   ).name(effectController.typeOfSimulation === 2 ? "Hide dark matter" : "Hide gas");
    folderGraphicSettings.add( effectController, 'particleSize', 0.0, 2.0, 0.01 ).name("Particle size");
    folderGraphicSettings.add( bloom, 'strength', 0.0, 2.0, 0.1 ).onChange(  function ( value ) {
        bloom.strength =  value ;
        bloomPass.strength = bloom.strength;
    }  ).name("Bloom");
    folderGraphicSettings.add( effectController, 'motionBlur', 0, 1, 1 ).onChange( function ( value ) {
        effectController.motionBlur =  value ;
    }   ).name("Motion blur");
    if (effectController.typeOfSimulation === 1 || effectController.typeOfSimulation === 3){
        folder1.add( effectController, 'blackHoleForce', 0.0, 10000.0, 1.0 ).onChange( dynamicValuesChanger ).name("Black hole mass");
        folder1.add( effectController, 'stickiness', 0.0, 1.0, 0.01 ).onChange( dynamicValuesChanger ).name("Gas stickiness");
        folder1.add( effectController, 'stickyRadius', 0.0, 20.0, 0.1 ).onChange( dynamicValuesChanger ).name("Gas collision radius");
        folder1.add( effectController, 'gasPressure', 0.0, 30.0, 0.1 ).onChange( dynamicValuesChanger ).name("Gas pressure");
        if (effectController.typeOfSimulation === 1){
            folder1.add( effectController, 'haloMassFactor', 0.0, 10.0, 0.1 ).onChange( dynamicValuesChanger ).name("Dark matter halo mass (x stars)");
        }
        folderGraphicSettings.add( effectController, 'gasBrightness', 0.0, 4.0, 0.05 ).name("Gas glow (arms)");
        folderGraphicSettings.add( effectController, 'gasDensityScale', 1.0, 100.0, 0.5 ).name("Gas glow threshold");
        folderGraphicSettings.add( effectController, 'maxAccelerationColorPercent', 0.01, 100, 0.01 ).onChange(  function ( value ) {
            effectController.maxAccelerationColor = value * 10;
            dynamicValuesChanger();
        }  ).name("Colors mix (%)");
        folder2.add( effectController, 'numberOfStars', 2.0, 1000000.0, 1.0 ).name("Number of stars");
        folder2.add( effectController, 'radius', 1.0, 1000.0, 1.0 ).name("Galaxy diameter");
        folder2.add( effectController, 'height', 0.0, 50.0, 0.01 ).name("Galaxy height");
        folder2.add( effectController, 'middleVelocity', 0.0, 20.0, 0.001 ).name("Central concentration");
        folder2.add( effectController, 'gasFraction', 0.0, 1.0, 0.01 ).name("Gas fraction");
        folder2.add( effectController, 'velocityDispersion', 0.0, 0.5, 0.005 ).name("Initial velocity dispersion");
    } else if (effectController.typeOfSimulation === 2){
        folderGraphicSettings.add( effectController, 'luminosity', 0.0, 1.0, 0.0001 ).onChange( dynamicValuesChanger ).name("Luminosity");
        folderGraphicSettings.add( effectController, 'maxAccelerationColorPercent', 0.01, 100, 0.01 ).onChange(  function ( value ) {
            effectController.maxAccelerationColor = value / 10;
            dynamicValuesChanger();
        }  ).name("Colors mix (%)");
        folder2.add( effectController, 'numberOfStars', 2.0, 10000000.0, 1.0 ).name("Number of galaxies");
        folder2.add( effectController, 'radius', 1.0, 1000.0, 1.0 ).name("Initial diameter of the universe");
        folder2.add( effectController, 'autoRotation').name('Auto-rotation').listen().onChange(function(){setChecked()});
    }


    const buttonRestart = {
        restartSimulation: function () {
            restartSimulation();
        }
    };

    const buttonReset = {
        resetParameters: function () {
            resetParameters();
        }
    };
    const buttonPause = {
        pauseSimulation: function () {
        }
    };


    function setChecked(){
        autoRotation = !autoRotation;
        controls.autoRotate = autoRotation;
    }

    folder2.add( effectController, 'typeOfSimulation', typeOfSimulation ).onChange(switchSimulation).name("Type of simulation");
    folder2.add( buttonRestart, 'restartSimulation' ).name("Restart the simulation");
    folder2.add( buttonReset, 'resetParameters' ).name("Reset parameters");
    let buttonPauseController = folder2.add( buttonPause, 'pauseSimulation' ).name("Pause");
    buttonPauseController.onChange(function(){
        paused = !paused;
        if(paused){
            buttonPauseController.name("Resume");
        }else{
            buttonPauseController.name("Pause");
        }
        buttonPauseController.updateDisplay();
    });

    folder1.open();
    folder2.open();
    folderGraphicSettings.open();
}

function getCameraConstant( camera ) {
    return window.innerHeight / ( Math.tan( THREE.MathUtils.DEG2RAD * 0.5 * camera.fov ) / camera.zoom );
}

/**
 * Switch the current simulation
 */
function switchSimulation(){
    paused = false;
    // Normal mode (small configuration)
    if (selectedChoice === 1){
        switch (effectController.typeOfSimulation.toString()) {
            // Single galaxy
            case "1":
                scene.remove(particles);
                bloom.strength = 1.0;
                effectController = {
                    // Can be changed dynamically
                    gravity: gravity,
                    interactionRate: 0.5,
                    timeStep: timeStep,
                    blackHoleForce: blackHoleForce,
                    luminosity: constLuminosity,
                    maxAccelerationColor: 4.0,
                    maxAccelerationColorPercent: 0.4,
                    motionBlur: false,
                    hideDarkMatter: false,

                    // Must restart simulation
                    numberOfStars: 10000,
                    radius: 50,
                    height: height,
                    middleVelocity: middleVelocity,
                    velocity: 7,
                    typeOfSimulation: 1,
                    autoRotation: false
                };
                material.dispose();
                geometry.dispose();
                document.getElementsByClassName('dg ac').item(0).removeChild(document.getElementsByClassName('dg main a').item(0));

                document.body.removeChild(document.querySelector('canvas').parentNode);

                PARTICLES = effectController.numberOfStars;

                init(effectController.typeOfSimulation.toString());
                break;
            // Universe
            case "2":
                scene.remove(particles);
                bloom.strength = 0.7;
                effectController = {
                    // Can be changed dynamically
                    gravity: 225.0,
                    interactionRate: 0.05,
                    timeStep: 0.0001,
                    blackHoleForce: 100.0,
                    luminosity: 0.25,
                    maxAccelerationColor: 2.0,
                    maxAccelerationColorPercent: 20,
                    motionBlur: false,
                    hideDarkMatter: false,

                    // Must restart simulation
                    numberOfStars: 100000,
                    radius: 2,
                    height: 5,
                    middleVelocity: 2,
                    velocity: 15,
                    typeOfSimulation: 2,
                    autoRotation: true
                };
                material.dispose();
                geometry.dispose();
                document.getElementsByClassName('dg ac').item(0).removeChild(document.getElementsByClassName('dg main a').item(0));

                document.body.removeChild(document.querySelector('canvas').parentNode);

                PARTICLES = effectController.numberOfStars;

                init(effectController.typeOfSimulation.toString());
                break;
            // Galaxies collision
            case "3":
                scene.remove(particles);
                bloom.strength = 1.0;
                effectController = {
                    // Can be changed dynamically
                    gravity: 40,
                    interactionRate: 0.5,
                    timeStep: timeStep,
                    blackHoleForce: blackHoleForce,
                    luminosity: constLuminosity,
                    maxAccelerationColor: 15.0,
                    maxAccelerationColorPercent: 1.5,
                    motionBlur: false,
                    hideDarkMatter: false,

                    // Must restart simulation
                    numberOfStars: 10000,
                    radius: 50,
                    height: height,
                    middleVelocity: middleVelocity,
                    velocity: 7,
                    typeOfSimulation: 3,
                    autoRotation: false
                };
                material.dispose();
                geometry.dispose();
                document.getElementsByClassName('dg ac').item(0).removeChild(document.getElementsByClassName('dg main a').item(0));

                document.body.removeChild(document.querySelector('canvas').parentNode);

                PARTICLES = effectController.numberOfStars;

                init(effectController.typeOfSimulation.toString());
                break;
            default:
                break;
        }
    } else {
        switch (effectController.typeOfSimulation.toString()) {
            // Single galaxy
            case "1":
                scene.remove(particles);
                bloom.strength = 1.0;
                effectController = {
                    // Can be changed dynamically
                    gravity: gravity,
                    interactionRate: 0.479,
                    timeStep: timeStep,
                    blackHoleForce: blackHoleForce,
                    luminosity: constLuminosity,
                    maxAccelerationColor: 50.0,
                    maxAccelerationColorPercent: 5.0,
                    motionBlur: false,
                    hideDarkMatter: false,
                    stickiness: 0.3,
                    stickyRadius: 2.8,
                    gasPressure: 5.0,
                    gasFraction: 0.4,
                    haloMassFactor: 3.0,

                    // Must restart simulation
                    numberOfStars: numberOfStars,
                    radius: radius,
                    height: height,
                    middleVelocity: middleVelocity,
                    velocity: velocity,
                    typeOfSimulation: 1,
                    autoRotation: false
                };
                material.dispose();
                geometry.dispose();
                document.getElementsByClassName('dg ac').item(0).removeChild(document.getElementsByClassName('dg main a').item(0));

                document.body.removeChild(document.querySelector('canvas').parentNode);

                PARTICLES = effectController.numberOfStars;

                init(effectController.typeOfSimulation.toString());
                break;
            // Universe
            case "2":
                scene.remove(particles);
                bloom.strength = 0.7;
                effectController = {
                    // Can be changed dynamically
                    gravity: 20.0,
                    interactionRate: 0.05,
                    timeStep: 0.0001,
                    blackHoleForce: 100.0,
                    luminosity: 0.25,
                    maxAccelerationColor: 2.0,
                    maxAccelerationColorPercent: 20,
                    motionBlur: false,
                    hideDarkMatter: false,

                    // Must restart simulation
                    numberOfStars: 1000000,
                    radius: 2,
                    height: 5,
                    middleVelocity: 2,
                    velocity: 15,
                    typeOfSimulation: 2,
                    autoRotation: true
                };
                material.dispose();
                geometry.dispose();
                document.getElementsByClassName('dg ac').item(0).removeChild(document.getElementsByClassName('dg main a').item(0));

                document.body.removeChild(document.querySelector('canvas').parentNode);

                PARTICLES = effectController.numberOfStars;

                init(effectController.typeOfSimulation.toString());
                break;
            // Galaxies collision
            case "3":
                scene.remove(particles);
                bloom.strength = 1.0;
                effectController = {
                    // Can be changed dynamically
                    gravity: gravity,
                    interactionRate: interactionRate,
                    timeStep: timeStep,
                    blackHoleForce: blackHoleForce,
                    luminosity: constLuminosity,
                    maxAccelerationColor: 19.0,
                    maxAccelerationColorPercent: 1.9,
                    motionBlur: false,
                    hideDarkMatter: false,

                    // Must restart simulation
                    numberOfStars: numberOfStars,
                    radius: radius,
                    height: height,
                    middleVelocity: middleVelocity,
                    velocity: 12,
                    typeOfSimulation: 3,
                    autoRotation: false
                };
                material.dispose();
                geometry.dispose();
                document.getElementsByClassName('dg ac').item(0).removeChild(document.getElementsByClassName('dg main a').item(0));

                document.body.removeChild(document.querySelector('canvas').parentNode);

                PARTICLES = effectController.numberOfStars;
                init(effectController.typeOfSimulation.toString());

                break;
            default:
                break;
        }
    }

}

function animate() {
    controls.update();
    requestAnimationFrame(animate);
    render();
    stats.update();
}

/**
 * Run the two compute passes with semi-implicit (symplectic) Euler coupling.
 *
 * gpuCompute.compute() would feed BOTH passes the previous frame's textures, so
 * the position pass would integrate with the OLD velocity (explicit Euler).
 * Explicit Euler injects energy every frame proportionally to the square of the
 * orbital frequency: the galaxy center (fastest orbits) empties into a ring
 * within one orbital period and the disk slowly evaporates. Feeding the
 * position pass the freshly computed velocity instead makes the integrator
 * symplectic and orbits stable.
 */
function computeSemiImplicit() {
    const cur = gpuCompute.currentTextureIndex;
    const nxt = cur === 0 ? 1 : 0;

    // Velocity pass: reads previous position and velocity
    const velUniforms = velocityVariable.material.uniforms;
    velUniforms['texturePosition'].value = positionVariable.renderTargets[cur].texture;
    velUniforms['textureVelocity'].value = velocityVariable.renderTargets[cur].texture;
    gpuCompute.doRenderTarget(velocityVariable.material, velocityVariable.renderTargets[nxt]);

    // Position pass: reads previous position but the NEW velocity
    const posUniforms = positionVariable.material.uniforms;
    posUniforms['texturePosition'].value = positionVariable.renderTargets[cur].texture;
    posUniforms['textureVelocity'].value = velocityVariable.renderTargets[nxt].texture;
    gpuCompute.doRenderTarget(positionVariable.material, positionVariable.renderTargets[nxt]);

    gpuCompute.currentTextureIndex = nxt;
}

// The shaders integrate a fixed 1/30 s timestep per compute step, so stepping
// once per display frame ties simulation speed to the monitor refresh rate
// (a 240 Hz screen runs 8x faster). Step the physics at a wall-clock 30 Hz
// instead. On displays slower than 30 Hz the simulation slows down rather than
// running several catch-up steps per frame: each step costs a full N-body
// compute pass, so catching up would only drop the frame rate further.
const PHYSICS_INTERVAL_MS = 1000 / 60;
let nextPhysicsTime = 0;

function render() {
    if (!paused){
        const now = performance.now();
        if (now >= nextPhysicsTime) {
            // Keep the 30 Hz cadence; if we fell behind by more than one
            // interval (hidden tab, pause, slow frame), skip the missed steps
            nextPhysicsTime = Math.max(nextPhysicsTime + PHYSICS_INTERVAL_MS, now);
            computeSemiImplicit();
            particleUniforms[ 'texturePosition' ].value = gpuCompute.getCurrentRenderTarget( positionVariable ).texture;
            particleUniforms[ 'textureVelocity' ].value = gpuCompute.getCurrentRenderTarget( velocityVariable ).texture;
        }
        material.uniforms.uMaxAccelerationColor.value = effectController.maxAccelerationColor;
    }
    if (effectController.motionBlur){
        composer.removePass(blendPass);
        composer.removePass(savePass);
        composer.removePass(outputPass);
        composer.addPass(blendPass);
        composer.addPass(savePass);
        composer.addPass(outputPass);
    } else {
        composer.removePass(blendPass);
        composer.removePass(savePass);
        composer.removePass(outputPass);
    }
    material.uniforms.uLuminosity.value = effectController.luminosity;
    material.uniforms.uHideDarkMatter.value = effectController.hideDarkMatter;
    material.uniforms.uParticleSize.value = effectController.particleSize;
    material.uniforms.uGasBrightness.value = effectController.gasBrightness;
    material.uniforms.uGasDensityScale.value = effectController.gasDensityScale;
    composer.render(scene, camera);

}