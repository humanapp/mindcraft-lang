import { Error } from "../platform/error";
import { List } from "../platform/list";
import { INFINITY } from "../platform/math";

/**
 * Node in an M-way tree that can have up to M children.
 * @template T The type of value stored in the node
 */
export class MTreeNode<T> {
  private _value: T;
  private _children: List<MTreeNode<T>>;
  private _parent: MTreeNode<T> | undefined;

  constructor(value: T) {
    this._value = value;
    this._children = new List<MTreeNode<T>>();
    this._parent = undefined;
  }

  /**
   * Get the value stored in this node
   */
  getValue(): T {
    return this._value;
  }

  /**
   * Set the value stored in this node
   */
  setValue(value: T): void {
    this._value = value;
  }

  /**
   * Get the parent node, or undefined if this is the root
   */
  getParent(): MTreeNode<T> | undefined {
    return this._parent;
  }

  /**
   * Get a readonly list of children nodes
   */
  getChildren(): List<MTreeNode<T>> {
    return this._children;
  }

  /**
   * Add a child node to this node
   * @param child The child node to add
   * @throws Error if child already has a parent
   */
  addChild(child: MTreeNode<T>): void {
    if (child._parent !== undefined) {
      throw new Error("Cannot add child that already has a parent");
    }
    this._children.push(child);
    child._parent = this;
  }

  /**
   * Create and add a new child node with the given value
   * @param value The value for the new child node
   * @returns The newly created child node
   */
  addChildValue(value: T): MTreeNode<T> {
    const child = new MTreeNode(value);
    this.addChild(child);
    return child;
  }

  /**
   * Remove a child node from this node
   * @param child The child node to remove
   * @returns true if the child was found and removed, false otherwise
   */
  removeChild(child: MTreeNode<T>): boolean {
    const index = this._children.indexOf(child);
    if (index >= 0) {
      this._children.remove(index);
      child._parent = undefined;
      return true;
    }
    return false;
  }

  /**
   * Remove the child at the specified index
   * @param index The index of the child to remove
   * @returns The removed child node, or undefined if index is out of bounds
   */
  removeChildAt(index: number): MTreeNode<T> | undefined {
    const child = this._children.remove(index);
    if (child !== undefined) {
      child._parent = undefined;
    }
    return child;
  }

  /**
   * Get the child at the specified index
   * @param index The index of the child to get
   * @returns The child node at the index
   */
  getChild(index: number): MTreeNode<T> {
    return this._children.get(index);
  }

  /**
   * Get the number of children this node has
   */
  getChildCount(): number {
    return this._children.size();
  }

  /**
   * Check if this node is a leaf (has no children)
   */
  isLeaf(): boolean {
    return this._children.isEmpty();
  }

  /**
   * Check if this node is the root (has no parent)
   */
  isRoot(): boolean {
    return this._parent === undefined;
  }

  /**
   * Get the depth of this node (distance from root)
   * Root has depth 0
   */
  getDepth(): number {
    let depth = 0;
    let current: MTreeNode<T> | undefined = this._parent;
    while (current !== undefined) {
      depth++;
      current = current._parent;
    }
    return depth;
  }
}

/**
 * M-way tree data structure where each node can have up to M children.
 * @template T The type of values stored in the tree
 */
export class MTree<T> {
  private _root: MTreeNode<T> | undefined;
  private _maxChildren: number;

  /**
   * Create a new M-way tree
   * @param maxChildren Maximum number of children per node (M). Use INFINITY for unbounded.
   */
  constructor(maxChildren: number = INFINITY) {
    if (maxChildren < 1) {
      throw new Error("maxChildren must be at least 1");
    }
    this._root = undefined;
    this._maxChildren = maxChildren;
  }

  /**
   * Get the root node of the tree
   */
  getRoot(): MTreeNode<T> | undefined {
    return this._root;
  }

  /**
   * Set the root node of the tree
   * @param node The node to set as root (must not have a parent)
   * @throws Error if node has a parent
   */
  setRoot(node: MTreeNode<T>): void {
    if (!node.isRoot()) {
      throw new Error("Cannot set a non-root node as tree root");
    }
    this._root = node;
  }

