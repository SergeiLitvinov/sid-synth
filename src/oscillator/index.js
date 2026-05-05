import { createSine } from './sine.js';
import { createSquare } from './square.js';
import { createTriangle } from './triangle.js';
import { createNoise } from './noise.js';

export function sine(ctx, freq) { return createSine(ctx, freq); }
export function square(ctx, freq) { return createSquare(ctx, freq); }
export function triangle(ctx, freq) { return createTriangle(ctx, freq); }
export function noise(ctx) { return createNoise(ctx); }

export function create(type, ctx, freq) {
  switch (type) {
    case 'sine': return sine(ctx, freq);
    case 'square': return square(ctx, freq);
    case 'triangle': return triangle(ctx, freq);
    case 'noise': return noise(ctx);
    default: return square(ctx, freq);
  }
}
