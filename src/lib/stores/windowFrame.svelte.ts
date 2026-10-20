import { untrack } from "svelte";
import { setDecorations } from "../api/window";
import { prefs } from "./prefs.svelte";

const KEY = "window-native-frame";

const read = () => prefs.getItem(KEY) === "true";

/** "Use the system window frame": off = LumioNG draws its own title bar and window buttons (the default). */
export function createWindowFrame() {
  let native = $state(untrack(read));
  prefs.afterHydrate(() => (native = read()));

  /** Failures (no Tauri, permission) are ignored: the custom buttons stay visible only while the frame is off, so tell the window last. */
  async function apply(on: boolean): Promise<void> {
    try {
      await setDecorations(on);
    } catch {
      /* not running inside the desktop shell */
    }
  }

  return {
    get native() { return native; },
    setNative(v: boolean) {
      native = v;
      prefs.setItem(KEY, v ? "true" : "false");
      void apply(v);
    },
    /** At startup: the window is created without a frame (tauri.conf.json), so only the system-frame choice needs applying. */
    init(): Promise<void> {
      return native ? apply(true) : Promise.resolve();
    },
  };
}

export const windowFrame = createWindowFrame();
