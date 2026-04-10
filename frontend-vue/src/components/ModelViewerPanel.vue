<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, shallowRef } from "vue";
import { MinimalModelViewer, type MovableJointInfo } from "../viewer/MinimalModelViewer";
import { apiBase } from "../api/client";
import { useViewerFullscreen } from "../composables/useFullscreen";
import type { ResultManifest } from "../types/manifest";

const props = defineProps<{
  manifest: ResultManifest | null;
  sampleUrls: string[];
}>();

const viewerShellRef = ref<HTMLElement | null>(null);
const viewerContainerRef = ref<HTMLElement | null>(null);
const viewerStatus = ref("模型查看区域（等待结果）");
const joints = ref<MovableJointInfo[]>([]);
const fullscreenLabel = ref("全屏查看");

const viewer = shallowRef<MinimalModelViewer | null>(null);
const { toggle, bindFullscreenEvents, isMaximized, isFallbackMaximized } = useViewerFullscreen(
  viewerShellRef,
  "viewer-maximized"
);

let unbindFs: (() => void) | null = null;

function syncFullscreenLabel() {
  fullscreenLabel.value =
    isMaximized.value || isFallbackMaximized.value ? "退出全屏" : "全屏查看";
}

watch([isMaximized, isFallbackMaximized], syncFullscreenLabel);

watch(
  () => [props.manifest, props.sampleUrls] as const,
  async () => {
    const v = viewer.value;
    if (!v || !props.manifest) return;
    try {
      await v.loadFromManifest(props.manifest, props.sampleUrls);
    } catch (e) {
      v.setStatus(`模型加载失败: ${String(e)}`);
    }
  }
);

onMounted(() => {
  if (!viewerContainerRef.value) return;
  const v = new MinimalModelViewer(viewerContainerRef.value, (m) => (viewerStatus.value = m), apiBase);
  v.onJointStateChanged = (j) => (joints.value = j);
  viewer.value = v;

  unbindFs = bindFullscreenEvents(() => v.onResize());
  syncFullscreenLabel();
});

onUnmounted(() => {
  unbindFs?.();
  viewer.value?.dispose();
  viewer.value = null;
});

function onJointSliderInput(id: number, value: number) {
  viewer.value?.selectJoint(id);
  viewer.value?.updateJointValue(id, value);
}

function resetPose() {
  viewer.value?.resetPose();
}

async function onFullscreenClick() {
  try {
    await toggle(() => viewer.value?.onResize());
  } catch {
    viewer.value?.setStatus("全屏切换失败，已回退到普通模式。");
  }
  syncFullscreenLabel();
}
</script>

<template>
  <div class="card right-panel">
    <h2>可视化交互（Vue）</h2>
    <p class="muted">与 `frontend/` 并存；开发时使用 Vite 代理访问后端。</p>
    <p class="status-line">{{ viewerStatus }}</p>
    <div ref="viewerShellRef" class="viewer-wrap">
      <div ref="viewerContainerRef" class="viewer-container"></div>
      <div class="joint-toolbar">
        <button type="button" @click="resetPose">复位姿态</button>
        <button type="button" @click="onFullscreenClick">{{ fullscreenLabel }}</button>
      </div>
      <div class="joint-panel">
        <template v-if="joints.length === 0">
          <p class="muted small">当前结果无可动关节（或静态 mesh）。</p>
        </template>
        <div v-for="j in joints" :key="j.id" class="joint-item">
          <div class="joint-title">
            part_{{ j.id }} ({{ j.type }}){{ j.selected ? " [已选中]" : "" }}
          </div>
          <input
            type="range"
            :min="j.range[0]"
            :max="j.range[1]"
            :step="Math.max(1e-6, Math.abs(j.range[1] - j.range[0]) / 400)"
            :value="j.value"
            @input="onJointSliderInput(j.id, Number(($event.target as HTMLInputElement).value))"
          />
          <div class="joint-value">value: {{ j.value.toFixed(3) }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