  /**
   * Create a new root node with the given value
   * @param value The value for the root node
   * @returns The newly created root node
   */
  createRoot(value: T): MTreeNode<T> {
    const node = new MTreeNode(value);
    this._root = node;
    return node;
  }

  /**
   * Check if the tree is empty (has no root)
   */
  isEmpty(): boolean {
    return this._root === undefined;
  }

  /**
   * Get the maximum number of children allowed per node
   */
  getMaxChildren(): number {
    return this._maxChildren;
  }

  /**
   * Clear the tree (remove all nodes)
   */
  clear(): void {
    this._root = undefined;
  }

  /**
   * Get the height of the tree (maximum depth + 1)
   * An empty tree has height 0, a tree with only root has height 1
   */
  getHeight(): number {
    if (this._root === undefined) {
      return 0;
    }
    return this._computeHeight(this._root);
  }

  private _computeHeight(node: MTreeNode<T>): number {
    if (node.isLeaf()) {
      return 1;
    }
    let maxChildHeight = 0;
    node.getChildren().forEach((child) => {
      const childHeight = this._computeHeight(child);
      if (childHeight > maxChildHeight) {
        maxChildHeight = childHeight;
      }
    });
    return maxChildHeight + 1;
  }

  /**
   * Count the total number of nodes in the tree
   */
  size(): number {
    if (this._root === undefined) {
      return 0;
    }
    return this._countNodes(this._root);
  }

  private _countNodes(node: MTreeNode<T>): number {
    let count = 1;
    node.getChildren().forEach((child) => {
      count += this._countNodes(child);
    });
    return count;
  }

  /**
   * Traverse the tree in pre-order (node, then children)
   * @param fn Callback function called for each node
   */
  traversePreOrder(fn: (node: MTreeNode<T>) => void): void {
    if (this._root !== undefined) {
      this._traversePreOrder(this._root, fn);
    }
  }

  private _traversePreOrder(node: MTreeNode<T>, fn: (node: MTreeNode<T>) => void): void {
    fn(node);
    node.getChildren().forEach((child) => {
      this._traversePreOrder(child, fn);
    });
  }

  /**
   * Traverse the tree in post-order (children, then node)
   * @param fn Callback function called for each node
   */
  traversePostOrder(fn: (node: MTreeNode<T>) => void): void {
    if (this._root !== undefined) {
      this._traversePostOrder(this._root, fn);
    }
  }

  private _traversePostOrder(node: MTreeNode<T>, fn: (node: MTreeNode<T>) => void): void {
    node.getChildren().forEach((child) => {
      this._traversePostOrder(child, fn);
    });
    fn(node);
  }

  /**
   * Traverse the tree in level-order (breadth-first)
   * @param fn Callback function called for each node
   */
  traverseLevelOrder(fn: (node: MTreeNode<T>) => void): void {
    if (this._root === undefined) {
      return;
    }

    const queue = new List<MTreeNode<T>>();
    queue.push(this._root);

    while (!queue.isEmpty()) {
      const node = queue.shift();
      if (node === undefined) break;

      fn(node);

      node.getChildren().forEach((child) => {
        queue.push(child);
      });
    }
  }

  /**
   * Find the first node that satisfies the predicate using pre-order traversal
   * @param predicate Function that tests each node
   * @returns The first matching node, or undefined if none found
   */
  find(predicate: (node: MTreeNode<T>) => boolean): MTreeNode<T> | undefined {
    if (this._root === undefined) {
      return undefined;
    }
    return this._findNode(this._root, predicate);
  }

  private _findNode(node: MTreeNode<T>, predicate: (node: MTreeNode<T>) => boolean): MTreeNode<T> | undefined {
    if (predicate(node)) {
      return node;
    }

    const children = node.getChildren();
    for (let i = 0; i < children.size(); i++) {
      const result = this._findNode(children.get(i), predicate);
      if (result !== undefined) {
        return result;
      }
    }

    return undefined;
  }

  /**
   * Find a node by its value
   * @param value The value to search for
   * @returns The first node with matching value, or undefined if not found
   */
  findByValue(value: T): MTreeNode<T> | undefined {
    return this.find((node) => node.getValue() === value);
  }

