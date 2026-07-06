attribute float aSize;
attribute vec3 aColor;
attribute vec2 aTwinkle; // x = speed, y = phase

uniform float uTime;
uniform float uPixelRatio;

varying vec3 vColor;
varying float vBrightness;

void main() {
    vColor = aColor;
    vBrightness = 0.72 + 0.28 * sin(uTime * aTwinkle.x + aTwinkle.y);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio;
    gl_Position = projectionMatrix * mvPosition;
}
