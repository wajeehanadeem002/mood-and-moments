import { describe, expect, it, vi } from "vitest";

import {
  BrowserLegacyImportCoordination,
  LEGACY_IMPORT_COORDINATION_CHANNEL,
} from "./legacy-import-coordination";
import { LEGACY_IMPORT_STATE_KEY } from "./local-storage-legacy-moment-source";

class FakeBroadcastChannel {
  static channels: FakeBroadcastChannel[] = [];
  readonly listeners = new Set<EventListener>();
  readonly postMessage = vi.fn(() => {
    for (const channel of FakeBroadcastChannel.channels) {
      if (channel !== this) {
        for (const listener of channel.listeners) {
          listener(new MessageEvent("message"));
        }
      }
    }
  });
  readonly close = vi.fn();

  constructor(readonly name: string) {
    FakeBroadcastChannel.channels.push(this);
  }

  addEventListener(_type: "message", listener: EventListener) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "message", listener: EventListener) {
    this.listeners.delete(listener);
  }
}

describe("BrowserLegacyImportCoordination", () => {
  it("notifies another tab through BroadcastChannel when available", () => {
    FakeBroadcastChannel.channels = [];
    const first = new BrowserLegacyImportCoordination({
      broadcastChannel: FakeBroadcastChannel,
      eventTarget: window,
    });
    const second = new BrowserLegacyImportCoordination({
      broadcastChannel: FakeBroadcastChannel,
      eventTarget: window,
    });
    const listener = vi.fn();
    second.subscribe(listener);

    first.publish();

    expect(FakeBroadcastChannel.channels[0]?.name).toBe(
      LEGACY_IMPORT_COORDINATION_CHANNEL,
    );
    expect(listener).toHaveBeenCalledTimes(1);
    first.close();
    second.close();
  });

  it("falls back to matching storage events when BroadcastChannel is unavailable", () => {
    const coordination = new BrowserLegacyImportCoordination({
      broadcastChannel: undefined,
      eventTarget: window,
    });
    const listener = vi.fn();
    coordination.subscribe(listener);

    window.dispatchEvent(
      new StorageEvent("storage", { key: "unrelated-storage-key" }),
    );
    expect(listener).not.toHaveBeenCalled();

    window.dispatchEvent(
      new StorageEvent("storage", { key: LEGACY_IMPORT_STATE_KEY }),
    );
    expect(listener).toHaveBeenCalledTimes(1);
    coordination.close();
  });
});