  /**
   * Collect all nodes that satisfy the predicate
   * @param predicate Function that tests each node
   * @returns List of all matching nodes
   */
  filter(predicate: (node: MTreeNode<T>) => boolean): List<MTreeNode<T>> {
    const results = new List<MTreeNode<T>>();
    this.traversePreOrder((node) => {
      if (predicate(node)) {
        results.push(node);
      }
    });
    return results;
  }

  /**
   * Collect all leaf nodes
   * @returns List of all leaf nodes
   */
  getLeaves(): List<MTreeNode<T>> {
    return this.filter((node) => node.isLeaf());
  }

  /**
   * Get all nodes at a specific depth level
   * @param depth The depth level to get nodes from (0 for root)
   * @returns List of nodes at the specified depth
   */
  getNodesAtDepth(depth: number): List<MTreeNode<T>> {
    return this.filter((node) => node.getDepth() === depth);
  }

  /**
   * Convert the tree to a nested object representation
   * Useful for serialization or debugging
   */
  toObject(): TreeObject<T> | undefined {
    if (this._root === undefined) {
      return undefined;
    }
    return this._nodeToObject(this._root);
  }

  private _nodeToObject(node: MTreeNode<T>): TreeObject<T> {
    const children = new List<TreeObject<T>>();
    node.getChildren().forEach((child) => {
      children.push(this._nodeToObject(child));
    });

    return {
      value: node.getValue(),
      children: children.toArray(),
    };
  }

  /**
   * Create a tree from a nested object representation
   * @param obj The object to create the tree from
   * @returns A new MTree instance
   */
  static fromObject<T>(obj: TreeObject<T>, maxChildren?: number): MTree<T> {
    const tree = new MTree<T>(maxChildren);
    const root = tree.createRoot(obj.value);
    MTree._buildFromObject(root, obj);
    return tree;
  }

  private static _buildFromObject<T>(node: MTreeNode<T>, obj: TreeObject<T>): void {
    if (obj.children) {
      for (const childObj of obj.children) {
        const child = node.addChildValue(childObj.value);
        MTree._buildFromObject(child, childObj);
      }
    }
  }
}

/**
 * Object representation of a tree node and its children
 */
export interface TreeObject<T> {
  value: T;
  children?: TreeObject<T>[];
}

/**
 * Builder node for immutable tree construction
 * @template T The type of value stored in the node
 */
interface BuilderNode<T> {
  value: T;
  children: List<BuilderNode<T>>;
}

/**
 * Fluent immutable builder for constructing MTree instances.
 * Each operation returns a new builder instance without mutating the original.
 *
 * @example
 * const tree = MTreeBuilder.create("root")
 *   .addChild("child1")
 *   .addChild("child2", (builder) =>
 *     builder
 *       .addChild("grandchild1")
 *       .addChild("grandchild2")
 *   )
 *   .build();
 *
 * @template T The type of values stored in the tree
 */
export class MTreeBuilder<T> {
  private _rootNode: BuilderNode<T> | undefined;
  private _maxChildren: number;
  private _currentPath: List<number>;

  private constructor(rootNode: BuilderNode<T> | undefined, maxChildren: number, currentPath: List<number>) {
    this._rootNode = rootNode;
    this._maxChildren = maxChildren;
    this._currentPath = currentPath;
  }

  /**
   * Create a new builder with the specified root value
   * @param value The value for the root node
   * @param maxChildren Maximum number of children per node (default INFINITY)
   * @returns A new builder instance
   */
  static create<T>(value: T, maxChildren: number = INFINITY): MTreeBuilder<T> {
    const rootNode: BuilderNode<T> = {
      value,
      children: new List<BuilderNode<T>>(),
    };
    return new MTreeBuilder(rootNode, maxChildren, new List<number>());
  }

  /**
   * Create a new empty builder
   * @param maxChildren Maximum number of children per node (default INFINITY)
   * @returns A new builder instance
   */
  static empty<T>(maxChildren: number = INFINITY): MTreeBuilder<T> {
    return new MTreeBuilder<T>(undefined, maxChildren, new List<number>());
  }

