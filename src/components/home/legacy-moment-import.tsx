"use client";

import { useEffect, useRef, useState } from "react";

import { ArchiveRestore, Check, ShieldAlert, Trash2 } from "lucide-react";

import type { Moment } from "@/data/moments";
import type {
  LegacyImportCandidate,
  LegacyInspection,
  LegacySkippedItem,
} from "@/lib/legacy-moment-import";
import {
  ApiLegacyMomentImportRepository,
  ApiLegacyMomentImportRepositoryError,
  type LegacyMomentImportApiResult,
} from "@/repositories/api-legacy-moment-import-repository";
import { BrowserLegacyImportCoordination } from "@/repositories/legacy-import-coordination";
import {
  LegacyMomentSourceError,
  LocalStorageLegacyMomentSource,
  type LegacyImportAssociation,
  type LegacySourceInspection,
} from "@/repositories/local-storage-legacy-moment-source";

type LegacyMomentImportProps = {
  userId: string;
  onImportedMoment: (moment: Moment) => void;
};

type ItemResult = {
  candidate: LegacyImportCandidate;
  kind: "imported" | "failed" | "conflicted" | "image-mismatch";
  imageComplete: boolean;
  result?: LegacyMomentImportApiResult;
};

type PanelError =
  | "association-other"
  | "association-pending-current"
  | "association-pending-other"
  | "association-corrupt"
  | "claim-lost"
  | "claim-persistence"
  | "source-unavailable"
  | "source-invalid"
  | "cleanup-failed";

const imageIssueLabels = {
  INVALID_IMAGE_DATA: "Will import without its corrupted image.",
  UNSUPPORTED_IMAGE_TYPE: "Will import without its unsupported image.",
  IMAGE_TOO_LARGE: "Will import without its oversized image.",
  IMAGE_SIGNATURE_MISMATCH:
    "Will import without its image because its contents do not match its type.",
} as const;

const skipReasonLabels = {
  NOT_AN_OBJECT: "The local entry is not a Moment.",
  INVALID_SOURCE_ID: "The Moment has no valid local identifier.",
  DUPLICATE_SOURCE_ID: "The local identifier is duplicated.",
  INVALID_TITLE: "The title is missing or too long.",
  INVALID_DESCRIPTION: "The description is missing or too long.",
  INVALID_MOOD: "The mood is not supported.",
  INVALID_DATE_TIME: "The date or time is invalid.",
} as const;

function resultSummary(
  inspection: Extract<LegacyInspection, { kind: "ready" }>,
  results: ReadonlyMap<string, ItemResult>,
) {
  let imported = 0;
  let failed = 0;
  for (const result of results.values()) {
    if (result.kind === "imported") imported += 1;
    else failed += 1;
  }
  return `${imported} imported, ${failed} failed, ${inspection.skipped.length} skipped.`;
}

function errorMessage(error: PanelError) {
  switch (error) {
    case "association-other":
      return "This browser’s legacy Moments were already associated with another account.";
    case "association-pending-current":
      return "This account already has a legacy import in progress in another tab.";
    case "association-pending-other":
      return "Another account is currently importing this browser’s legacy Moments. Wait for that import to finish or for its claim to expire.";
    case "association-corrupt":
      return "The local import association cannot be verified. No Moments were imported.";
    case "claim-lost":
      return "The browser import claim changed in another tab, so this import was stopped before continuing.";
    case "claim-persistence":
      return "The cloud import succeeded, but its local association could not be finalized. This browser remains locked to this pending import for safety.";
    case "source-unavailable":
      return "Browser storage is unavailable, so legacy Moments cannot be reviewed.";
    case "source-invalid":
      return "The legacy Moment data cannot be safely read. It has not been changed.";
    case "cleanup-failed":
      return "The cloud Moments are safe, but the local cleanup could not be completed.";
  }
}

function CandidateRow({
  candidate,
  result,
}: {
  candidate: LegacyImportCandidate;
  result?: ItemResult;
}) {
  return (
    <li className="border-t border-white/[0.08] py-4 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-primary">{candidate.title}</p>
          <p className="mt-1 text-xs uppercase tracking-[0.12em] text-secondary/75">
            {candidate.date} · {candidate.time.slice(0, 5)} · {candidate.mood}
          </p>
        </div>
        {result?.kind === "imported" ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-champagne">
            <Check aria-hidden="true" className="size-4" /> Imported
          </span>
        ) : result ? (
          <span className="text-xs font-medium text-rose-soft">
            {result.kind === "conflicted"
              ? "Changed locally"
              : result.kind === "image-mismatch"
                ? "Image differs"
                : "Try again"}
          </span>
        ) : null}
      </div>
      {candidate.imageIssue ? (
        <p className="mt-2 text-sm leading-6 text-rose-soft">
          {result?.kind === "imported"
            ? "Imported without image; kept locally for review."
            : imageIssueLabels[candidate.imageIssue]}
        </p>
      ) : null}
      {result?.kind === "image-mismatch" ? (
        <p className="mt-2 text-sm leading-6 text-rose-soft">
          Cloud image differs; kept locally for retry.
        </p>
      ) : null}
    </li>
  );
}

