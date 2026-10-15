type Stage = { name: string; body: unknown };
type Args = Record<string, string | number>;

/** Expands a template (answers to its 1-2 questions) into concrete stages. `topN`'s optional `by` is
 *  accepted but unused: ranking is always by the group count. */
export function expandTemplate(
  id: "countBy" | "topN" | "sumPerMonth" | "join" | "duplicates",
  a: Args,
): Stage[] {
  const s = (k: string) => String(a[k] ?? "");
  switch (id) {
    case "countBy":
      return [
        { name: "$group", body: { _id: "$" + s("field"), count: { $sum: 1 } } },
        { name: "$sort", body: { count: -1 } },
      ];
    case "topN":
      return [
        { name: "$group", body: { _id: "$" + s("field"), count: { $sum: 1 } } },
        { name: "$sort", body: { count: -1 } },
        { name: "$limit", body: Number(a.n) },
      ];
    case "sumPerMonth":
      return [
        {
          name: "$group",
          body: {
            _id: { $dateToString: { format: "%Y-%m", date: "$" + s("dateField") } },
            total: { $sum: "$" + s("valueField") },
          },
        },
        { name: "$sort", body: { _id: 1 } },
      ];
    case "join":
      return [
        {
          name: "$lookup",
          body: {
            from: s("from"),
            localField: s("localField"),
            foreignField: s("foreignField"),
            as: s("as"),
          },
        },
        { name: "$unwind", body: { path: "$" + s("as"), preserveNullAndEmptyArrays: true } },
      ];
    case "duplicates":
      return [
        {
          name: "$group",
          body: { _id: "$" + s("field"), count: { $sum: 1 }, ids: { $push: "$_id" } },
        },
        { name: "$match", body: { count: { $gt: 1 } } },
        { name: "$sort", body: { count: -1 } },
      ];
  }
}
