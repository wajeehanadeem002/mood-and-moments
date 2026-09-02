import type { Moment } from "@/data/moments";

export class MomentConflictError extends Error {
  constructor(public readonly currentMoment: Moment) {
    super("The Moment changed after it was loaded.");
    this.name = "MomentConflictError";
  }
}

export interface MomentRepository {
  list(): Promise<Moment[]>;
  create(moment: Moment): Promise<Moment>;
  update(moment: Moment): Promise<Moment>;
  delete(id: string, revision?: number): Promise<void>;
}
