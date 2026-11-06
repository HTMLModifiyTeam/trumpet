export const SKIN = ['#f3cfb3', '#e8b48f', '#d49a6a', '#b07246', '#7d4b2a', '#f6dccb', '#eac1a0', '#c98a5c'];
export const HAIRC = ['#1c1716', '#2d1c12', '#4a2c1a', '#7a4a26', '#b0753c', '#d9b26a', '#e86a92', '#3b6fd4', '#c2452d'];
export const TOPS = ['#e2403a', '#2f6fdb', '#f2b72b', '#1f9e7a', '#8a4fd1', '#ff8a3d', '#2b3a67', '#f4f1e8', '#57b847', '#d6336c', '#14a3b8', '#ffffff', '#ffd23f'];
export const BOTTOMS = ['#2b3a67', '#3a3a3a', '#6b4f3a', '#1f2937', '#8b6f47', '#334155', '#1e4d8c', '#5b4a7a'];
export const POSE = {
    rest: [-0.5, 0.15, -1.05], clap: [-1.0, 0.46, -1.3], clapHigh: [-2.55, 0.3, -0.55], raise: [-2.5, -0.05, -0.35],
    fist: [-2.75, 0.05, -1.55], whistle: [-1.15, 0.82, -2.3], heart: [-0.6, 0.9, -1.85], snap: [-0.7, 0.12, -1.75],
    slap: [-0.92, 0.18, -0.4], phone: [-1.0, 0.42, -1.95], point: [-1.45, 0.15, -0.08], chin: [-0.75, 0.62, -2.25],
    wave: [-2.6, -0.25, -0.7], hang: [-0.05, 0.05, -0.12], keys: [-1.18, 0.18, -0.5], shake: [-1.6, 0.55, -1.9],
};

export const G = { renderer: null, scene: null, camera: null, W: 1, H: 1, M: {}, GEO: {}, people: [], band: {}, props: {}, env: null, seats: [] };