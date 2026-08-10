/**
 * Phaser's untyped Matter.js physics modules. Each default-exports `unknown`;
 * cast it to the matching `MatterJS` type from Phaser's own declarations.
 */
declare module "phaser/src/physics/matter-js/lib/*" {
  const module: unknown;
  export default module;
}
