import {
  inspectLegacyMomentValue,
  sha256Text,
  type LegacyInspection,
} from "@/lib/legacy-moment-import";

export const LEGACY_MOMENTS_STORAGE_KEY = "mood-and-moments.moments.v1";
export const LEGACY_IMPORT_STATE_KEY = "mood-and-moments.legacy-import-state.v1";

type ImportReceipt = {
  cloudMomentId: string;
  imageComplete: boolean;
  localRecordHash: string;
  sourceHash: string;
  sourceId: string;
};

type StoredImportState = {
  version: 1;
  accountFingerprint: string;
  receipts: Record<string, ImportReceipt & { importedAt: string }>;
};

export type LegacySourceInspection =
  | LegacyInspection
  | { kind: "missing" }
  | { kind: "unavailable" };

function isState(value: unknown): value is StoredImportState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  const receipts = state.receipts;
  return (
    state.version === 1 &&
    typeof state.accountFingerprint === "string" &&
    /^[a-f0-9]{64}$/.test(state.accountFingerprint) &&
    typeof receipts === "object" &&
    receipts !== null &&
    !Array.isArray(receipts) &&
    Object.entries(receipts).every(([sourceId, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
      }
      const receipt = value as Record<string, unknown>;
      return (
        sourceId.length > 0 &&
        receipt.sourceId === sourceId &&
        typeof receipt.cloudMomentId === "string" &&
        receipt.cloudMomentId.length > 0 &&
        typeof receipt.imageComplete === "boolean" &&
        typeof receipt.localRecordHash === "string" &&
        /^[a-f0-9]{64}$/.test(receipt.localRecordHash) &&
        typeof receipt.sourceHash === "string" &&
        /^[a-f0-9]{64}$/.test(receipt.sourceHash) &&
        typeof receipt.importedAt === "string" &&
        !Number.isNaN(new Date(receipt.importedAt).valueOf())
      );
    })
  );
}

export class LegacyMomentSourceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LegacyMomentSourceError";
  }
}

export class LocalStorageLegacyMomentSource {
  constructor(private readonly storage: Storage) {}

  async inspect(): Promise<LegacySourceInspection> {
    let raw: string | null;
    try {
      raw = this.storage.getItem(LEGACY_MOMENTS_STORAGE_KEY);
    } catch {
      return { kind: "unavailable" };
    }
    return raw === null ? { kind: "missing" } : inspectLegacyMomentValue(raw);
  }

  async associationFor(userId: string): Promise<"unbound" | "current" | "other" | "corrupt"> {
    const state = this.readState();
    if (state === null) return "unbound";
    if (state === "corrupt") return "corrupt";
    return state.accountFingerprint === (await sha256Text(userId)) ? "current" : "other";
  }

  async recordConfirmedImport(userId: string, receipt: ImportReceipt): Promise<void> {
    const fingerprint = await sha256Text(userId);
    const current = this.readState();
    if (current === "corrupt") {
      throw new LegacyMomentSourceError(
        "The local import association cannot be verified.",
      );
    }
    if (current !== null && current.accountFingerprint !== fingerprint) {
      throw new LegacyMomentSourceError("Legacy Moments are associated with another account.");
    }
    const receipts = current?.receipts ?? {};
    const state: StoredImportState = {
      version: 1,
      accountFingerprint: fingerprint,
      receipts: {
        ...receipts,
        [receipt.sourceId]: { ...receipt, importedAt: new Date().toISOString() },
      },
    };
    try {
      this.storage.setItem(LEGACY_IMPORT_STATE_KEY, JSON.stringify(state));
    } catch (cause) {
      throw new LegacyMomentSourceError("Import confirmation could not be saved locally.", { cause });
    }
  }

  async cleanupConfirmed(
    userId: string,
    eligible: readonly Pick<
      ImportReceipt,
      "localRecordHash" | "sourceId" | "sourceHash"
    >[],
  ): Promise<{ removed: number; preserved: number }> {
    const state = this.readState();
    if (
      state === null ||
      state === "corrupt" ||
      state.accountFingerprint !== (await sha256Text(userId))
    ) {
      throw new LegacyMomentSourceError("Legacy cleanup is not available for this account.");
    }
    let raw: string | null;
    try {
      raw = this.storage.getItem(LEGACY_MOMENTS_STORAGE_KEY);
    } catch (cause) {
      throw new LegacyMomentSourceError("Legacy cleanup could not verify the local data.", { cause });
    }
    if (raw === null) return { removed: 0, preserved: 0 };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw new LegacyMomentSourceError("Legacy cleanup could not verify the local data.", { cause });
    }
    if (!Array.isArray(parsed)) {
      throw new LegacyMomentSourceError("Legacy cleanup could not verify the local data.");
    }
    const inspection = await inspectLegacyMomentValue(raw);
    if (inspection.kind !== "ready") {
      throw new LegacyMomentSourceError("Legacy cleanup could not verify the local data.");
    }
    const eligibleKeys = new Set(
      eligible
        .filter((item) => {
          const receipt = state.receipts[item.sourceId];
          return (
            receipt?.imageComplete === true &&
            receipt.localRecordHash === item.localRecordHash &&
            receipt.sourceHash === item.sourceHash
          );
        })
        .map((item) => `${item.sourceId}\u0000${item.localRecordHash}`),
    );
    const removableIndexes = new Set(
      inspection.candidates
        .filter((item) =>
          eligibleKeys.has(`${item.sourceId}\u0000${item.localRecordHash}`),
        )
        .map((item) => item.sourceIndex),
    );
    const preserved = parsed.filter((_item, index) => !removableIndexes.has(index));
    if (removableIndexes.size === 0) return { removed: 0, preserved: parsed.length };
    try {
      if (preserved.length === 0) {
        this.storage.removeItem(LEGACY_MOMENTS_STORAGE_KEY);
      } else {
        this.storage.setItem(LEGACY_MOMENTS_STORAGE_KEY, JSON.stringify(preserved));
      }
    } catch (cause) {
      throw new LegacyMomentSourceError("Legacy cleanup could not be saved.", { cause });
    }
    return { removed: removableIndexes.size, preserved: preserved.length };
  }

  private readState(): StoredImportState | "corrupt" | null {
    let raw: string | null;
    try {
      raw = this.storage.getItem(LEGACY_IMPORT_STATE_KEY);
    } catch {
      return "corrupt";
    }
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isState(parsed) ? parsed : "corrupt";
    } catch {
      return "corrupt";
    }
  }
}
