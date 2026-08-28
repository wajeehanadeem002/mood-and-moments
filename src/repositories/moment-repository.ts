import type { Moment } from "@/data/moments";

export interface MomentRepository {
  list(): Promise<Moment[]>;
  create(moment: Moment): Promise<Moment>;
}
