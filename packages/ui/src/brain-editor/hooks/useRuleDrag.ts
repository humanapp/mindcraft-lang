import type { BrainPageDef, BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { kMaxBrainRuleDepth } from "@mindcraft-lang/core/brain/model";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BrainCommandHistory, RuleLocation } from "../commands";
import { MoveRuleCommand } from "../commands";

const DRAG_THRESHOLD_PX = 5;
const INDENT_PX = 32;
const AUTO_SCROLL_EDGE_PX = 40;
const AUTO_SCROLL_MAX_RATE = 16; // pixels per frame at full deflection

interface FlatEntry {
  rule: BrainRuleDef;
  depth: number;
}

interface DragState {
  rule: BrainRuleDef;
  origin: RuleLocation;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  started: boolean;
  draggedSubtreeIds: Set<number>;
  draggedSubtreeMaxDepth: number;
  autoScrollFrame: number | null;
  autoScrollDirection: number;
  lastClientX: number;
  lastClientY: number;
  ghostEl: HTMLElement | null;
  ghostOffsetX: number;
  ghostOffsetY: number;
}

export interface UseRuleDragOptions {
  pageDef: BrainPageDef;
  commandHistory: BrainCommandHistory;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
}

export interface UseRuleDragResult {
  draggingRuleId: number | null;
  beginDrag: (rule: BrainRuleDef, event: React.PointerEvent<HTMLElement>) => boolean;
}

function captureLocation(rule: BrainRuleDef): RuleLocation {
  const ancestor = rule.ancestor() as BrainRuleDef | undefined;
  if (ancestor) {
    return { parentRule: ancestor, index: ancestor.children().indexOf(rule) };
  }
  const page = rule.page() as BrainPageDef | undefined;
  if (!page) {
    throw new Error("Rule has no parent or page");
  }
  return { pageDef: page, index: page.children().indexOf(rule) };
}

function locationsEqual(a: RuleLocation, b: RuleLocation): boolean {
  return a.parentRule === b.parentRule && a.pageDef === b.pageDef && a.index === b.index;
}

function flattenPage(page: BrainPageDef, exclude: Set<number>): FlatEntry[] {
  const out: FlatEntry[] = [];
  const walk = (rule: BrainRuleDef, depth: number) => {
    if (exclude.has(rule.id())) return;
    out.push({ rule, depth });
    const children = rule.children();
    for (let i = 0; i < children.size(); i++) {
      walk(children.get(i) as BrainRuleDef, depth + 1);
    }
  };
  const top = page.children();
  for (let i = 0; i < top.size(); i++) {
    walk(top.get(i) as BrainRuleDef, 0);
  }
  return out;
}

function collectSubtreeIds(rule: BrainRuleDef): Set<number> {
  const ids = new Set<number>();
  const walk = (r: BrainRuleDef) => {
    ids.add(r.id());
    const children = r.children();
    for (let i = 0; i < children.size(); i++) {
      walk(children.get(i) as BrainRuleDef);
    }
  };
  walk(rule);
  return ids;
}

function findRuleElement(container: HTMLElement, ruleId: number): HTMLElement | null {
  return container.querySelector(`[data-rule-id="${ruleId}"]`);
}

function createGhostElement(source: HTMLElement, zoom: number): { el: HTMLElement; rect: DOMRect } {
  const rect = source.getBoundingClientRect();
  const clone = source.cloneNode(true) as HTMLElement;
  clone.removeAttribute("data-rule-id");
  clone.style.position = "fixed";
  clone.style.left = `${rect.left}px`;
  clone.style.top = `${rect.top}px`;
  clone.style.width = `${source.offsetWidth}px`;
  clone.style.height = `${source.offsetHeight}px`;
  clone.style.margin = "0";
  clone.style.pointerEvents = "none";
  clone.style.opacity = "0.85";
  clone.style.transform = `scale(${zoom * 1.03})`;
  clone.style.transformOrigin = "top left";
  clone.style.boxShadow = "0 12px 32px rgba(0,0,0,0.45)";
  clone.style.zIndex = "9999";
  clone.style.transition = "none";
  clone.setAttribute("aria-hidden", "true");
  document.body.appendChild(clone);
  return { el: clone, rect };
}

interface ResolvedTarget {
  parentRule?: BrainRuleDef;
  pageDef?: BrainPageDef;
  index: number;
}

