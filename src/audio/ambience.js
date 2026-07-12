/**
 * Looping ambient soundtrack, started once when the simulation begins.
 * Survives simulation restarts/switches since those never go back
 * through the landing screen.
 */
const ambience = new Audio('Ambiance_LOOP.wav');
ambience.loop = true;

export function startAmbience() {
    ambience.play().catch((err) => {
        console.warn('Ambience playback failed:', err);
    });
}

export function setAmbienceMuted(muted) {
    ambience.muted = muted;
}

export function isAmbienceMuted() {
    return ambience.muted;
}
