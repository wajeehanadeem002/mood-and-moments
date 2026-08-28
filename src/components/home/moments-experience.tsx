"use client";

import { useEffect, useRef, useState } from "react";

import { Hero } from "@/components/home/hero";
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
import { LocalStorageMomentRepository } from "@/repositories/local-storage-moment-repository";
import type { MomentRepository } from "@/repositories/moment-repository";

type HydrationState = "loading" | "ready" | "error";

function sortMomentsNewestFirst(moments: readonly Moment[]): Moment[] {
  return [...moments].sort((left, right) =>
    right.dateTime.slice(0, 19).localeCompare(left.dateTime.slice(0, 19)),
  );
}

const staticMomentIds = new Set(
  [...recentMoments, ...timelineMoments].map((moment) => moment.id),
);

export function MomentsExperience() {
  const repositoryRef = useRef<MomentRepository | null>(null);
  const mutationInProgressRef = useRef(false);
  const [savedMoments, setSavedMoments] = useState<Moment[]>([]);
  const [hydrationState, setHydrationState] =
    useState<HydrationState>("loading");
  const [editingMomentId, setEditingMomentId] = useState<string | null>(null);
  const [isMutationPending, setIsMutationPending] = useState(false);

  useEffect(() => {
    let isCurrent = true;

    async function loadSavedMoments() {
      const repository = new LocalStorageMomentRepository(window.localStorage);
      repositoryRef.current = repository;
      const moments = await repository.list();

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
      repositoryRef.current = null;
    };
  }, []);

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

      const updatedMoment = await updateMoment(
        repositoryRef.current,
        existingMoment,
        draft,
        options,
      );
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

      await repositoryRef.current.delete(savedMoment.id);
      setSavedMoments((current) =>
        current.filter((candidate) => candidate.id !== savedMoment.id),
      );
      setEditingMomentId((current) =>
        current === savedMoment.id ? null : current,
      );
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
        isHydrating={hydrationState === "loading"}
        loadError={hydrationState === "error"}
        isMutationPending={isMutationPending}
        editingMoment={editingMoment}
        onCreateMoment={handleCreateMoment}
        onUpdateMoment={handleUpdateMoment}
        onCancelEdit={() => setEditingMomentId(null)}
      />
      <RecentMoments
        moments={displayedRecentMoments}
        editableMomentIds={editableMomentIds}
        isMutationPending={isMutationPending}
        onEditMoment={handleEditMoment}
        onDeleteMoment={handleDeleteMoment}
      />
      <MemoryTimeline moments={displayedTimelineMoments} />
    </>
  );
}
