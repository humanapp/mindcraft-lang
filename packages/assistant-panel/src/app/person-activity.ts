import { kBrainRulesAttribute } from "@wendoo-lang/ui/brain-editor/rules-region";

/**
 * Milliseconds after the person last touched a brain's rules that the brain
 * counts as being interacted with.
 */
export const personInteractionWindowMs = 4000;

/**
 * What the person has been doing to a brain's rules: whether they touched them
 * within {@link personInteractionWindowMs}, and how many times they changed the
 * document.
 *
 * Records are per brain and are fed by whoever watches the editor. A brain
 * nothing has been noted for reads as untouched and unchanged.
 */
export interface PersonActivity {
  /** Note the person acting on `brainId`'s rules. */
  noteInteraction(brainId: string): void;
  /** Note the person changing `brainId`'s document. */
  noteMutation(brainId: string): void;
  /** Whether the person touched `brainId`'s rules within {@link personInteractionWindowMs}. */
  isInteracting(brainId: string): boolean;
  /** How many changes the person has made to `brainId`'s document. Never decreases. */
  mutations(brainId: string): number;
}

/** What one activity record is built over. */
export interface PersonActivityOptions {
  /** Milliseconds since an arbitrary fixed point; `Date.now` when absent. */
  readonly now?: () => number;
}

/**
 * Build the record the panel reads the person's activity from. Nothing feeds it
 * on its own: {@link watchPersonInteraction} feeds the interactions, and
 * whoever watches the document's command history feeds the changes.
 */
export function createPersonActivity(options?: PersonActivityOptions): PersonActivity {
  const now = options?.now ?? Date.now;
  const touchedAt = new Map<string, number>();
  const changes = new Map<string, number>();

  return {
    noteInteraction: (brainId: string): void => {
      touchedAt.set(brainId, now());
    },
    noteMutation: (brainId: string): void => {
      changes.set(brainId, (changes.get(brainId) ?? 0) + 1);
    },
    isInteracting: (brainId: string): boolean => {
      const at = touchedAt.get(brainId);
      return at !== undefined && now() - at < personInteractionWindowMs;
    },
    mutations: (brainId: string): number => changes.get(brainId) ?? 0,
  };
}

/** The event types the person's activity on the rules is read from. */
const watchedEventTypes = ["pointerdown", "pointermove", "keydown", "focusin"] as const;

/**
 * Whether an event of `type` with `buttons` pressed counts as the person
 * acting. Every watched type counts except a pointer moving with no button
 * down, which is the pointer passing over the rules.
 */
export function countsAsInteraction(type: string, buttons: number | undefined): boolean {
  return type !== "pointermove" || (buttons ?? 0) !== 0;
}

/**
 * Note on `activity` every event in `doc` that is the person acting on
 * `brainId`'s rules, until the returned stop is called. Events landing outside
 * the rules region -- the editor's chrome, the side region, the rest of the
 * page -- are left alone.
 */
export function watchPersonInteraction(activity: PersonActivity, brainId: string, doc: Document): () => void {
  const note = (event: Event): void => {
    const buttons = (event as PointerEvent).buttons;
    if (!countsAsInteraction(event.type, buttons)) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest(`[${kBrainRulesAttribute}]`) === null) return;
    activity.noteInteraction(brainId);
  };
  for (const type of watchedEventTypes) doc.addEventListener(type, note, true);
  return () => {
    for (const type of watchedEventTypes) doc.removeEventListener(type, note, true);
  };
}
