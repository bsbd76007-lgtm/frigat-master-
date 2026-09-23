/**
 * The shared 3D board kit.
 *
 * `scene` is the camera, `solids` the shapes, `backdrop` the stage they sit on
 * and `palette` the tokens they are painted with. A game board imports from
 * here and adds only what is its own — its geometry and its animation.
 */

export * from './scene';
export * from './solids';
export * from './backdrop';
export * from './tileGrid';
export * from './palette';
