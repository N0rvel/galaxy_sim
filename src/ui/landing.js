import { QUALITY } from '../config/constants.js';
import { app } from '../app.js';
import { startAmbience } from '../audio/ambience.js';

/**
 * Landing screen: pick a quality mode, then hand over to the app.
 */
export function initLandingScreen() {
    const start = (quality) => {
        document.getElementById('main-container').remove();
        startAmbience();
        app.start(quality);
    };
    document.getElementById('choice1').addEventListener('click', () => start(QUALITY.NORMAL));
    document.getElementById('choice2').addEventListener('click', () => start(QUALITY.EXPERIMENTAL));
}
