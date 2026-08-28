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
import { createMoment, type MomentDraft } from "@/lib/moment-creation";
import { LocalStorageMomentRepository } from "@/repositories/local-storage-moment-repository";
import type { MomentRepository } from "@/repositories/moment-repository";

type HydrationState = "loading" | "ready" | "error";

function sortMomentsNewestFirst(moments: readonly Moment[]): Moment[] {
  return [...moments].sort((left, right) =>
    right.dateTime.slice(0, 19).localeCompare(left.dateTime.slice(0, 19)),
  );
}

export function MomentsExperience() {
  const repositoryRef = useRef<MomentRepository | null>(null);
  const [savedMoments, setSavedMoments] = useState<Moment[]>([]);
  const [hydrationState, setHydrationState] =
    useState<HydrationState>("loading");

  useEffect(() => {
    let isCurrent = true;

    async function loadSavedMoments() {
      const repository = new LocalStorageMomentRepository(window.localStorage);
      repositoryRef.current = repository;
      const moments = await repository.list();

      if (isCurrent) {
        setSavedMoments(moments);
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

  async function handleCreateMoment(draft: MomentDraft) {
    if (!repositoryRef.current) {
      throw new Error("Moment storage is not ready.");
    }

    const moment = await createMoment(repositoryRef.current, draft);
    setSavedMoments((current) => [moment, ...current]);
  }

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
        onCreateMoment={handleCreateMoment}
      />
      <RecentMoments moments={displayedRecentMoments} />
      <MemoryTimeline moments={displayedTimelineMoments} />
    </>
  );
}
