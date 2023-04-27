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
const numberOfStars = 30000;
const radius = 100;
const height = 5;
const middleVelocity = 2;
const velocity = 15;
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

effectController = {
    // Can be changed dynamically
    gravity: gravity,
    interactionRate: interactionRate,
    timeStep: timeStep,
    blackHoleForce: blackHoleForce,
    luminosity: constLuminosity,
    maxAccelerationColor: 50.0,
    maxAccelerationColorPercent: 5,
    motionBlur: false,
    hideDarkMatter: false,

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
 *
 * @param typeOfSimulation
 */
function init(typeOfSimulation) {

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
 * Init positions et volocities for all particles
 * @param texturePosition array that contain positions of particles
 * @param textureVelocity array that contain velocities of particles
 */
function fillTextures( texturePosition, textureVelocity ) {

    const posArray = texturePosition.image.data;
    const velArray = textureVelocity.image.data;

    const radius = effectController.radius;
    const height = effectController.height;
    const middleVelocity = effectController.middleVelocity;
    const maxVel = effectController.velocity;

    for ( let k = 0, kl = posArray.length; k < kl; k += 4 ) {
        // Position
        let x, z, rr, y, vx, vy, vz;
        // The first particle will be the black hole
        if (k === 0){
            x = 0;
            z = 0;
            y = 0;
            rr = 0;
        } else {
            // Generate random position for the particle within the radius
            do {
                x = ( Math.random() * 2 - 1 );
                z = ( Math.random() * 2 - 1 );
                // The variable rr is used to calculate the distance from the center of the radius for each particle.
                // It is used in the calculation of rExp which is used to determine the position of the particle within the radius.
                // If a particle is closer to the center, rr will be smaller, and rExp will be larger, which means that the particle will be placed closer to the center.
                // It also can affect the velocity of the particle as it is used in the calculation of the velocity of the particle.
                rr = x * x + z * z;

            } while ( rr > 1 );
            rr = Math.sqrt( rr );

            const rExp = radius * Math.pow( rr, middleVelocity );

            // Velocity
            const vel = maxVel * Math.pow( rr, 0.2 );

            vx = vel * z + ( Math.random() * 2 - 1 ) * 0.001;
            vy = ( Math.random() * 2 - 1 ) * 0.001 * 0.05;
            vz = - vel * x + ( Math.random() * 2 - 1 ) * 0.001;

            x *= rExp;
            z *= rExp;
            y = ( Math.random() * 2 - 1 ) * height;
        }

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

function fillGalaxiesCollisionTextures( texturePosition, textureVelocity ){
    const posArray = texturePosition.image.data;
    const velArray = textureVelocity.image.data;

    const radius = effectController.radius;
    const height = effectController.height;
    const middleVelocity = effectController.middleVelocity;
    const maxVel = effectController.velocity;
    let indice = 0;
    for ( let k = 0, kl = posArray.length; k < kl; k += 4 ) {
        // Position
        let x, z, rr, y, vx, vy, vz;
        // If pair
        if (indice % 2 === 0){
            // Generate random position for the particle within the radius
            do {
                x = ( Math.random() * 2 - 1 );
                z = ( Math.random() * 2 - 1 );
                // The variable rr is used to calculate the distance from the center of the radius for each particle.
                // It is used in the calculation of rExp which is used to determine the position of the particle within the radius.
                // If a particle is closer to the center, rr will be smaller, and rExp will be larger, which means that the particle will be placed closer to the center.
                // It also can affect the velocity of the particle as it is used in the calculation of the velocity of the particle.
                rr = x * x + z * z;

            } while ( rr > 1 );
            rr = Math.sqrt( rr );

            const rExp = radius * Math.pow( rr, middleVelocity );

            // Velocity
            const vel = maxVel * Math.pow( rr, 0.2 );

            vx = vel * z + ( Math.random() * 2 - 1 ) * 0.001;
            vy = ( Math.random() * 2 - 1 ) * 0.001 * 0.05;
            vz = - vel * x + ( Math.random() * 2 - 1 ) * 0.001;

            x *= rExp;
            z *= rExp;
            y = ( Math.random() * 2 - 1 ) * height;
        }
        // If impair
        else {
            // Generate random position for the particle within the radius
            do {
                x = ( Math.random() * 2 - 1 );
                y = ( Math.random() * 2 - 1 );
                // The variable rr is used to calculate the distance from the center of the radius for each particle.
                // It is used in the calculation of rExp which is used to determine the position of the particle within the radius.
                // If a particle is closer to the center, rr will be smaller, and rExp will be larger, which means that the particle will be placed closer to the center.
                // It also can affect the velocity of the particle as it is used in the calculation of the velocity of the particle.
                rr = x*x + y*y;

            } while ( rr > 1 );
            rr = Math.sqrt( rr );

            const rExp = radius * Math.pow( rr, middleVelocity );

            // Velocity
            const vel = maxVel * Math.pow( rr, 0.2 );

            vx = -vel * y + ( Math.random() * 2 - 1 ) * 0.001;
            vy =  vel * x + ( Math.random() * 2 - 1 ) * 0.001;
            vz = -( Math.random() * 2 - 1 ) * 0.001 * 0.05;
            const angle = -Math.PI/4;

            const vy_temp = vy;
            const vz_temp = vz;
            vy = vy_temp * Math.cos(angle) - vz_temp * Math.sin(angle);
            vz = vy_temp * Math.sin(angle) + vz_temp * Math.cos(angle);

            x = x*rExp +200;
            y = y*rExp +200;
            z = ( Math.random() * 2 - 1 ) * height +10;
            const y_temp = y;
            const z_temp = z;
            y = y_temp * Math.cos(angle) - z_temp * Math.sin(angle);
            z = y_temp * Math.sin(angle) + z_temp * Math.cos(angle);
        }


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
        indice++;
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
    console.log(effectController.maxAccelerationColor);
    velocityUniforms[ 'uMaxAccelerationColor' ].value = effectController.maxAccelerationColor;
    velocityUniforms[ 'blackHoleForce' ].value = effectController.blackHoleForce;
    velocityUniforms[ 'luminosity' ].value = effectController.luminosity;
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
    folder1.add( effectController, 'hideDarkMatter', 0, 1, 1 ).onChange( function ( value ) {
        effectController.hideDarkMatter =  value ;
    }   ).name("Hide dark matter");
    folderGraphicSettings.add( bloom, 'strength', 0.0, 2.0, 0.1 ).onChange(  function ( value ) {
        bloom.strength =  value ;
        bloomPass.strength = bloom.strength;
    }  ).name("Bloom");
    folderGraphicSettings.add( effectController, 'motionBlur', 0, 1, 1 ).onChange( function ( value ) {
        effectController.motionBlur =  value ;
    }   ).name("Motion blur");
    if (effectController.typeOfSimulation === 1 || effectController.typeOfSimulation === 3){
        folder1.add( effectController, 'blackHoleForce', 0.0, 10000.0, 1.0 ).onChange( dynamicValuesChanger ).name("Black hole mass");
        folderGraphicSettings.add( effectController, 'maxAccelerationColorPercent', 0.01, 100, 0.01 ).onChange(  function ( value ) {
            effectController.maxAccelerationColor = value * 10;
            dynamicValuesChanger();
        }  ).name("Colors mix (%)");
        folder2.add( effectController, 'numberOfStars', 2.0, 1000000.0, 1.0 ).name("Number of stars");
        folder2.add( effectController, 'radius', 1.0, 1000.0, 1.0 ).name("Galaxy diameter");
        folder2.add( effectController, 'height', 0.0, 50.0, 0.01 ).name("Galaxy height");
        folder2.add( effectController, 'middleVelocity', 0.0, 20.0, 0.001 ).name("Center rotation speed");
        folder2.add( effectController, 'velocity', 0.0, 150.0, 0.1 ).name("Initial rotation speed");
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
                    interactionRate: interactionRate,
                    timeStep: timeStep,
                    blackHoleForce: blackHoleForce,
                    luminosity: constLuminosity,
                    maxAccelerationColor: 50.0,
                    maxAccelerationColorPercent: 5.0,
                    motionBlur: false,
                    hideDarkMatter: false,

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

function render() {
    if (!paused){
        gpuCompute.compute();
        particleUniforms[ 'texturePosition' ].value = gpuCompute.getCurrentRenderTarget( positionVariable ).texture;
        particleUniforms[ 'textureVelocity' ].value = gpuCompute.getCurrentRenderTarget( velocityVariable ).texture;
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
    composer.render(scene, camera);

}