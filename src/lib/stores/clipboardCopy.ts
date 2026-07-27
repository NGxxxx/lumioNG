import { copyToClipboard } from "../clipboard";
import * as m from "$lib/paraglide/messages";

/** Copies `text` to the clipboard, reporting the platform failure message via `setError` on failure. */
export function createClipboardCopy(setError: (msg: string) => void) {
  return async function copy(text: string) {
    if (!(await copyToClipboard(text))) setError(m.common_clipboard_failed());
  };
}
