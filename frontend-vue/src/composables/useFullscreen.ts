import { ref, type Ref } from "vue";

function getFullscreenElement(): Element | null {
  return (
    document.fullscreenElement ||
    (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement ||
    (document as unknown as { mozFullScreenElement?: Element }).mozFullScreenElement ||
    (document as unknown as { msFullscreenElement?: Element }).msFullscreenElement ||
    null
  );
}

async function requestElementFullscreen(el: HTMLElement): Promise<void> {
  if (el.requestFullscreen) return el.requestFullscreen();
  const w = el as unknown as { webkitRequestFullscreen?: () => Promise<void> };
  if (w.webkitRequestFullscreen) return w.webkitRequestFullscreen();
  const m = el as unknown as { mozRequestFullScreen?: () => Promise<void> };
  if (m.mozRequestFullScreen) return m.mozRequestFullScreen();
  const ms = el as unknown as { msRequestFullscreen?: () => Promise<void> };
  if (ms.msRequestFullscreen) return ms.msRequestFullscreen();
  throw new Error("Fullscreen API not supported");
}

async function exitFullscreenSafe(): Promise<void> {
  if (document.exitFullscreen) return document.exitFullscreen();
  const d = document as unknown as { webkitExitFullscreen?: () => Promise<void> };
  if (d.webkitExitFullscreen) return d.webkitExitFullscreen();
  const d2 = document as unknown as { mozCancelFullScreen?: () => Promise<void> };
  if (d2.mozCancelFullScreen) return d2.mozCancelFullScreen();
  const d3 = document as unknown as { msExitFullscreen?: () => Promise<void> };
  if (d3.msExitFullscreen) return d3.msExitFullscreen();
}

export function useViewerFullscreen(
  viewerContainer: Ref<HTMLElement | null>,
  viewerMaximizedClass = "viewer-maximized"
) {
  const isFallbackMaximized = ref(false);
  const isMaximized = ref(false);

  function applyMaximized(enabled: boolean, onLayout?: () => void) {
    isMaximized.value = enabled;
    const el = viewerContainer.value;
    if (el) el.classList.toggle(viewerMaximizedClass, enabled);
    document.body.classList.toggle(viewerMaximizedClass, enabled);
    requestAnimationFrame(() => requestAnimationFrame(() => onLayout?.()));
  }

  function bindFullscreenEvents(onLayout?: () => void) {
    const handler = () => {
      const current = getFullscreenElement();
      if (current === viewerContainer.value) {
        isFallbackMaximized.value = false;
        applyMaximized(true, onLayout);
      } else if (!current) {
        isFallbackMaximized.value = false;
        applyMaximized(false, onLayout);
      }
    };
    document.addEventListener("fullscreenchange", handler);
    document.addEventListener("webkitfullscreenchange", handler);
    document.addEventListener("mozfullscreenchange", handler);
    document.addEventListener("MSFullscreenChange", handler);
    return () => {
      document.removeEventListener("fullscreenchange", handler);
      document.removeEventListener("webkitfullscreenchange", handler);
      document.removeEventListener("mozfullscreenchange", handler);
      document.removeEventListener("MSFullscreenChange", handler);
    };
  }

  async function toggle(onLayout?: () => void) {
    const el = viewerContainer.value;
    if (!el) return;
    const current = getFullscreenElement();

    if (current === el) {
      try {
        await exitFullscreenSafe();
      } catch {
        /* ignore */
      } finally {
        isFallbackMaximized.value = false;
        applyMaximized(false, onLayout);
      }
      return;
    }

    if (isFallbackMaximized.value) {
      isFallbackMaximized.value = false;
      applyMaximized(false, onLayout);
      return;
    }

    try {
      await requestElementFullscreen(el);
    } catch {
      isFallbackMaximized.value = true;
      applyMaximized(true, onLayout);
    }
  }

  return {
    isMaximized,
    isFallbackMaximized,
    applyMaximized,
    bindFullscreenEvents,
    toggle,
  };
}
