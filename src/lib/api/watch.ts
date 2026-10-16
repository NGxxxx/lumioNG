import { invoke, Channel } from "@tauri-apps/api/core";
import type { Doc } from "../domain/doc";

export type WatchMessage =
  | { type: "events"; events: Doc[]; sizes: number[] }
  | { type: "error"; message: string }
  | { type: "ended" };

export type WatchStart = { status: "started"; preImages: boolean } | { status: "standalone" };

export interface WatchTarget {
  db: string | null;
  coll: string | null;
  /** Extended JSON array of stages applied to the change events. */
  pipeline?: string | null;
}

/** Opens a change stream (collection, database, or whole deployment) and delivers its events to
 *  `onMessage` until `stopWatch`. Resolves once the stream is open. */
export async function startWatch(
  sessionId: string,
  watchId: string,
  target: WatchTarget,
  onMessage: (m: WatchMessage) => void,
): Promise<WatchStart> {
  const ch = new Channel<WatchMessage>();
  ch.onmessage = onMessage;
  return await invoke<WatchStart>("watch_start", {
    sessionId, watchId, db: target.db, coll: target.coll, pipeline: target.pipeline ?? null, onEvent: ch,
  });
}

export async function stopWatch(sessionId: string, watchId: string): Promise<void> {
  await invoke("watch_stop", { sessionId, watchId });
}

export type ProfileStart =
  | { status: "started"; previousLevel: number }
  | { status: "mongos" }
  | { status: "readOnly" }
  | { status: "denied"; message: string }
  | { status: "unsupported"; message: string };

/** Turns the database profiler on (level 2 = everything, 1 = slower than `slowms`) and delivers new
 *  `system.profile` entries until `stopWatch`, which also puts the previous setting back. */
export async function startProfileWatch(
  sessionId: string,
  watchId: string,
  target: { db: string; coll: string | null; level: 1 | 2; slowms: number },
  onMessage: (m: WatchMessage) => void,
): Promise<ProfileStart> {
  const ch = new Channel<WatchMessage>();
  ch.onmessage = onMessage;
  return await invoke<ProfileStart>("profile_watch_start", { sessionId, watchId, ...target, onEvent: ch });
}
