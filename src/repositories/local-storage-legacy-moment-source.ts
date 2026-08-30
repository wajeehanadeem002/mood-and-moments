import {
  inspectLegacyMomentValue,
  sha256Text,
  type LegacyInspection,
} from "@/lib/legacy-moment-import";
import {
  LEGACY_IMPORT_STATE_KEY,
  type LegacyImportCoordination,
} from "@/repositories/legacy-import-coordination";

export const LEGACY_MOMENTS_STORAGE_KEY = "mood-and-moments.moments.v1";
export { LEGACY_IMPORT_STATE_KEY };
export const LEGACY_IMPORT_CLAIM_LEASE_MS = 120_000;

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
  bindingClaimId?: string;
  claim?: {
    accountFingerprint: string;
    claimId: string;
    acquiredAt: string;
    expiresAt: string;
  };
};

export type LegacyImportAssociation =
  | "unbound"
  | "pending-current"
  | "pending-other"
  | "current"
  | "other"
  | "corrupt";

export type LegacyImportClaimResult =
  | { status: "acquired"; claimId: string; expiresAt: string }
  | {
      status: "blocked";
      association: Exclude<LegacyImportAssociation, "unbound">;
    };

type LocalStorageLegacyMomentSourceOptions = {
  coordination?: LegacyImportCoordination;
  createClaimId?: () => string;
  now?: () => Date;
};

function createSecureClaimId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  );
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

export type LegacySourceInspection =
  | LegacyInspection
  | { kind: "missing" }
  | { kind: "unavailable" };

