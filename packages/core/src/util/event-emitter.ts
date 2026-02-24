import { Dict } from "../platform/dict";
import { List } from "../platform/list";

export type EventListener<T = unknown> = (data: T) => void;

/**
 * A consumer interface for EventEmitter that only exposes subscription methods.
 * This interface allows safe sharing of event subscription capabilities without
 * exposing the emit method.
 */
export interface EventEmitterConsumer<TEvents extends Record<string, unknown> = Record<string, unknown>> {
  /**
   * Register an event listener for the specified event type.
   * @param event - The event type to listen for
   * @param listener - The callback function to execute when the event is emitted
   * @returns A function to unsubscribe the listener
   */
  on<K extends keyof TEvents>(event: K, listener: EventListener<TEvents[K]>): () => void;

  /**
   * Register a one-time event listener that will be automatically removed after first execution.
   * @param event - The event type to listen for
   * @param listener - The callback function to execute once when the event is emitted
   * @returns A function to unsubscribe the listener before it executes
   */
  once<K extends keyof TEvents>(event: K, listener: EventListener<TEvents[K]>): () => void;

  /**
   * Remove a specific event listener for the specified event type.
   * @param event - The event type
   * @param listener - The specific listener function to remove
   */
  off<K extends keyof TEvents>(event: K, listener: EventListener<TEvents[K]>): void;

  /**
   * Remove all listeners for a specific event type, or all listeners if no event is specified.
   * @param event - Optional event type. If not provided, all listeners are removed.
   */
  removeAllListeners<K extends keyof TEvents>(event?: K): void;

  /**
   * Get the number of listeners for a specific event type.
   * @param event - The event type
   * @returns The number of listeners registered for the event
   */
  listenerCount<K extends keyof TEvents>(event: K): number;

  /**
   * Get all event types that have registered listeners.
   * @returns A list of event types with active listeners
   */
  eventNames(): List<string>;

  /**
   * Check if there are any listeners for a specific event type.
   * @param event - The event type to check
   * @returns True if there are listeners for the event, false otherwise
   */
  hasListeners<K extends keyof TEvents>(event: K): boolean;
}

/**
 * A lightweight event emitter utility class.
 */
export class EventEmitter<TEvents extends Record<string, unknown> = Record<string, unknown>> {
  private listeners = new Dict<string, List<EventListener<unknown>>>();

  /**
   * Register an event listener for the specified event type.
   * @param event - The event type to listen for
   * @param listener - The callback function to execute when the event is emitted
   * @returns A function to unsubscribe the listener
   */
  on<K extends keyof TEvents>(event: K, listener: EventListener<TEvents[K]>): () => void {
    const eventKey = event as string;
    if (!this.listeners.has(eventKey)) {
      this.listeners.set(eventKey, new List<EventListener<unknown>>());
    }
    const eventListeners = this.listeners.get(eventKey)!;
    eventListeners.push(listener as EventListener<unknown>);

    // Return unsubscribe function
    return () => {
      this.off(event, listener);
    };
  }

  /**
   * Register a one-time event listener that will be automatically removed after first execution.
   * @param event - The event type to listen for
   * @param listener - The callback function to execute once when the event is emitted
   * @returns A function to unsubscribe the listener before it executes
   */
  once<K extends keyof TEvents>(event: K, listener: EventListener<TEvents[K]>): () => void {
    const onceWrapper = (data: TEvents[K]) => {
      listener(data);
      this.off(event, onceWrapper);
    };
    return this.on(event, onceWrapper);
  }

  /**
   * Remove a specific event listener for the specified event type.
   * @param event - The event type
   * @param listener - The specific listener function to remove
   */
  off<K extends keyof TEvents>(event: K, listener: EventListener<TEvents[K]>): void {
    const eventKey = event as string;
    const eventListeners = this.listeners.get(eventKey);
    if (!eventListeners) return;

    // Find and remove the listener
    for (let i = 0; i < eventListeners.size(); i++) {
      if (eventListeners.get(i) === listener) {
        eventListeners.remove(i);
        break;
      }
    }

    // Clean up empty listener arrays
    if (eventListeners.isEmpty()) {
      this.listeners.delete(eventKey);
    }
  }

  /**
   * Remove all listeners for a specific event type, or all listeners if no event is specified.
   * @param event - Optional event type. If not provided, all listeners are removed.
   */
  removeAllListeners<K extends keyof TEvents>(event?: K): void {
    if (event !== undefined) {
      const eventKey = event as string;
      this.listeners.delete(eventKey);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Emit an event to all registered listeners for that event type.
   * @param event - The event type to emit
   * @param data - The data to pass to all listeners
   */
  emit<K extends keyof TEvents>(event: K, data: TEvents[K]): void {
    const eventKey = event as string;
    const eventListeners = this.listeners.get(eventKey);
    if (!eventListeners) return;

    // Create a snapshot of listeners to avoid issues with listeners modifying the list during iteration
    const listenersArray: EventListener<TEvents[K]>[] = [];
    eventListeners.forEach((listener) => {
      listenersArray.push(listener as EventListener<TEvents[K]>);
    });

    // Execute all listeners
    for (const listener of listenersArray) {
      try {
        listener(data);
      } catch {
        // Silently continue on error to maintain cross-platform compatibility
      }
    }
  }

  /**
   * Get the number of listeners for a specific event type.
   * @param event - The event type
   * @returns The number of listeners registered for the event
   */
  listenerCount<K extends keyof TEvents>(event: K): number {
    const eventKey = event as string;
    const eventListeners = this.listeners.get(eventKey);
    return eventListeners ? eventListeners.size() : 0;
  }

  /**
   * Get all event types that have registered listeners.
   * @returns A list of event types with active listeners
   */
  eventNames(): List<string> {
    return this.listeners.keys();
  }

  /**
   * Check if there are any listeners for a specific event type.
   * @param event - The event type to check
   * @returns True if there are listeners for the event, false otherwise
   */
  hasListeners<K extends keyof TEvents>(event: K): boolean {
    return this.listenerCount(event) > 0;
  }

  /**
   * Create a consumer interface that only exposes subscription methods.
   * This is useful for sharing event listening capabilities without exposing
   * the ability to emit events.
   * @returns An EventEmitterConsumer that delegates to this emitter
   */
  consumer(): EventEmitterConsumer<TEvents> {
    const self_ = this;
    return {
      on(event, listener) {
        return self_.on(event, listener);
      },
      once(event, listener) {
        return self_.once(event, listener);
      },
      off(event, listener) {
        self_.off(event, listener);
      },
      removeAllListeners(event) {
        self_.removeAllListeners(event);
      },
      listenerCount(event) {
        return self_.listenerCount(event);
      },
      eventNames() {
        return self_.eventNames();
      },
      hasListeners(event) {
        return self_.hasListeners(event);
      },
    };
  }
}
