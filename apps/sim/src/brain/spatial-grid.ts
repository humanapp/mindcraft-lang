import type { Actor } from "./actor";

/**
 * A flat-grid spatial hash for fast proximity queries.
 *
 * The world is divided into a uniform grid of square cells. Each cell
 * holds a list of actors whose position falls within it. Range queries
 * iterate only the cells that overlap the query circle instead of all
 * actors in the world, reducing vision checks from O(N) to O(K) where
 * K is the number of actors in nearby cells.
 *
 * The grid is rebuilt from scratch every tick (O(N) insert) which is
 * faster and simpler than incremental updates for moving actors.
 */
export class SpatialGrid {
  /** Flat array of cells. Index = col + row * numCols. */
  readonly cells: Actor[][];
  readonly numCols: number;
  readonly numRows: number;

  constructor(
    readonly worldWidth: number,
    readonly worldHeight: number,
    readonly cellSize: number
  ) {
    this.numCols = Math.max(1, Math.ceil(worldWidth / cellSize));
    this.numRows = Math.max(1, Math.ceil(worldHeight / cellSize));
    const totalCells = this.numCols * this.numRows;
    this.cells = new Array(totalCells);
    for (let i = 0; i < totalCells; i++) {
      this.cells[i] = [];
    }
  }

  /** Remove all actors from every cell (keeps allocated arrays). */
  clear(): void {
    for (let i = 0; i < this.cells.length; i++) {
      this.cells[i].length = 0;
    }
  }

  /** Insert a single actor into the grid based on its sprite position. */
  insert(actor: Actor): void {
    const col = Math.max(0, Math.min(Math.floor(actor.sprite.x / this.cellSize), this.numCols - 1));
    const row = Math.max(0, Math.min(Math.floor(actor.sprite.y / this.cellSize), this.numRows - 1));
    this.cells[col + row * this.numCols].push(actor);
  }

  /** Clear the grid and re-insert all actors. O(N). */
  rebuild(actors: ReadonlyArray<Actor>): void {
    this.clear();
    for (let i = 0; i < actors.length; i++) {
      this.insert(actors[i]);
    }
  }
}