function isState(value: unknown): value is StoredImportState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  const receipts = state.receipts;
  const claim = state.claim;
  const validClaim =
    claim === undefined ||
    (typeof claim === "object" &&
      claim !== null &&
      !Array.isArray(claim) &&
      typeof (claim as Record<string, unknown>).accountFingerprint === "string" &&
      /^[a-f0-9]{64}$/.test(
        (claim as Record<string, unknown>).accountFingerprint as string,
      ) &&
      typeof (claim as Record<string, unknown>).claimId === "string" &&
      ((claim as Record<string, unknown>).claimId as string).length > 0 &&
      ((claim as Record<string, unknown>).claimId as string).length <= 128 &&
      typeof (claim as Record<string, unknown>).acquiredAt === "string" &&
      !Number.isNaN(
        new Date(
          (claim as Record<string, unknown>).acquiredAt as string,
        ).valueOf(),
      ) &&
      typeof (claim as Record<string, unknown>).expiresAt === "string" &&
      !Number.isNaN(
        new Date(
          (claim as Record<string, unknown>).expiresAt as string,
        ).valueOf(),
      ));
  return (
    state.version === 1 &&
    typeof state.accountFingerprint === "string" &&
    /^[a-f0-9]{64}$/.test(state.accountFingerprint) &&
    (state.bindingClaimId === undefined ||
      (typeof state.bindingClaimId === "string" &&
        state.bindingClaimId.length > 0 &&
        state.bindingClaimId.length <= 128)) &&
    validClaim &&
    (claim === undefined ||
      (claim as Record<string, unknown>).accountFingerprint ===
        state.accountFingerprint) &&
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
  private readonly coordination?: LegacyImportCoordination;
  private readonly createClaimId: () => string;
  private readonly now: () => Date;

  constructor(
    private readonly storage: Storage,
    options: LocalStorageLegacyMomentSourceOptions = {},
  ) {
    this.coordination = options.coordination;
    this.createClaimId = options.createClaimId ?? createSecureClaimId;
    this.now = options.now ?? (() => new Date());
  }

  async inspect(): Promise<LegacySourceInspection> {
    let raw: string | null;
    try {
      raw = this.storage.getItem(LEGACY_MOMENTS_STORAGE_KEY);
    } catch {
      return { kind: "unavailable" };
    }
    return raw === null ? { kind: "missing" } : inspectLegacyMomentValue(raw);
  }

  async associationFor(userId: string): Promise<LegacyImportAssociation> {
    const state = this.readState();
    if (state === null) return "unbound";
    if (state === "corrupt") return "corrupt";
    const fingerprint = await sha256Text(userId);
    if (this.isPermanentlyBound(state)) {
      return state.accountFingerprint === fingerprint ? "current" : "other";
    }
    const claimStatus = this.claimStatus(state.claim!);
    if (claimStatus === "invalid") return "corrupt";
    if (claimStatus === "expired") return "unbound";
    return state.claim!.accountFingerprint === fingerprint
      ? "pending-current"
      : "pending-other";
  }

  async acquireClaim(userId: string): Promise<LegacyImportClaimResult> {
    const fingerprint = await sha256Text(userId);
    const association = await this.associationForFingerprint(fingerprint);
    if (association !== "unbound") {
      return { status: "blocked", association };
    }

    const now = this.now();
    const claimId = this.createClaimId();
    if (!claimId || claimId.length > 128) {
      throw new LegacyMomentSourceError(
        "A secure local import claim could not be created.",
      );
    }
    const state: StoredImportState = {
      version: 1,
      accountFingerprint: fingerprint,
      receipts: {},
      claim: {
        accountFingerprint: fingerprint,
        claimId,
        acquiredAt: now.toISOString(),
        expiresAt: new Date(
          now.valueOf() + LEGACY_IMPORT_CLAIM_LEASE_MS,
        ).toISOString(),
      },
    };
    this.writeState(state, "The local import claim could not be saved.");
    await this.coordination?.settle();

    const verified = this.readState();
    if (
      verified === "corrupt" ||
      verified === null ||
      this.isPermanentlyBound(verified) ||
      verified.claim?.accountFingerprint !== fingerprint ||
      verified.claim.claimId !== claimId ||
      this.claimStatus(verified.claim) !== "active"
    ) {
      const nextAssociation = await this.associationForFingerprint(fingerprint);
      if (nextAssociation === "unbound") {
        throw new LegacyMomentSourceError(
          "The local import claim could not be verified.",
        );
      }
      return { status: "blocked", association: nextAssociation };
    }

    return {
      status: "acquired",
      claimId,
      expiresAt: verified.claim.expiresAt,
    };
  }

  async verifyClaim(userId: string, claimId: string): Promise<boolean> {
    const fingerprint = await sha256Text(userId);
    const state = this.readState();
    return Boolean(
      state &&
        state !== "corrupt" &&
        !this.isPermanentlyBound(state) &&
        state.claim?.accountFingerprint === fingerprint &&
        state.claim.claimId === claimId &&
        this.claimStatus(state.claim) === "active",
    );
  }

  async renewClaim(userId: string, claimId: string): Promise<boolean> {
    const fingerprint = await sha256Text(userId);
    const state = this.readState();
    if (
      !state ||
      state === "corrupt" ||
      this.isPermanentlyBound(state) ||
      state.claim?.accountFingerprint !== fingerprint ||
      state.claim.claimId !== claimId ||
      this.claimStatus(state.claim) !== "active"
    ) {
      return false;
    }
    const now = this.now();
    const renewed: StoredImportState = {
      ...state,
      claim: {
        ...state.claim,
        acquiredAt: now.toISOString(),
        expiresAt: new Date(
          now.valueOf() + LEGACY_IMPORT_CLAIM_LEASE_MS,
        ).toISOString(),
      },
    };
    this.writeState(renewed, "The local import claim could not be renewed.");
    return this.verifyClaim(userId, claimId);
  }

  async releaseClaim(userId: string, claimId: string): Promise<boolean> {
    const fingerprint = await sha256Text(userId);
    const state = this.readState();
    if (
      !state ||
      state === "corrupt" ||
      this.isPermanentlyBound(state) ||
      state.claim?.accountFingerprint !== fingerprint ||
      state.claim.claimId !== claimId
    ) {
      return false;
    }
    try {
      this.storage.removeItem(LEGACY_IMPORT_STATE_KEY);
      this.coordination?.publish();
    } catch (cause) {
      throw new LegacyMomentSourceError(
        "The local import claim could not be released.",
        { cause },
      );
    }
    return this.readState() === null;
  }

  subscribe(listener: () => void) {
    return this.coordination?.subscribe(listener) ?? (() => undefined);
  }

  close() {
    this.coordination?.close();
  }

  async recordConfirmedImport(
    userId: string,
    receipt: ImportReceipt,
    claimId?: string,
  ): Promise<void> {
    const fingerprint = await sha256Text(userId);
    const current = this.readState();
    if (current === "corrupt") {
      throw new LegacyMomentSourceError(
        "The local import association cannot be verified.",
      );
    }
    if (claimId) {
      const ownsActiveClaim =
        current !== null &&
        !this.isPermanentlyBound(current) &&
        current.claim?.claimId === claimId &&
        current.claim.accountFingerprint === fingerprint &&
        this.claimStatus(current.claim) === "active";
      const ownsFinalizedOperation =
        current !== null &&
        this.isPermanentlyBound(current) &&
        current.bindingClaimId === claimId;
      if (!ownsActiveClaim && !ownsFinalizedOperation) {
        throw new LegacyMomentSourceError(
          "The pending claim is no longer active for this import.",
        );
      }
    } else {
      if (current !== null && current.accountFingerprint !== fingerprint) {
        throw new LegacyMomentSourceError(
          "Legacy Moments are associated with another account.",
        );
      }
      if (current?.claim && !this.isPermanentlyBound(current)) {
        throw new LegacyMomentSourceError(
          "The pending claim must be confirmed before saving import results.",
        );
      }
    }
    const receipts = current?.receipts ?? {};
    const storedReceipt = {
      ...receipt,
      importedAt: this.now().toISOString(),
    };
    const state: StoredImportState = {
      version: 1,
      accountFingerprint: fingerprint,
      ...(claimId || current?.bindingClaimId
        ? { bindingClaimId: claimId ?? current?.bindingClaimId }
        : {}),
      receipts: {
        ...receipts,
        [receipt.sourceId]: storedReceipt,
      },
    };
    this.writeState(state, "Import confirmation could not be saved locally.");
    await this.coordination?.settle();
    const confirmed = this.readState();
    const confirmedReceipt =
      confirmed && confirmed !== "corrupt"
        ? confirmed.receipts[receipt.sourceId]
        : undefined;
    if (
      !confirmed ||
      confirmed === "corrupt" ||
      !this.isPermanentlyBound(confirmed) ||
      confirmed.accountFingerprint !== fingerprint ||
      (claimId !== undefined && confirmed.bindingClaimId !== claimId) ||
      JSON.stringify(confirmedReceipt) !== JSON.stringify(storedReceipt)
    ) {
      throw new LegacyMomentSourceError(
        "Import confirmation could not be verified locally.",
      );
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

  private async associationForFingerprint(
    fingerprint: string,
  ): Promise<LegacyImportAssociation> {
    const state = this.readState();
    if (state === null) return "unbound";
    if (state === "corrupt") return "corrupt";
    if (this.isPermanentlyBound(state)) {
      return state.accountFingerprint === fingerprint ? "current" : "other";
    }
    const claimStatus = this.claimStatus(state.claim!);
    if (claimStatus === "invalid") return "corrupt";
    if (claimStatus === "expired") return "unbound";
    return state.claim!.accountFingerprint === fingerprint
      ? "pending-current"
      : "pending-other";
  }

  private isPermanentlyBound(state: StoredImportState) {
    return state.claim === undefined || Object.keys(state.receipts).length > 0;
  }

  private claimStatus(claim: NonNullable<StoredImportState["claim"]>) {
    const acquiredAt = new Date(claim.acquiredAt).valueOf();
    const expiresAt = new Date(claim.expiresAt).valueOf();
    const now = this.now().valueOf();
    if (
      !Number.isFinite(acquiredAt) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= acquiredAt ||
      expiresAt - acquiredAt > LEGACY_IMPORT_CLAIM_LEASE_MS ||
      acquiredAt > now + 5_000
    ) {
      return "invalid" as const;
    }
    return expiresAt <= now ? ("expired" as const) : ("active" as const);
  }

  private writeState(state: StoredImportState, message: string) {
    try {
      this.storage.setItem(LEGACY_IMPORT_STATE_KEY, JSON.stringify(state));
      this.coordination?.publish();
    } catch (cause) {
      throw new LegacyMomentSourceError(message, { cause });
    }
  }
}
