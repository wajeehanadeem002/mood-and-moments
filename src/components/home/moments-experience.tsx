"use client";

import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Hero } from "@/components/home/hero";
import { LegacyMomentImport } from "@/components/home/legacy-moment-import";
import { MemoryTimeline } from "@/components/home/memory-timeline";
import { RecentMoments } from "@/components/home/recent-moments";
import {
  recentMoments,
  timelineMoments,
  type Moment,
} from "@/data/moments";
import {
  createMoment,
  updateMoment,
  type MomentDraft,
  type UpdateMomentOptions,
} from "@/lib/moment-creation";
import {
  ApiMomentRepository,
  ApiMomentRepositoryError,
} from "@/repositories/api-moment-repository";
import {
  MomentConflictError,
  type MomentRepository,
} from "@/repositories/moment-repository";

type HydrationState = "loading" | "ready" | "error";
type MomentConflictState = {
  operation: "delete" | "update";
  currentMoment: Moment;
};

function sortMomentsNewestFirst(moments: readonly Moment[]): Moment[] {
  return [...moments].sort((left, right) =>
    right.dateTime.slice(0, 19).localeCompare(left.dateTime.slice(0, 19)),
  );
}

const staticMomentIds = new Set(
  [...recentMoments, ...timelineMoments].map((moment) => moment.id),
);

const sessionReadinessRetryDelaysMs = [250, 500, 1_000, 2_000, 4_000];

function waitForSessionRetry(delayMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      signal.removeEventListener("abort", cancelRetry);
      resolve();
    }, delayMs);

    function cancelRetry() {
      window.clearTimeout(timeoutId);
      reject(signal.reason);
    }

    signal.addEventListener("abort", cancelRetry, { once: true });
  });
}

async function listMomentsWhenSessionIsReady(
  repository: MomentRepository,
  signal: AbortSignal,
) {
  for (let failedAttempts = 0; ; failedAttempts += 1) {
    try {
      return await repository.list();
    } catch (error) {
      const retryDelay = sessionReadinessRetryDelaysMs[failedAttempts];
      const isSessionReadinessFailure =
        error instanceof ApiMomentRepositoryError && error.status === 401;

      if (
        signal.aborted ||
        !isSessionReadinessFailure ||
        retryDelay === undefined
      ) {
        throw error;
      }

      await waitForSessionRetry(retryDelay, signal);
    }
  }
}

export function MomentsExperience() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const router = useRouter();
  const isAuthenticated = Boolean(isLoaded && isSignedIn && userId);
  const sessionKey = !isLoaded
    ? "loading"
    : isAuthenticated
      ? `signed-in:${userId}`
      : "signed-out";

  return (
    <MomentsExperienceSession
      key={sessionKey}
      isAuthenticated={isAuthenticated}
      isAuthenticationLoading={!isLoaded}
      userId={isAuthenticated ? userId! : null}
      onRequireAuthentication={() => router.push("/sign-in")}
    />
  );
}

type MomentsExperienceSessionProps = {
  isAuthenticated: boolean;
  isAuthenticationLoading: boolean;
  userId: string | null;
  onRequireAuthentication: () => void;
};

