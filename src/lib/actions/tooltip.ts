/** Svelte action: custom hover tooltip (native `title` doesn't re-arm when `disabled` flips mid-hover).
 *  Attach to a wrapping element, not the `disabled` control itself — disabled controls don't fire pointer events. */
const SHOW_DELAY_MS = 300;

function positionTooltip(tip: HTMLElement, target: HTMLElement) {
  const r = target.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  let top = r.bottom + 6;
  let left = r.left + r.width / 2 - tipRect.width / 2;
  left = Math.max(4, Math.min(left, window.innerWidth - tipRect.width - 4));
  if (top + tipRect.height > window.innerHeight) top = r.top - tipRect.height - 6;
  tip.style.top = `${top}px`;
  tip.style.left = `${left}px`;
}

export function tooltip(node: HTMLElement, text: string) {
  let label = text;
  let tip: HTMLDivElement | null = null;
  let showTimer: ReturnType<typeof setTimeout> | undefined;

  function show() {
    if (!label) return;
    hide();
    tip = document.createElement("div");
    tip.className = "app-tooltip";
    tip.textContent = label;
    tip.setAttribute("role", "tooltip");
    document.body.appendChild(tip);
    positionTooltip(tip, node);
  }

  function hide() {
    clearTimeout(showTimer);
    if (tip) {
      tip.remove();
      tip = null;
    }
  }

  function onEnter() {
    clearTimeout(showTimer);
    showTimer = setTimeout(show, SHOW_DELAY_MS);
  }

  node.addEventListener("pointerenter", onEnter);
  node.addEventListener("pointerleave", hide);
  node.addEventListener("pointerdown", hide);
  node.addEventListener("blur", hide);

  return {
    update(newText: string) {
      label = newText;
    },
    destroy() {
      node.removeEventListener("pointerenter", onEnter);
      node.removeEventListener("pointerleave", hide);
      node.removeEventListener("pointerdown", hide);
      node.removeEventListener("blur", hide);
      hide();
    },
  };
}
