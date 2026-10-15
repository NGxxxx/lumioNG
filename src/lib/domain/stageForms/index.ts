import { addFieldsCodec, projectCodec } from "./project";
import { countCodec } from "./count";
import { groupCodec } from "./group";
import { limitSkipCodec } from "./limitSkip";
import { lookupCodec } from "./lookup";
import { sortCodec } from "./sort";
import { unwindCodec } from "./unwind";
import { matchCodec } from "./match";
import type { StageCodec } from "./types";

export type { StageCodec } from "./types";
export type { GroupModel, GroupOp } from "./group";
export type { SortModel } from "./sort";
export type { ProjectModel } from "./project";
export type { UnwindModel } from "./unwind";
export type { LookupModel } from "./lookup";
export { nextSteps } from "./nextSteps";
export { expandTemplate } from "./templates";
export { stageWarnings } from "./warnings";
export { deepEqualOrdered } from "./deepEqualOrdered";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const STAGE_CODECS: Record<string, StageCodec<any>> = {
  $match: matchCodec,
  $group: groupCodec,
  $sort: sortCodec,
  $project: projectCodec,
  $addFields: addFieldsCodec,
  $set: addFieldsCodec,
  $limit: limitSkipCodec,
  $skip: limitSkipCodec,
  $unwind: unwindCodec,
  $lookup: lookupCodec,
  $count: countCodec,
};