function MomentsExperienceSession({
  isAuthenticated,
  isAuthenticationLoading,
  userId,
  onRequireAuthentication,
}: MomentsExperienceSessionProps) {
  const repositoryRef = useRef<MomentRepository | null>(null);
  const mutationInProgressRef = useRef(false);
  const [savedMoments, setSavedMoments] = useState<Moment[]>([]);
  const [hydrationState, setHydrationState] = useState<HydrationState>(
    isAuthenticated || isAuthenticationLoading ? "loading" : "ready",
  );
  const [editingMomentId, setEditingMomentId] = useState<string | null>(null);
  const [editorResetKey, setEditorResetKey] = useState(0);
  const [momentConflict, setMomentConflict] =
    useState<MomentConflictState | null>(null);
  const [isMutationPending, setIsMutationPending] = useState(false);

  useEffect(() => {
    let isCurrent = true;
    const abortController = new AbortController();

    if (!isAuthenticated) {
      return;
    }

    async function loadSavedMoments() {
      const repository = new ApiMomentRepository();
      repositoryRef.current = repository;
      const moments = await listMomentsWhenSessionIsReady(
        repository,
        abortController.signal,
      );

      if (isCurrent) {
        setSavedMoments(
          moments.filter((moment) => !staticMomentIds.has(moment.id)),
        );
        setHydrationState("ready");
      }
    }

    void loadSavedMoments().catch(() => {
      if (isCurrent) {
        setHydrationState("error");
      }
    });

    return () => {
      isCurrent = false;
      abortController.abort();
      repositoryRef.current = null;
    };
  }, [isAuthenticated]);

  async function runMomentMutation<T>(
    mutation: () => Promise<T>,
  ): Promise<T> {
    if (mutationInProgressRef.current) {
      throw new Error("Another Moment change is already in progress.");
    }

    mutationInProgressRef.current = true;
    setIsMutationPending(true);

    try {
      return await mutation();
    } finally {
      mutationInProgressRef.current = false;
      setIsMutationPending(false);
    }
  }

  async function handleCreateMoment(draft: MomentDraft) {
    if (!isAuthenticated) {
      onRequireAuthentication();
      return;
    }

    return runMomentMutation(async () => {
      if (!repositoryRef.current) {
        throw new Error("Moment storage is not ready.");
      }

      const moment = await createMoment(repositoryRef.current, draft);
      setSavedMoments((current) => [moment, ...current]);
    });
  }

  function handleEditMoment(moment: Moment) {
    const savedMoment = savedMoments.find(
      (candidate) => candidate.id === moment.id,
    );

    if (!savedMoment) {
      return;
    }

    setMomentConflict(null);
    setEditingMomentId(savedMoment.id);
    window.requestAnimationFrame(() => {
      const editor = document.getElementById("moods");
      editor?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      editor?.focus({ preventScroll: true });
    });
  }

  async function handleUpdateMoment(
    draft: MomentDraft,
    options: UpdateMomentOptions,
  ) {
    return runMomentMutation(async () => {
      if (!repositoryRef.current || !editingMomentId) {
        throw new Error("Moment storage is not ready.");
      }

      const existingMoment = savedMoments.find(
        (moment) => moment.id === editingMomentId,
      );

      if (!existingMoment) {
        throw new Error("Moment not found.");
      }

      let updatedMoment;
      try {
        updatedMoment = await updateMoment(
          repositoryRef.current,
          existingMoment,
          draft,
          options,
        );
      } catch (error) {
        if (error instanceof MomentConflictError) {
          setMomentConflict({
            operation: "update",
            currentMoment: error.currentMoment,
          });
        }
        throw error;
      }

      setMomentConflict(null);
      setSavedMoments((current) =>
        current.map((moment) =>
          moment.id === updatedMoment.id ? updatedMoment : moment,
        ),
      );
    });
  }

  async function handleDeleteMoment(moment: Moment) {
    return runMomentMutation(async () => {
      if (!repositoryRef.current) {
        throw new Error("Moment storage is not ready.");
      }

      const savedMoment = savedMoments.find(
        (candidate) => candidate.id === moment.id,
      );

      if (!savedMoment) {
        throw new Error("Moment not found.");
      }

      try {
        await repositoryRef.current.delete(
          savedMoment.id,
          savedMoment.revision,
        );
      } catch (error) {
        if (error instanceof MomentConflictError) {
          setMomentConflict({
            operation: "delete",
            currentMoment: error.currentMoment,
          });
        }
        throw error;
      }

      setMomentConflict(null);
      setSavedMoments((current) =>
        current.filter((candidate) => candidate.id !== savedMoment.id),
      );
      setEditingMomentId((current) =>
        current === savedMoment.id ? null : current,
      );
    });
  }

  function handleImportedMoment(moment: Moment) {
    if (staticMomentIds.has(moment.id)) return;
    setSavedMoments((current) => {
      const existing = current.some((candidate) => candidate.id === moment.id);
      return existing
        ? current.map((candidate) =>
            candidate.id === moment.id ? moment : candidate,
          )
        : [moment, ...current];
    });
  }

  function loadLatestConflictedMoment() {
    if (!momentConflict) return;

    const operation = momentConflict.operation;
    const latest = momentConflict.currentMoment;
    setSavedMoments((current) =>
      current.map((moment) => (moment.id === latest.id ? latest : moment)),
    );
    if (
      operation === "update" &&
      editingMomentId === latest.id
    ) {
      setEditorResetKey((current) => current + 1);
    }
    setMomentConflict(null);
    window.requestAnimationFrame(() => {
      const focusTargetId =
        operation === "update"
          ? "moment-title"
          : `edit-moment-${latest.id}`;
      document.getElementById(focusTargetId)?.focus();
    });
  }

  const editingMoment = editingMomentId
    ? (savedMoments.find((moment) => moment.id === editingMomentId) ?? null)
    : null;
  const editableMomentIds = new Set(savedMoments.map((moment) => moment.id));

  const displayedRecentMoments = sortMomentsNewestFirst([
    ...savedMoments,
    ...recentMoments,
  ]);
  const displayedTimelineMoments = sortMomentsNewestFirst([
    ...savedMoments,
    ...timelineMoments,
  ]);

  return (
    <>
      <Hero
        editorResetKey={editorResetKey}
        isHydrating={hydrationState === "loading"}
        loadError={hydrationState === "error"}
        isAuthenticated={isAuthenticated}
        isMutationPending={isMutationPending}
        editingMoment={editingMoment}
        hasVersionConflict={
          momentConflict?.operation === "update" &&
          momentConflict.currentMoment.id === editingMoment?.id
        }
        onCreateMoment={handleCreateMoment}
        onUpdateMoment={handleUpdateMoment}
        onCancelEdit={() => {
          setEditingMomentId(null);
          setMomentConflict(null);
        }}
        onLoadLatestMoment={loadLatestConflictedMoment}
        onRequireAuthentication={onRequireAuthentication}
      />
      {isAuthenticated && userId ? (
        <LegacyMomentImport
          userId={userId}
          onImportedMoment={handleImportedMoment}
        />
      ) : null}
      <RecentMoments
        moments={displayedRecentMoments}
        editableMomentIds={editableMomentIds}
        isMutationPending={isMutationPending}
        onEditMoment={handleEditMoment}
        onDeleteMoment={handleDeleteMoment}
        deleteConflictMomentId={
          momentConflict?.operation === "delete"
            ? momentConflict.currentMoment.id
            : null
        }
        onLoadLatestMoment={loadLatestConflictedMoment}
      />
      <MemoryTimeline moments={displayedTimelineMoments} />
    </>
  );
}
