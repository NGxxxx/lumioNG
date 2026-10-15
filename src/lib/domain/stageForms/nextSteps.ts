import { isPlainObject } from "./deepEqualOrdered";

type Stage = { name: string; body: unknown };
type Step = { label: string; stage: Stage };

const group: Step = {
  label: "Group ($group)",
  stage: { name: "$group", body: { _id: null, count: { $sum: 1 } } },
};
const limit10: Step = { label: "Limit 10", stage: { name: "$limit", body: 10 } };

function unwindPath(body: unknown): string | null {
  const p = typeof body === "string" ? body : isPlainObject(body) ? body.path : null;
  return typeof p === "string" && p.length > 1 && p[0] === "$" ? p.slice(1) : null;
}

/** Suggested "what next" chips from the last stage of the pipeline. */
export function nextSteps(stages: Stage[]): Step[] {
  if (stages.length === 0) {
    return [{ label: "Filter ($match)", stage: { name: "$match", body: {} } }, group];
  }
  const last = stages[stages.length - 1];
  switch (last.name) {
    case "$match":
      return [group, { label: "Sort", stage: { name: "$sort", body: { _id: 1 } } }];
    case "$group": {
      const first = isPlainObject(last.body)
        ? Object.keys(last.body).find((k) => k !== "_id") ?? "_id"
        : "_id";
      return [
        { label: `Sort by ${first} ↓`, stage: { name: "$sort", body: { [first]: -1 } } },
        limit10,
      ];
    }
    case "$lookup": {
      const as = isPlainObject(last.body) ? last.body.as : null;
      if (typeof as === "string" && as.length > 0) {
        return [{ label: `Unwind ${as}`, stage: { name: "$unwind", body: "$" + as } }];
      }
      return [limit10];
    }
    case "$unwind": {
      const p = unwindPath(last.body);
      if (p === null) return [limit10];
      return [
        {
          label: `Group by ${p}`,
          stage: { name: "$group", body: { _id: "$" + p, count: { $sum: 1 } } },
        },
      ];
    }
    case "$limit":
    case "$count":
    case "$out":
    case "$merge":
      return [];
    default:
      return [limit10];
  }
}
