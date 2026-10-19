/** The stage picker's grouping: what a stage is for, in the order people reach for them. */
export type StageCategory = "filter" | "reshape" | "group" | "join" | "output";

export const STAGE_CATEGORIES: { key: StageCategory; stages: string[] }[] = [
  { key: "filter", stages: ["$match", "$sort", "$limit", "$skip", "$sample"] },
  { key: "reshape", stages: ["$project", "$addFields", "$set", "$unset", "$replaceRoot", "$unwind"] },
  { key: "group", stages: ["$group", "$sortByCount", "$count", "$bucket", "$facet"] },
  { key: "join", stages: ["$lookup"] },
  { key: "output", stages: ["$out", "$merge"] },
];
