export type EntityId = string;

export interface Transform {
  position: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
}

export interface Entity {
  readonly id: EntityId;
  transform: Transform;
  // Future component slots:
  // render?: RenderComponent;
  // brain?: BrainComponent;
  // physics?: PhysicsComponent;
}

let nextId = 1;

export function createEntityId(): EntityId {
  return `e${nextId++}`;
}

export function defaultTransform(): Transform {
  return {
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
  };
}
