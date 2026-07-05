import { QUALITY } from '../config/constants.js';
import { app } from '../app.js';

/**
 * Landing screen: pick a quality mode, then hand over to the app.
 */
export function initLandingScreen() {
    const start = (quality) => {
        document.getElementById('main-container').remove();
        app.start(quality);
    };
    document.getElementById('choice1').addEventListener('click', () => start(QUALITY.NORMAL));
    document.getElementById('choice2').addEventListener('click', () => start(QUALITY.EXPERIMENTAL));
}
