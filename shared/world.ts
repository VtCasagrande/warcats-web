import type { Cover } from './types';

export type WorldBox = {
  id: string; x: number; y: number; z: number; w: number; h: number; d: number;
  yaw?: number;
  material: 'concrete' | 'metal' | 'rust' | 'dark' | 'wood' | 'sand';
};
export const WORLD_BOXES: WorldBox[] = [];
function box(id: string, x: number, z: number, w: number, h: number, d: number, material: WorldBox['material'] = 'concrete', y = h / 2) {
  WORLD_BOXES.push({ id, x, y, z, w, h, d, material });
}

// Every solid used by rendering also lives here, shared with authoritative physics.
// Pump hall: open entrances on two sides and windows represented by real gaps.
box('hall-back-left', -7.6, -23, 9, 6.5, 0.5);
box('hall-back-right', 7.6, -23, 9, 6.5, 0.5);
box('hall-back-lintel', 0, -23, 6.2, 2, 0.5, 'concrete', 5.5);
box('hall-west', -12, -15, 0.6, 6.5, 16);
box('hall-east', 12, -15, 0.6, 6.5, 16);
box('hall-front-left', -8, -7, 8.4, 6.5, 0.5);
box('hall-front-right', 8, -7, 8.4, 6.5, 0.5);
box('hall-front-lintel', 0, -7, 7.6, 2.4, 0.5, 'concrete', 5.3);
box('hall-roof', 0, -15, 25, 0.35, 17, 'metal', 6.7);
box('hall-generator-a', -7, -16, 3.5, 2.5, 5, 'dark');
box('hall-generator-b', 7, -16, 3.5, 2.5, 5, 'dark');

// Offices, freight yard, and the maintenance shed leave three distinct approaches.
box('office-west', -33, 0, 0.6, 5.2, 16);
box('office-east-a', -22, -5.5, 0.6, 5.2, 5);
box('office-east-b', -22, 5.5, 0.6, 5.2, 5);
box('office-east-top', -22, 0, 0.6, 2.5, 6, 'concrete', 3.95);
box('office-north', -27.5, -8, 11.5, 5.2, 0.5);
box('office-south-left', -31.5, 8, 3, 5.2, 0.5);
box('office-south-right', -23.5, 8, 3.5, 5.2, 0.5);
box('office-roof', -27.5, 0, 12.5, 0.35, 17, 'dark', 5.35);
box('container-red', 28, 4, 3, 2.9, 12, 'rust');
box('container-green', 34, -8, 3, 2.9, 12, 'metal');
box('container-stack', 34, -8, 3, 2.9, 12, 'rust', 4.35);
box('container-south', 18, 29, 12, 2.9, 3, 'metal');
box('container-west', -30, 29, 12, 2.9, 3, 'rust');
box('shed-back', 29, -34, 17, 4.5, 0.4, 'metal');
box('shed-left', 20.5, -29, 0.4, 4.5, 10, 'metal');
box('shed-right', 37.5, -29, 0.4, 4.5, 10, 'metal');
box('shed-roof', 29, -29, 18, 0.25, 11, 'dark', 4.6);
box('tank-base-a', -31, -31, 7, 2.8, 7, 'concrete');
box('tank-base-b', -43, -31, 7, 2.8, 7, 'concrete');
box('chimney-base', 17, -18, 3.2, 12, 3.2, 'rust');
box('checkpoint', 0, 38, 6, 3, 4, 'concrete');
box('concrete-north', 3, -37, 11, 1.2, 0.7);
box('concrete-south', -4, 22, 11, 1.05, 0.7);
box('concrete-east', 22, 15, 0.7, 1.05, 8);
box('concrete-west', -15, 19, 0.7, 1.05, 7);
box('east-wall-a', 47, -12, 0.7, 2.3, 14);
box('east-wall-b', 47, 17, 0.7, 2.3, 14);
box('west-wall-a', -47, 1, 0.7, 2.3, 18);
box('west-wall-b', -47, 30, 0.7, 2.3, 12);
box('crate-a', -5, 7, 2, 1.1, 2, 'wood');
box('crate-b', -6, 8.8, 2, 1.1, 2, 'wood');
box('crate-c', 15, -1, 2, 1.1, 2, 'wood');
box('crate-d', -39, 17, 2.5, 1.1, 2.5, 'wood');

export const INITIAL_COVERS: Cover[] = [
  { id: 'sand-a', x: -8, z: 0, w: 4, d: 0.8, h: 1.1, health: 320, team: null },
  { id: 'sand-b', x: 8, z: 13, w: 4, d: 0.8, h: 1.1, health: 320, team: null },
  { id: 'sand-c', x: 17, z: -9, w: 0.8, d: 4, h: 1.1, health: 320, team: null },
  { id: 'sand-d', x: -20, z: -27, w: 4, d: 0.8, h: 1.1, health: 320, team: null },
  { id: 'sand-e', x: -30, z: 43, w: 4, d: 0.8, h: 1.1, health: 320, team: null },
  { id: 'sand-f', x: 40, z: 34, w: 4, d: 0.8, h: 1.1, health: 320, team: null },
];
export const coverBox = (cover: Cover): WorldBox => ({ ...cover, y: cover.y ?? cover.h / 2, material: 'sand' });

export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
