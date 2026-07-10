// NOTE: virtualizer wiring stays duplicated per grid component — mirroring its store into `$state` from a `.svelte.ts` module causes an infinite update loop. Don't retry that extraction.
export const GRID_ROW_H = 24;

/** `resizing` lets callers suppress a click action (e.g. sort-on-header) on mouseup. */
export function createColumnResize(getWidth: (path: string) => number, setWidth: (path: string, px: number) => void) {
  let resizing = $state(false);

  function start(e: MouseEvent, path: string) {
    e.preventDefault();
    e.stopPropagation();
    resizing = true;
    const startX = e.clientX;
    const startW = getWidth(path);
    function move(ev: MouseEvent) {
      setWidth(path, startW + (ev.clientX - startX));
    }
    function up() {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      // clear after the click event would have fired, so a header click-to-sort is suppressed
      setTimeout(() => { resizing = false; }, 0);
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  return {
    get resizing() { return resizing; },
    start,
  };
}