  /**
   * Set the root value (only works on empty builder)
   * @param value The value for the root node
   * @returns A new builder instance with the root set
   */
  setRoot(value: T): MTreeBuilder<T> {
    if (this._rootNode !== undefined) {
      throw new Error("Root already set");
    }
    const rootNode: BuilderNode<T> = {
      value,
      children: new List<BuilderNode<T>>(),
    };
    return new MTreeBuilder(rootNode, this._maxChildren, new List<number>());
  }

  /**
   * Add a child to the current node
   * @param value The value for the new child
   * @param configure Optional function to configure the child's subtree
   * @returns A new builder instance with the child added
   */
  addChild(value: T, configure?: (builder: MTreeBuilder<T>) => MTreeBuilder<T>): MTreeBuilder<T> {
    if (this._rootNode === undefined) {
      throw new Error("Cannot add child to undefined root");
    }

    const newRoot = this._cloneNode(this._rootNode);
    const targetNode = this._navigateToNode(newRoot, this._currentPath);

    const childNode: BuilderNode<T> = {
      value,
      children: new List<BuilderNode<T>>(),
    };

    targetNode.children.push(childNode);

    if (configure) {
      const childPath = this._currentPath.concat(new List<number>());
      childPath.push(targetNode.children.size() - 1);
      const childBuilder = new MTreeBuilder(newRoot, this._maxChildren, childPath);
      return configure(childBuilder);
    }

    return new MTreeBuilder(newRoot, this._maxChildren, this._currentPath);
  }

  /**
   * Navigate to a child node to perform operations on its subtree
   * @param childIndex The index of the child to navigate to
   * @param configure Function to configure the child's subtree
   * @returns A new builder instance after the configuration
   */
  withChild(childIndex: number, configure: (builder: MTreeBuilder<T>) => MTreeBuilder<T>): MTreeBuilder<T> {
    if (this._rootNode === undefined) {
      throw new Error("Cannot navigate to child of undefined root");
    }

    const newPath = this._currentPath.concat(new List<number>());
    newPath.push(childIndex);

    const childBuilder = new MTreeBuilder(this._cloneNode(this._rootNode), this._maxChildren, newPath);
    const configuredBuilder = configure(childBuilder);

    return new MTreeBuilder(configuredBuilder._rootNode, this._maxChildren, this._currentPath);
  }

  /**
   * Add multiple children at once
   * @param values Array of values for the new children
   * @returns A new builder instance with all children added
   */
  addChildren(...values: T[]): MTreeBuilder<T> {
    let builder: MTreeBuilder<T> = this;
    for (const value of values) {
      builder = builder.addChild(value);
    }
    return builder;
  }

  /**
   * Update the value at the current node
   * @param value The new value
   * @returns A new builder instance with the value updated
   */
  setValue(value: T): MTreeBuilder<T> {
    if (this._rootNode === undefined) {
      throw new Error("Cannot set value on undefined root");
    }

    const newRoot = this._cloneNode(this._rootNode);
    const targetNode = this._navigateToNode(newRoot, this._currentPath);
    targetNode.value = value;

    return new MTreeBuilder(newRoot, this._maxChildren, this._currentPath);
  }

  /**
   * Build the final MTree from this builder
   * @returns A new MTree instance
   */
  build(): MTree<T> {
    const tree = new MTree<T>(this._maxChildren);
    if (this._rootNode === undefined) {
      return tree;
    }

    const root = tree.createRoot(this._rootNode.value);
    this._buildNodeRecursive(this._rootNode, root);
    return tree;
  }

  private _buildNodeRecursive(builderNode: BuilderNode<T>, treeNode: MTreeNode<T>): void {
    builderNode.children.forEach((childBuilderNode) => {
      const childTreeNode = treeNode.addChildValue(childBuilderNode.value);
      this._buildNodeRecursive(childBuilderNode, childTreeNode);
    });
  }

  private _cloneNode(node: BuilderNode<T>): BuilderNode<T> {
    const clonedChildren = new List<BuilderNode<T>>();
    node.children.forEach((child) => {
      clonedChildren.push(this._cloneNode(child));
    });

    return {
      value: node.value,
      children: clonedChildren,
    };
  }

  private _navigateToNode(root: BuilderNode<T>, path: List<number>): BuilderNode<T> {
    let current = root;
    path.forEach((index) => {
      current = current.children.get(index);
    });
    return current;
  }
}
