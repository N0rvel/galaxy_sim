/**
 * Standalone math helpers (special functions and random sampling).
 */

/**
 * ln(Gamma(x)) via the Lanczos approximation.
 */
export function lnGamma(x) {
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
export function lowerGammaRegularized(s, x) {
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
 * Standard normal random number (Box-Muller).
 */
export function gaussianRandom() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
