export { createSine } from './sine.js';
export { createSquare } from './square.js';
export { createTriangle } from './triangle.js';
export { createNoise } from './noise.js';

export function create(type, ctx, freq) {
  switch (type) {
    case 'sine': return createSine(ctx, freq);
    case 'square': return createSquare(ctx, freq);
    case 'triangle': return createTriangle(ctx, freq);
    case 'noise': return createNoise(ctx);
    default: return createSquare(ctx, freq);
  }
}
