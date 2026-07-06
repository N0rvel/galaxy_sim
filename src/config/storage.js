/**
 * Persistence of user-modified simulation parameters in localStorage.
 *
 * One slot per simulation type x quality mode, so the saved values are only
 * reapplied on top of the preset they were derived from. Each slot stores the
 * whole effectController plus the app-level bloom strength.
 *
 * All accesses are wrapped in try/catch: localStorage can be unavailable
 * (private browsing, storage disabled) or full, and a corrupted entry must
 * never break the boot sequence.
 */

const KEY_PREFIX = 'galaxy_sim.params';

function storageKey(type, quality) {
    return `${KEY_PREFIX}.q${quality}.t${type}`;
}

/**
 * @param data {{controller: Object, bloomStrength: number}}
 * @returns {boolean} true if the save succeeded
 */
export function saveSimulationSettings(type, quality, data) {
    try {
        localStorage.setItem(storageKey(type, quality), JSON.stringify(data));
        return true;
    } catch (e) {
        console.warn('Could not save simulation settings:', e);
        return false;
    }
}

/**
 * @returns {{controller: Object, bloomStrength: number}|null}
 */
export function loadSimulationSettings(type, quality) {
    try {
        const raw = localStorage.getItem(storageKey(type, quality));
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data || typeof data.controller !== 'object' || data.controller === null) return null;
        return data;
    } catch (e) {
        console.warn('Could not load simulation settings:', e);
        return null;
    }
}

export function clearSimulationSettings(type, quality) {
    try {
        localStorage.removeItem(storageKey(type, quality));
    } catch (e) {
        console.warn('Could not clear simulation settings:', e);
    }
}