function resolveTarget(page: BrainPageDef, flat: FlatEntry[], slot: number, depth: number): ResolvedTarget {
  const prev = slot > 0 ? flat[slot - 1] : undefined;

  if (depth === 0) {
    if (!prev) {
      return { pageDef: page, index: 0 };
    }
    let rootRule = prev.rule;
    while (rootRule.ancestor()) {
      rootRule = rootRule.ancestor() as BrainRuleDef;
    }
    const idx = page.children().indexOf(rootRule);
    return { pageDef: page, index: idx + 1 };
  }

  if (!prev) {
    return { pageDef: page, index: 0 };
  }

  let parent: BrainRuleDef = prev.rule;
  while (parent.myDepth() > depth - 1) {
    parent = parent.ancestor() as BrainRuleDef;
  }

  if (parent === prev.rule) {
    return { parentRule: parent, index: 0 };
  }

  let walkUp: BrainRuleDef = prev.rule;
  while ((walkUp.ancestor() as BrainRuleDef | undefined) !== parent) {
    walkUp = walkUp.ancestor() as BrainRuleDef;
  }
  const idx = parent.children().indexOf(walkUp);
  return { parentRule: parent, index: idx + 1 };
}

export function useRuleDrag(opts: UseRuleDragOptions): UseRuleDragResult {
  const [draggingRuleId, setDraggingRuleId] = useState<number | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const handlersRef = useRef<{
    move: (ev: PointerEvent) => void;
    up: (ev: PointerEvent) => void;
    cancel: (ev: PointerEvent) => void;
    keydown: (ev: KeyboardEvent) => void;
  } | null>(null);

  useEffect(() => {
    const stopAutoScroll = () => {
      const drag = dragRef.current;
      if (drag && drag.autoScrollFrame !== null) {
        cancelAnimationFrame(drag.autoScrollFrame);
        drag.autoScrollFrame = null;
        drag.autoScrollDirection = 0;
      }
    };

    const updateDragTarget = () => {
      const drag = dragRef.current;
      if (!drag || !drag.started) return;
      const { pageDef, containerRef, zoom } = optsRef.current;
      const container = containerRef.current;
      if (!container) return;

      const flat = flattenPage(pageDef, drag.draggedSubtreeIds);
      const containerRect = container.getBoundingClientRect();
      const cursorY = drag.lastClientY;
      const cursorX = drag.lastClientX;

      let slot = flat.length;
      for (let i = 0; i < flat.length; i++) {
        const el = findRuleElement(container, flat[i].rule.id());
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const mid = r.top + r.height / 2;
        if (cursorY < mid) {
          slot = i;
          break;
        }
      }

      let baseX = containerRect.left;
      for (let i = 0; i < flat.length; i++) {
        const el = findRuleElement(container, flat[i].rule.id());
        if (!el) continue;
        const r = el.getBoundingClientRect();
        baseX = r.left - flat[i].depth * INDENT_PX * zoom;
        break;
      }

      const rawDepth = Math.round((cursorX - baseX) / (INDENT_PX * zoom));

      const prev = slot > 0 ? flat[slot - 1] : undefined;
      let maxDepth = prev ? prev.depth + 1 : 0;
      const depthCap = kMaxBrainRuleDepth - drag.draggedSubtreeMaxDepth;
      if (maxDepth > depthCap) maxDepth = depthCap;
      if (maxDepth < 0) maxDepth = 0;

      let depth = rawDepth;
      if (depth < 0) depth = 0;
      if (depth > maxDepth) depth = maxDepth;

      const target = resolveTarget(pageDef, flat, slot, depth);
      const current = captureLocation(drag.rule);
      if (locationsEqual(current, target)) return;

      drag.rule.moveTo(target.parentRule, target.pageDef, target.index);
    };

    const tickAutoScroll = () => {
      const drag = dragRef.current;
      if (!drag) return;
      const { containerRef } = optsRef.current;
      const container = containerRef.current;
      if (!container) return;
      if (drag.autoScrollDirection === 0) {
        drag.autoScrollFrame = null;
        return;
      }
      const rect = container.getBoundingClientRect();
      let rate = 0;
      if (drag.autoScrollDirection < 0) {
        const dist = rect.top + AUTO_SCROLL_EDGE_PX - drag.lastClientY;
        rate = -Math.min(AUTO_SCROLL_MAX_RATE, (Math.max(0, dist) / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_RATE);
      } else {
        const dist = drag.lastClientY - (rect.bottom - AUTO_SCROLL_EDGE_PX);
        rate = Math.min(AUTO_SCROLL_MAX_RATE, (Math.max(0, dist) / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_RATE);
      }
      if (rate !== 0) {
        container.scrollTop += rate;
        updateDragTarget();
      }
      drag.autoScrollFrame = requestAnimationFrame(tickAutoScroll);
    };

    const updateAutoScroll = () => {
      const drag = dragRef.current;
      if (!drag || !drag.started) return;
      const { containerRef } = optsRef.current;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      let direction = 0;
      if (drag.lastClientY < rect.top + AUTO_SCROLL_EDGE_PX) direction = -1;
      else if (drag.lastClientY > rect.bottom - AUTO_SCROLL_EDGE_PX) direction = 1;

      if (direction !== drag.autoScrollDirection) {
        drag.autoScrollDirection = direction;
        if (direction !== 0 && drag.autoScrollFrame === null) {
          drag.autoScrollFrame = requestAnimationFrame(tickAutoScroll);
        }
      }
    };

    const finishDrag = (commit: boolean) => {
      const drag = dragRef.current;
      if (!drag) return;
      stopAutoScroll();

      if (drag.ghostEl) {
        drag.ghostEl.remove();
        drag.ghostEl = null;
      }

      const handlers = handlersRef.current;
      if (handlers) {
        window.removeEventListener("pointermove", handlers.move);
        window.removeEventListener("pointerup", handlers.up);
        window.removeEventListener("pointercancel", handlers.cancel);
        window.removeEventListener("keydown", handlers.keydown);
      }

      try {
        if (drag.started) {
          if (commit) {
            const finalLocation = captureLocation(drag.rule);
            if (!locationsEqual(drag.origin, finalLocation)) {
              optsRef.current.commandHistory.recordCommand(new MoveRuleCommand(drag.rule, drag.origin, finalLocation));
            }
          } else {
            const current = captureLocation(drag.rule);
            if (!locationsEqual(current, drag.origin)) {
              drag.rule.moveTo(drag.origin.parentRule, drag.origin.pageDef, drag.origin.index);
            }
          }
        }
      } finally {
        dragRef.current = null;
        setDraggingRuleId(null);
      }
    };

    handlersRef.current = {
      move: (ev: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag || ev.pointerId !== drag.pointerId) return;
        drag.lastClientX = ev.clientX;
        drag.lastClientY = ev.clientY;

        if (!drag.started) {
          const dx = ev.clientX - drag.startClientX;
          const dy = ev.clientY - drag.startClientY;
          if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
          drag.started = true;

          const container = optsRef.current.containerRef.current;
          const sourceEl = container ? findRuleElement(container, drag.rule.id()) : null;
          if (sourceEl) {
            const { el: ghost, rect } = createGhostElement(sourceEl, optsRef.current.zoom);
            drag.ghostEl = ghost;
            drag.ghostOffsetX = drag.startClientX - rect.left;
            drag.ghostOffsetY = drag.startClientY - rect.top;
          }

          setDraggingRuleId(drag.rule.id());
        }

        if (drag.ghostEl) {
          drag.ghostEl.style.left = `${ev.clientX - drag.ghostOffsetX}px`;
          drag.ghostEl.style.top = `${ev.clientY - drag.ghostOffsetY}px`;
        }

        ev.preventDefault();
        updateDragTarget();
        updateAutoScroll();
      },
      up: (ev: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag || ev.pointerId !== drag.pointerId) return;
        finishDrag(true);
      },
      cancel: (ev: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag || ev.pointerId !== drag.pointerId) return;
        finishDrag(false);
      },
      keydown: (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        const drag = dragRef.current;
        if (!drag) return;
        ev.preventDefault();
        finishDrag(false);
      },
    };

    return () => {
      const drag = dragRef.current;
      const handlers = handlersRef.current;
      if (drag && handlers) {
        if (drag.autoScrollFrame !== null) {
          cancelAnimationFrame(drag.autoScrollFrame);
        }
        if (drag.ghostEl) {
          drag.ghostEl.remove();
          drag.ghostEl = null;
        }
        window.removeEventListener("pointermove", handlers.move);
        window.removeEventListener("pointerup", handlers.up);
        window.removeEventListener("pointercancel", handlers.cancel);
        window.removeEventListener("keydown", handlers.keydown);
        dragRef.current = null;
      }
      handlersRef.current = null;
    };
  }, []);

  const beginDrag = useCallback((rule: BrainRuleDef, event: React.PointerEvent<HTMLElement>): boolean => {
    if (event.pointerType === "mouse" && event.button !== 0) return false;
    if (dragRef.current) return false;
    const handlers = handlersRef.current;
    if (!handlers) return false;

    const origin = captureLocation(rule);
    const subtreeIds = collectSubtreeIds(rule);

    dragRef.current = {
      rule,
      origin,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      started: false,
      draggedSubtreeIds: subtreeIds,
      draggedSubtreeMaxDepth: rule.maxDepth(),
      autoScrollFrame: null,
      autoScrollDirection: 0,
      ghostEl: null,
      ghostOffsetX: 0,
      ghostOffsetY: 0,
    };

    window.addEventListener("pointermove", handlers.move);
    window.addEventListener("pointerup", handlers.up);
    window.addEventListener("pointercancel", handlers.cancel);
    window.addEventListener("keydown", handlers.keydown);

    return true;
  }, []);

  return { draggingRuleId, beginDrag };
}
