// jsdom implements no matchMedia, and the theme, reduced motion and the master-detail breakpoint all ask
// it. This is the one boundary stub: a query answers what the current test set, and false otherwise.
type Listener = (event: MediaQueryListEvent) => void;

const answers = new Map<string, boolean>();
const listeners = new Map<string, Set<Listener>>();

export function setMedia(query: string, matches: boolean): void {
  answers.set(query, matches);
  for (const listener of listeners.get(query) ?? []) listener({ matches, media: query } as MediaQueryListEvent);
}

export function resetMedia(): void {
  answers.clear();
  listeners.clear();
}

function subscribe(query: string, listener: Listener): void {
  if (!listeners.has(query)) listeners.set(query, new Set());
  listeners.get(query)!.add(listener);
}

window.matchMedia = (query: string) =>
  ({
    get matches() {
      return answers.get(query) ?? false;
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: Listener) => subscribe(query, listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.get(query)?.delete(listener),
    addListener: (listener: Listener) => subscribe(query, listener),
    removeListener: (listener: Listener) => listeners.get(query)?.delete(listener),
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
