// src/lib/components/DocumentForm.test-helpers.svelte.ts
import type { Doc } from "../domain/doc";

/** Wraps a doc in a Svelte 5 `$state` array and returns the reactive-proxied element —
 * mirrors how sessionManager's `workTabs` ($state, not raw) proxies `tab.initial`. */
export function proxiedDoc(doc: Doc): Doc {
  const arr = $state([doc]);
  return arr[0];
}
