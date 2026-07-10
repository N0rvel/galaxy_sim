import { QUALITY } from '../config/constants.js';
import { app } from '../app.js';
import { startAmbience } from '../audio/ambience.js';
import { applyLiquidGlass } from './liquidGlass.js';

/**
 * Landing screen: a one-page scroll experience over the fixed video
 * backdrop - hero, feature section, mode choice - every surface in liquid
 * glass. Panels reveal as they enter the viewport, and the hero drifts
 * slower than the scroll and fades out, so the glass refraction is always
 * sweeping across the backdrop while the user scrolls.
 */
export function initLandingScreen() {
    const start = (quality) => {
        document.getElementById('main-container').remove();
        startAmbience();
        app.start(quality);
    };
    document.getElementById('choice1').addEventListener('click', () => start(QUALITY.NORMAL));
    document.getElementById('choice2').addEventListener('click', () => start(QUALITY.EXPERIMENTAL));

    const container = document.getElementById('main-container');

    // Reveal panels once they enter the viewport. Threshold 0 + a bottom
    // margin: the pre-reveal translateY pushes elements near the fold almost
    // fully below the viewport, so a ratio threshold would never fire.
    // Wired before the glass so a glass failure can never leave the page
    // stuck invisible.
    const io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                entry.target.classList.add('in');
                io.unobserve(entry.target);
            }
        }
    }, { threshold: 0, rootMargin: '0px 0px 12% 0px' });
    container.querySelectorAll('.reveal').forEach((el) => io.observe(el));

    // The refraction effect is decorative: if it fails (e.g. canvas data
    // blocked by privacy settings), keep the CSS blur fallback and move on.
    try {
        applyLiquidGlass(container.querySelectorAll('.liquid-glass, .liquid-glass-text'), container);
    } catch (err) {
        console.error('liquid glass disabled:', err);
    }

    // Hero parallax: lags behind the scroll and fades away.
    const landing = document.getElementById('landing');
    const content = document.getElementById('scroll-content');
    const hero = container.querySelector('.hero-inner');
    const pill = container.querySelector('.scroll-pill');
    const applyHero = (t) => {
        hero.style.transform = `translateY(${(t * 0.4).toFixed(1)}px)`;
        hero.style.opacity = Math.max(0, 1 - t / (window.innerHeight * 0.8)).toFixed(3);
    };
    const enableNativeScroll = () => {
        landing.style.overflowY = 'auto';
        landing.addEventListener('scroll', () => applyHero(landing.scrollTop), { passive: true });
    };

    // Note: prefers-reduced-motion is deliberately ignored - this page IS
    // the animation (owner's call, 2026-07-10); the whole experience exists
    // to move glass over the video.

    // Inertial virtual scrolling: the container never scrolls natively -
    // wheel/keys/touch feed a target offset and .scroll-content is
    // translated toward it every frame. Translating (instead of writing
    // scrollTop) means the browser's compositor scrolling can never race
    // the glide (Firefox APZ scrolls before a busy main thread gets to
    // preventDefault, which made the page jump forward then snap back).
    // Used on every device - touch drags feed the same target.
    try {
        let target = 0;
        let current = 0;
        const maxScroll = () => Math.max(0, content.offsetHeight - landing.clientHeight);
        const clamp = (v) => Math.max(0, Math.min(maxScroll(), v));
        landing.addEventListener('wheel', (e) => {
            if (e.ctrlKey) return; // pinch-zoom gesture: leave it to the browser
            e.preventDefault();
            // px per wheel notch: Firefox reports lines (deltaMode 1, ~3/notch)
            const unit = e.deltaMode === 1 ? 36 : (e.deltaMode === 2 ? landing.clientHeight : 1);
            target = clamp(target + e.deltaY * unit);
        }, { passive: false });
        window.addEventListener('keydown', (e) => {
            if (!container.isConnected) return;
            const page = landing.clientHeight * 0.9;
            const steps = {
                ArrowDown: 70, ArrowUp: -70,
                PageDown: page, PageUp: -page, ' ': e.shiftKey ? -page : page,
                Home: -1e9, End: 1e9,
            };
            if (e.key in steps) {
                e.preventDefault();
                target = clamp(target + steps[e.key]);
            }
        });
        // touch: drag scrolls 1:1, release adds momentum from the last move
        landing.style.touchAction = 'none';
        let touchY = null;
        let touchV = 0;
        landing.addEventListener('touchstart', (e) => {
            touchY = e.touches[0].clientY;
            touchV = 0;
        }, { passive: true });
        landing.addEventListener('touchmove', (e) => {
            if (touchY === null) return;
            const y = e.touches[0].clientY;
            touchV = touchY - y;
            target = clamp(target + touchV);
            touchY = y;
        }, { passive: true });
        landing.addEventListener('touchend', () => {
            target = clamp(target + touchV * 14);
            touchY = null;
        });
        pill.addEventListener('click', (e) => {
            e.preventDefault();
            target = document.getElementById('about').offsetTop;
        });
        const glide = () => {
            if (!container.isConnected) return;
            target = Math.min(target, maxScroll()); // window may have grown
            current += (target - current) * 0.11;
            if (Math.abs(target - current) < 0.3) current = target;
            content.style.transform = `translate3d(0, ${(-current).toFixed(2)}px, 0)`;
            applyHero(current);
            requestAnimationFrame(glide);
        };
        requestAnimationFrame(glide);
    } catch (err) {
        console.error('virtual scrolling disabled:', err);
        enableNativeScroll();
    }
}
