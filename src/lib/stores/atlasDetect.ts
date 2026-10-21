// Per-session answer to "is this server Atlas (or search capable)?", so reopening the index panel
// does not repeat the `atlasVersion` call and the search probe. Dropped when the session reconnects or closes.
const known = new Map<string, boolean>();

export const atlasDetect = {
  get(sessionId: string): boolean | undefined {
    return known.get(sessionId);
  },
  set(sessionId: string, atlas: boolean) {
    known.set(sessionId, atlas);
  },
  invalidate(sessionId: string) {
    known.delete(sessionId);
  },
};
