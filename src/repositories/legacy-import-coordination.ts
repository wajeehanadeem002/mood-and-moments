export const LEGACY_IMPORT_STATE_KEY =
  "mood-and-moments.legacy-import-state.v1";
export const LEGACY_IMPORT_COORDINATION_CHANNEL =
  "mood-and-moments.legacy-import-claims.v1";

export interface LegacyImportCoordination {
  close(): void;
  publish(): void;
  settle(): Promise<void>;
  subscribe(listener: () => void): () => void;
}

type BroadcastChannelLike = {
  addEventListener(type: "message", listener: EventListener): void;
  close(): void;
  postMessage(message: unknown): void;
  removeEventListener(type: "message", listener: EventListener): void;
};

type BroadcastChannelConstructor = new (name: string) => BroadcastChannelLike;

type BrowserLegacyImportCoordinationOptions = {
  broadcastChannel?: BroadcastChannelConstructor;
  eventTarget?: Pick<Window, "addEventListener" | "removeEventListener">;
};

export class BrowserLegacyImportCoordination
  implements LegacyImportCoordination
{
  private readonly channel: BroadcastChannelLike | null;
  private readonly eventTarget: Pick<
    Window,
    "addEventListener" | "removeEventListener"
  >;
  private readonly listeners = new Set<() => void>();

  private readonly handleBroadcast = () => {
    this.notifyListeners();
  };

  private readonly handleStorage = (event: StorageEvent) => {
    if (event.key === LEGACY_IMPORT_STATE_KEY) this.notifyListeners();
  };

  constructor(options: BrowserLegacyImportCoordinationOptions = {}) {
    this.eventTarget = options.eventTarget ?? window;
    const Broadcast = Object.hasOwn(options, "broadcastChannel")
      ? options.broadcastChannel
      : globalThis.BroadcastChannel;
    let channel: BroadcastChannelLike | null = null;
    try {
      channel = Broadcast
        ? new Broadcast(LEGACY_IMPORT_COORDINATION_CHANNEL)
        : null;
    } catch {
      channel = null;
    }
    this.channel = channel;
    this.channel?.addEventListener("message", this.handleBroadcast);
    this.eventTarget.addEventListener("storage", this.handleStorage);
  }

  publish() {
    this.channel?.postMessage({ type: "legacy-import-state-changed" });
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async settle() {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  close() {
    this.channel?.removeEventListener("message", this.handleBroadcast);
    this.channel?.close();
    this.eventTarget.removeEventListener("storage", this.handleStorage);
    this.listeners.clear();
  }

  private notifyListeners() {
    for (const listener of this.listeners) listener();
  }
}