function SkippedRow({ item }: { item: LegacySkippedItem }) {
  return (
    <li className="border-t border-white/[0.08] py-4 first:border-t-0">
      <p className="font-medium text-secondary">{item.title}</p>
      <p className="mt-1 text-sm leading-6 text-secondary/75">
        {skipReasonLabels[item.reason]}
      </p>
    </li>
  );
}

export function LegacyMomentImport({
  userId,
  onImportedMoment,
}: LegacyMomentImportProps) {
  const sourceRef = useRef<LocalStorageLegacyMomentSource | null>(null);
  const apiRef = useRef<ApiLegacyMomentImportRepository | null>(null);
  const operationInProgressRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const activeClaimRef = useRef<{
    claimId: string;
    cloudSucceeded: boolean;
  } | null>(null);
  const [inspection, setInspection] = useState<LegacySourceInspection | null>(
    null,
  );
  const [results, setResults] = useState<Map<string, ItemResult>>(new Map());
  const [panelError, setPanelError] = useState<PanelError | null>(null);
  const [isInspecting, setIsInspecting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [confirmingCleanup, setConfirmingCleanup] = useState(false);
  const [cleanupStatus, setCleanupStatus] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      const activeClaim = activeClaimRef.current;
      if (activeClaim && !activeClaim.cloudSucceeded) {
        const release = sourceRef.current?.releaseClaim(
          userId,
          activeClaim.claimId,
        );
        void release?.catch(() => undefined);
      }
      unsubscribeRef.current?.();
      sourceRef.current?.close();
    };
  }, [userId]);

  function panelErrorForAssociation(
    association: LegacyImportAssociation,
  ): PanelError | null {
    switch (association) {
      case "other":
        return "association-other";
      case "pending-current":
        return "association-pending-current";
      case "pending-other":
        return "association-pending-other";
      case "corrupt":
        return "association-corrupt";
      default:
        return null;
    }
  }

  async function handleImportStateChange() {
    const localSource = sourceRef.current;
    if (!localSource) return;
    const activeClaim = activeClaimRef.current;
    if (
      activeClaim &&
      (await localSource.verifyClaim(userId, activeClaim.claimId))
    ) {
      return;
    }

    const association = await localSource.associationFor(userId);
    if (association === "current" || association === "unbound") return;
    abortRef.current?.abort();
    activeClaimRef.current = null;
    setInspection(null);
    setPanelError(
      panelErrorForAssociation(association) ?? "claim-lost",
    );
  }

  function source() {
    if (!sourceRef.current) {
      const coordination = new BrowserLegacyImportCoordination();
      sourceRef.current = new LocalStorageLegacyMomentSource(
        window.localStorage,
        { coordination },
      );
      unsubscribeRef.current = sourceRef.current.subscribe(() => {
        void handleImportStateChange().catch(() => {
          abortRef.current?.abort();
          setInspection(null);
          setPanelError("claim-lost");
        });
      });
    }
    return sourceRef.current;
  }

  function api() {
    apiRef.current ??= new ApiLegacyMomentImportRepository();
    return apiRef.current;
  }

  async function reviewLegacyMoments() {
    if (operationInProgressRef.current) return;
    operationInProgressRef.current = true;
    setIsInspecting(true);
    setPanelError(null);
    setCleanupStatus(null);
    try {
      const association = await source().associationFor(userId);
      const associationError = panelErrorForAssociation(association);
      if (associationError) {
        setPanelError(associationError);
        return;
      }
      const nextInspection = await source().inspect();
      setInspection(nextInspection);
      if (nextInspection.kind === "unavailable") {
        setPanelError("source-unavailable");
      } else if (nextInspection.kind === "error") {
        setPanelError("source-invalid");
      }
    } finally {
      operationInProgressRef.current = false;
      setIsInspecting(false);
    }
  }

  async function importCandidates(candidates: readonly LegacyImportCandidate[]) {
    if (operationInProgressRef.current || candidates.length === 0) return;
    operationInProgressRef.current = true;
    setIsImporting(true);
    setPanelError(null);
    setCleanupStatus(null);
    setProgress({ current: 0, total: candidates.length });
    const controller = new AbortController();
    abortRef.current = controller;
    let operationClaim = activeClaimRef.current;
    let associationFinalized = false;
    let canSafelyReleaseClaim = true;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    try {
      const association = await source().associationFor(userId);
      if (association === "current") {
        operationClaim = null;
        activeClaimRef.current = null;
        associationFinalized = true;
      } else if (association === "pending-current" && operationClaim) {
        if (!(await source().verifyClaim(userId, operationClaim.claimId))) {
          setPanelError("claim-lost");
          setInspection(null);
          return;
        }
      } else if (association === "unbound") {
        const acquired = await source().acquireClaim(userId);
        if (acquired.status === "blocked") {
          setPanelError(
            panelErrorForAssociation(acquired.association) ?? "claim-lost",
          );
          setInspection(null);
          return;
        }
        operationClaim = {
          claimId: acquired.claimId,
          cloudSucceeded: false,
        };
        activeClaimRef.current = operationClaim;
      } else {
        setPanelError(panelErrorForAssociation(association) ?? "claim-lost");
        setInspection(null);
        return;
      }

      if (operationClaim && !associationFinalized) {
        heartbeat = setInterval(() => {
          const activeClaim = activeClaimRef.current;
          if (
            !activeClaim ||
            activeClaim.claimId !== operationClaim?.claimId
          ) {
            return;
          }
          void source()
            .renewClaim(userId, activeClaim.claimId)
            .then(async (renewed) => {
              if (renewed) return;
              if ((await source().associationFor(userId)) === "current") {
                return;
              }
              controller.abort();
              activeClaimRef.current = null;
              setInspection(null);
              setPanelError("claim-lost");
            })
            .catch(() => {
              controller.abort();
              setPanelError("claim-lost");
            });
        }, 30_000);
      }

      for (const [index, candidate] of candidates.entries()) {
        if (controller.signal.aborted) break;
        if (
          index > 0 &&
          operationClaim &&
          !associationFinalized &&
          !(await source().renewClaim(userId, operationClaim.claimId))
        ) {
          controller.abort();
          activeClaimRef.current = null;
          setInspection(null);
          setPanelError("claim-lost");
          break;
        }
        let requestSucceeded = false;
        try {
          const imported = await api().import(candidate, controller.signal);
          requestSucceeded = true;
          if (operationClaim) operationClaim.cloudSucceeded = true;
          if (controller.signal.aborted) break;
          const imageComplete =
            candidate.imageIssue === null &&
            (candidate.image === null ||
              imported.imageOutcome === "uploaded" ||
              imported.imageOutcome === "already_present");
          await source().recordConfirmedImport(
            userId,
            {
              cloudMomentId: imported.moment.id,
              imageComplete,
              localRecordHash: candidate.localRecordHash,
              sourceHash: imported.sourceHash,
              sourceId: imported.sourceId,
            },
            operationClaim?.claimId,
          );
          associationFinalized = true;
          if (heartbeat !== null) {
            clearInterval(heartbeat);
            heartbeat = null;
          }
          onImportedMoment(imported.moment);
          setResults((current) => {
            const next = new Map(current);
            next.set(candidate.sourceId, {
              candidate,
              kind:
                imported.imageOutcome === "mismatch"
                  ? "image-mismatch"
                  : "imported",
              imageComplete,
              result: imported,
            });
            return next;
          });
        } catch (error) {
          if (controller.signal.aborted) break;
          if (
            !(error instanceof ApiLegacyMomentImportRepositoryError) ||
            error.status === undefined ||
            error.status < 400
          ) {
            canSafelyReleaseClaim = false;
          }
          if (requestSucceeded && error instanceof LegacyMomentSourceError) {
            setPanelError("claim-persistence");
          }
          setResults((current) => {
            const next = new Map(current);
            next.set(candidate.sourceId, {
              candidate,
              kind:
                error instanceof ApiLegacyMomentImportRepositoryError &&
                error.code === "IMPORT_SOURCE_CONFLICT"
                  ? "conflicted"
                  : "failed",
              imageComplete: false,
            });
            return next;
          });
        } finally {
          if (!controller.signal.aborted) {
            setProgress({ current: index + 1, total: candidates.length });
          }
        }
      }
    } catch {
      setPanelError(
        operationClaim?.cloudSucceeded ? "claim-persistence" : "claim-lost",
      );
    } finally {
      if (heartbeat !== null) clearInterval(heartbeat);
      if (
        operationClaim &&
        !operationClaim.cloudSucceeded &&
        canSafelyReleaseClaim
      ) {
        try {
          await source().releaseClaim(userId, operationClaim.claimId);
        } catch {
          setPanelError("claim-lost");
        }
        if (activeClaimRef.current?.claimId === operationClaim.claimId) {
          activeClaimRef.current = null;
        }
      } else if (associationFinalized) {
        activeClaimRef.current = null;
      }
      if (abortRef.current === controller) abortRef.current = null;
      operationInProgressRef.current = false;
      setIsImporting(false);
    }
  }

  async function cleanupLocalMoments() {
    if (operationInProgressRef.current) return;
    operationInProgressRef.current = true;
    setPanelError(null);
    try {
      const eligible = Array.from(results.values())
        .filter(
          (result) =>
            result.kind === "imported" &&
            result.imageComplete &&
            result.result,
        )
        .map((result) => ({
          sourceId: result.result!.sourceId,
          sourceHash: result.result!.sourceHash,
          localRecordHash: result.candidate.localRecordHash,
        }));
      const cleaned = await source().cleanupConfirmed(userId, eligible);
      setCleanupStatus(
        `Removed ${cleaned.removed} local ${cleaned.removed === 1 ? "Moment" : "Moments"}; ${cleaned.preserved} preserved.`,
      );
      setConfirmingCleanup(false);
    } catch {
      setPanelError("cleanup-failed");
    } finally {
      operationInProgressRef.current = false;
    }
  }

  const readyInspection =
    inspection?.kind === "ready" ? inspection : undefined;
  const failedCandidates = readyInspection?.candidates.filter((candidate) => {
    const result = results.get(candidate.sourceId);
    return (
      result?.kind === "failed" ||
      result?.kind === "conflicted" ||
      result?.kind === "image-mismatch"
    );
  });
  const cleanupEligibleCount = Array.from(results.values()).filter(
    (result) => result.kind === "imported" && result.imageComplete,
  ).length;
  const importBlocked =
    panelError === "association-other" ||
    panelError === "association-pending-current" ||
    panelError === "association-pending-other" ||
    panelError === "association-corrupt" ||
    panelError === "claim-lost";

  return (
    <section
      aria-labelledby="legacy-import-title"
      className="border-y border-white/[0.08] bg-elevated/45 py-14 sm:py-16"
    >
      <div className="mx-auto w-full max-w-[1120px] px-5 sm:px-8 lg:px-12">
        <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-14">
          <div>
            <p className="eyebrow">From this browser</p>
            <h2
              id="legacy-import-title"
              className="mt-3 font-display text-[clamp(2.15rem,4vw,3.45rem)] leading-none tracking-[-0.035em] text-primary"
            >
              Bring your earlier Moments with you.
            </h2>
            <p className="mt-5 max-w-xl text-sm leading-7 text-secondary sm:text-base">
              Review what is stored on this browser, then choose what to import.
              Nothing is moved or removed automatically.
            </p>
            {!readyInspection ? (
              <button
                type="button"
                disabled={isInspecting}
                onClick={() => void reviewLegacyMoments()}
                className="button-secondary mt-7 inline-flex min-h-11 items-center justify-center gap-2 px-5 text-sm font-medium disabled:cursor-wait disabled:opacity-60"
              >
                <ArchiveRestore aria-hidden="true" className="size-4" />
                {isInspecting ? "Reviewing…" : "Review legacy Moments"}
              </button>
            ) : null}
          </div>

          <div
            aria-busy={isInspecting || isImporting}
            className="min-w-0 rounded-sm border border-white/[0.09] bg-surface/65 p-5 shadow-ritual sm:p-7"
          >
            {!inspection && !panelError ? (
              <p className="text-sm leading-7 text-secondary">
                Your local data stays private until you choose to review it.
              </p>
            ) : null}

            {inspection?.kind === "missing" ? (
              <p role="status" className="text-sm leading-7 text-secondary">
                No legacy Moments were found on this browser.
              </p>
            ) : null}

            {panelError ? (
              <div
                role="alert"
                aria-label={
                  panelError === "association-other"
                    ? "Legacy Moments belong to another account"
                    : panelError === "association-pending-current" ||
                        panelError === "association-pending-other" ||
                        panelError === "claim-lost"
                      ? "Legacy Moment import in progress"
                      : "Legacy Moment import unavailable"
                }
                className="rounded-sm border border-rose/30 bg-rose/[0.08] p-4"
              >
                <p className="flex items-start gap-3 text-sm leading-6 text-rose-soft">
                  <ShieldAlert aria-hidden="true" className="mt-1 size-4 shrink-0" />
                  {errorMessage(panelError)}
                </p>
              </div>
            ) : null}

            {readyInspection && !importBlocked ? (
              <div>
                <div className="flex flex-wrap gap-2" aria-label="Import preview totals">
                  <span className="rounded-full border border-champagne/25 bg-champagne/[0.06] px-3 py-1.5 text-xs font-medium text-champagne">
                    {readyInspection.candidates.length} ready to import
                  </span>
                  <span className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-secondary">
                    {readyInspection.skipped.length} skipped
                  </span>
                </div>

                {readyInspection.candidates.length > 0 ? (
                  <div className="mt-6">
                    <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-secondary/80">
                      Importable Moments
                    </h3>
                    <ul className="mt-2">
                      {readyInspection.candidates.map((candidate) => (
                        <CandidateRow
                          key={candidate.sourceId}
                          candidate={candidate}
                          result={results.get(candidate.sourceId)}
                        />
                      ))}
                    </ul>
                  </div>
                ) : null}

                {readyInspection.skipped.length > 0 ? (
                  <details className="mt-5 border-t border-white/[0.08] pt-5">
                    <summary className="min-h-11 cursor-pointer text-sm font-medium text-secondary focus-visible:outline-none">
                      Review {readyInspection.skipped.length} skipped local {readyInspection.skipped.length === 1 ? "entry" : "entries"}
                    </summary>
                    <ul>
                      {readyInspection.skipped.map((item) => (
                        <SkippedRow key={item.sourceIndex} item={item} />
                      ))}
                    </ul>
                  </details>
                ) : null}

                {isImporting ? (
                  <div className="mt-6" role="status" aria-live="polite">
                    <p className="text-sm text-primary">
                      Importing {progress.current} of {progress.total}…
                    </p>
                    <progress
                      aria-label="Legacy Moment import progress"
                      className="mt-3 h-2 w-full accent-rose"
                      max={progress.total}
                      value={progress.current}
                    />
                  </div>
                ) : null}

                {results.size > 0 && !isImporting ? (
                  <p
                    role="status"
                    aria-live="polite"
                    className="mt-5 text-sm font-medium text-champagne"
                  >
                    {resultSummary(readyInspection, results)}
                  </p>
                ) : null}

                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  {results.size === 0 && readyInspection.candidates.length > 0 ? (
                    <button
                      type="button"
                      disabled={isImporting}
                      onClick={() => void importCandidates(readyInspection.candidates)}
                      className="button-primary inline-flex min-h-11 items-center justify-center px-5 text-sm font-medium disabled:cursor-wait disabled:opacity-60"
                    >
                      Import {readyInspection.candidates.length} {readyInspection.candidates.length === 1 ? "Moment" : "Moments"}
                    </button>
                  ) : null}
                  {failedCandidates && failedCandidates.length > 0 && !isImporting ? (
                    <button
                      type="button"
                      onClick={() => void importCandidates(failedCandidates)}
                      className="button-primary inline-flex min-h-11 items-center justify-center px-5 text-sm font-medium"
                    >
                      Retry {failedCandidates.length} failed {failedCandidates.length === 1 ? "Moment" : "Moments"}
                    </button>
                  ) : null}
                  {cleanupEligibleCount > 0 && !confirmingCleanup ? (
                    <button
                      type="button"
                      onClick={() => setConfirmingCleanup(true)}
                      className="button-secondary inline-flex min-h-11 items-center justify-center gap-2 px-5 text-sm font-medium"
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                      Remove {cleanupEligibleCount} fully imported local {cleanupEligibleCount === 1 ? "Moment" : "Moments"}
                    </button>
                  ) : null}
                </div>

                {confirmingCleanup ? (
                  <div
                    role="group"
                    aria-label="Confirm local Moment cleanup"
                    className="mt-5 rounded-sm border border-rose/25 bg-rose/[0.07] p-4"
                  >
                    <p className="text-sm leading-6 text-primary">
                      Remove only the unchanged local copies that are fully represented in your cloud account?
                    </p>
                    <div className="mt-3 flex flex-col gap-2 min-[420px]:flex-row">
                      <button
                        type="button"
                        onClick={() => void cleanupLocalMoments()}
                        className="inline-flex min-h-11 items-center justify-center rounded-sm bg-rose px-4 text-sm font-medium text-white transition hover:bg-rose/85"
                      >
                        Remove local copy
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingCleanup(false)}
                        className="inline-flex min-h-11 items-center justify-center rounded-sm border border-white/10 px-4 text-sm font-medium text-secondary transition hover:text-primary"
                      >
                        Keep local data
                      </button>
                    </div>
                  </div>
                ) : null}

                {cleanupStatus ? (
                  <p role="status" className="mt-5 text-sm text-champagne">
                    {cleanupStatus}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
