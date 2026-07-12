import * as THREE from 'three';
import { PHYSICS_INTERVAL_MS } from '../config/constants.js';
import { createComputation, stepSemiImplicit, syncDynamicUniforms } from './gpuComputation.js';

/**
 * Physics worker: the whole N-body computation lives here, on its own
 * WebGL2 context (OffscreenCanvas) in its own thread — the same design as
 * the reference native implementation (angeluriot/Galaxy_simulation), where
 * a dedicated computation thread runs OpenCL while the render thread draws
 * whatever positions are latest. The page's renderer never waits for the
 * simulation: under heavy settings the physics rate drops arbitrarily far
 * while the camera, the GUI and the browser stay at full frame rate.
 *
 * Two mechanisms keep the GPU itself responsive (a GPU is shared hardware,
 * a separate thread alone does not prevent one giant draw call from
 * stalling the compositor and tripping the Windows TDR watchdog):
 *  - the velocity pass is issued in bounded scissored tiles (see
 *    stepSemiImplicit), sized small here so each draw is a short burst;
 *  - after every tile the worker waits on a GL fence before issuing the
 *    next one, so this context's queue never accumulates a backlog and the
 *    page's context gets GPU time between bursts.
 *
 * Protocol (postMessage):
 *  in:  {type:'init', controller, quality}
 *  in:  {type:'sync', controller, halosMerged}   live parameter changes
 *  in:  {type:'pause', value}
 *  out: {type:'ready', textureSize}
 *  out: {type:'state', positions, velocities, steps}  (transferred buffers)
 *  out: {type:'error', message}
 */

// Pair-interaction budget per draw call: ~4-8 ms bursts on the target GPUs.
// Short enough that the page's render (which shares the GPU) only ever waits
// a few ms behind a burst, big enough that the fence/yield overhead between
// tiles stays negligible (~3 tiles per step at the heaviest shipped preset).
const WORKER_TILE_PAIRS = 1e9;

let renderer = null;
let computation = null;
let controller = null;
let paused = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Instant macrotask yield (MessageChannel): lets queued messages
// (sync/pause) run between tiles without setTimeout's ~4 ms clamping,
// which throttled the whole simulation when used once per tile.
const yieldNow = (() => {
    const channel = new MessageChannel();
    let pending = null;
    channel.port1.onmessage = () => {
        const resolve = pending;
        pending = null;
        if (resolve) resolve();
    };
    return () => new Promise((resolve) => {
        pending = resolve;
        channel.port2.postMessage(0);
    });
})();

/** Resolve once every GL command issued so far has fully executed. */
function gpuDrain(gl) {
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    if (!fence) return Promise.resolve();
    return new Promise((resolve) => {
        const poll = async () => {
            const status = gl.clientWaitSync(fence, 0, 0);
            if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED
                || status === gl.WAIT_FAILED) {
                gl.deleteSync(fence);
                resolve();
            } else {
                await yieldNow();
                poll();
            }
        };
        poll();
    });
}

function readState() {
    const size = computation.textureSize;
    const n = size * size * 4;
    const positions = new Float32Array(n);
    const velocities = new Float32Array(n);
    const { gpuCompute, positionVariable, velocityVariable } = computation;
    renderer.readRenderTargetPixels(
        gpuCompute.getCurrentRenderTarget(positionVariable), 0, 0, size, size, positions);
    renderer.readRenderTargetPixels(
        gpuCompute.getCurrentRenderTarget(velocityVariable), 0, 0, size, size, velocities);
    return { positions, velocities };
}

function postState(steps) {
    const { positions, velocities } = readState();
    postMessage(
        { type: 'state', positions: positions.buffer, velocities: velocities.buffer, steps },
        [positions.buffer, velocities.buffer]);
}

async function loop() {
    const gl = renderer.getContext();
    for (;;) {
        if (paused) {
            await sleep(50);
            continue;
        }
        const t0 = performance.now();
        // One full physics step. Tiles are PIPELINED: a flush between draws
        // gives the browser's GPU scheduler interleaving points for the
        // page's render, without idling our queue. A real fence wait only
        // bounds the in-flight backlog every few tiles — waiting after
        // every tile serialized CPU and GPU (the original "simulation got
        // much slower" regression).
        let tilesInFlight = 0;
        while (!stepSemiImplicit(computation)) {
            gl.flush();
            if (++tilesInFlight >= 4) {
                tilesInFlight = 0;
                await gpuDrain(gl);
            } else {
                await yieldNow(); // handle sync/pause messages promptly
            }
        }
        // The readback below implicitly syncs on the step's completion
        postState(1);
        // Never run faster than the nominal physics cadence (the shader
        // integrates a fixed dt per step); always yield at least once so
        // incoming messages are handled even when overloaded
        const elapsed = performance.now() - t0;
        const wait = PHYSICS_INTERVAL_MS - elapsed;
        if (wait > 1) await sleep(wait);
        else await yieldNow();
    }
}

onmessage = (event) => {
    const msg = event.data;
    if (msg.type === 'init') {
        try {
            controller = msg.controller;
            const canvas = new OffscreenCanvas(4, 4);
            renderer = new THREE.WebGLRenderer({
                canvas,
                antialias: false,
                alpha: false,
                depth: false,
                stencil: false,
                powerPreference: 'high-performance',
            });
            if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2 unavailable in worker');
            computation = createComputation(renderer, controller, msg.quality);
            computation.chunkBudget = WORKER_TILE_PAIRS;
            syncDynamicUniforms(computation, controller);
            postMessage({ type: 'ready', textureSize: computation.textureSize });
            postState(0); // seeded initial state, so the first frame shows the galaxy
            loop();
        } catch (err) {
            postMessage({ type: 'error', message: String(err && err.message || err) });
        }
    } else if (msg.type === 'sync') {
        controller = msg.controller;
        if (computation) {
            syncDynamicUniforms(computation, controller);
            if (msg.halosMerged) computation.velocityUniforms['uHalosMerged'].value = 1.0;
        }
    } else if (msg.type === 'pause') {
        paused = msg.value;
    }
};
