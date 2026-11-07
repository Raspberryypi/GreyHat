export type Listener<T> = (payload: T) => void;

/** Tiny typed event emitter. `on` returns an unsubscribe function. */
export class Emitter<T> {
  private listeners = new Set<Listener<T>>();

  on(fn: Listener<T>): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  emit(payload: T): void {
    for (const fn of [...this.listeners]) fn(payload);
  }
}
