/** Writes text to the clipboard, swallowing the error (denied permission, insecure context, etc.) into a boolean the caller reacts to. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
