<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import ModelViewerPanel from "./components/ModelViewerPanel.vue";
import {
  apiBase,
  toAbsoluteUrl,
  uploadDemo,
  uploadFile,
  createTask,
  getTask,
  getTaskResult,
} from "./api/client";
import type { ResultManifest, TaskRecord, UploadResponse } from "./types/manifest";

const DEMO_IMAGE_PATH = "/static/demo/demo_input.png";

interface DemoSample {
  id: string;
  category: string;
  model_id: string;
  view_id: string;
  image_url: string;
  graph_url: string;
  source_image_path: string;
  source_graph_path: string;
}

interface DemoCategory {
  name: string;
  count: number;
  samples: DemoSample[];
}

interface DemoCatalog {
  generated_at: string;
  total_samples: number;
  category_count: number;
  categories: DemoCategory[];
}

const uploadStatus = ref("");
const taskStatus = ref("");
const resultStatus = ref("");
const taskProgress = ref(0);
const rawJson = ref<unknown>(null);

const uploadId = ref<string | null>(null);
const latestTaskId = ref<string | null>(null);
const latestTask = ref<TaskRecord | null>(null);
const manifest = ref<ResultManifest | null>(null);

const inputPreviewUrl = ref("");
const selectedDemoSample = ref<DemoSample | null>(null);
const demoCatalog = ref<DemoCatalog | null>(null);
const demoCatalogError = ref("");
const showDemoModal = ref(false);
const activeDemoCategory = ref("");

const sampleUrls = computed(() => latestTask.value?.sample_urls ?? []);

const demoImageUrl = computed(() => toAbsoluteUrl(DEMO_IMAGE_PATH));
const currentDemoSamples = computed(() => {
  if (!demoCatalog.value) return [];
  const category = demoCatalog.value.categories.find((c) => c.name === activeDemoCategory.value);
  return category?.samples || [];
});
const demoCategoryPreview = computed(() => {
  const categories = demoCatalog.value?.categories || [];
  if (!categories.length) return "加载中...";
  const names = categories.map((c) => c.name);
  if (names.length <= 3) return names.join(" / ");
  return `${names.slice(0, 3).join(" / ")} 等 ${names.length} 类`;
});

async function loadDemoCatalog() {
  try {
    const resp = await fetch("/demo_samples/index.json");
    if (!resp.ok) throw new Error(await resp.text());
    const data = (await resp.json()) as DemoCatalog;
    demoCatalog.value = data;
    if (!activeDemoCategory.value && data.categories.length > 0) {
      activeDemoCategory.value = data.categories[0].name;
    }
  } catch (e) {
    demoCatalogError.value = `样例库加载失败: ${String(e)}`;
  }
}

async function onUploadDemo() {
  uploadStatus.value = "正在上传 demo 图片...";
  try {
    const data = (await uploadDemo()) as UploadResponse;
    uploadId.value = data.upload_id ?? null;
    uploadStatus.value = `demo 上传成功，upload_id=${uploadId.value}`;
    if (data.file_url) inputPreviewUrl.value = toAbsoluteUrl(data.file_url);
    rawJson.value = data;
  } catch (e) {
    uploadStatus.value = `demo 上传失败: ${String(e)}`;
  }
}

async function onUseDemoSample(sample: DemoSample) {
  uploadStatus.value = `正在上传样例 ${sample.id}...`;
  try {
    const resp = await fetch(sample.image_url);
    if (!resp.ok) throw new Error(await resp.text());
    const blob = await resp.blob();
    const ext = sample.image_url.split(".").pop() || "png";
    const file = new File([blob], `${sample.id}.${ext}`, { type: blob.type || "image/png" });
    const data = (await uploadFile(file)) as UploadResponse;
    uploadId.value = data.upload_id ?? null;
    inputPreviewUrl.value = sample.image_url;
    selectedDemoSample.value = sample;
    showDemoModal.value = false;
    uploadStatus.value = `样例上传成功，upload_id=${uploadId.value}（${sample.id}）`;
    rawJson.value = { upload: data, selected_demo_sample: sample };
  } catch (e) {
    uploadStatus.value = `样例上传失败: ${String(e)}`;
  }
}

async function onUploadFile(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) {
    uploadStatus.value = "请先选择图片";
    return;
  }
  uploadStatus.value = "上传中...";
  try {
    const data = (await uploadFile(file)) as UploadResponse;
    uploadId.value = data.upload_id ?? null;
    uploadStatus.value = `上传成功，upload_id=${uploadId.value}`;
    inputPreviewUrl.value = URL.createObjectURL(file);
    selectedDemoSample.value = null;
    rawJson.value = data;
  } catch (e) {
    uploadStatus.value = `上传失败: ${String(e)}`;
  }
}

async function onStartTask() {
  if (!uploadId.value) {
    taskStatus.value = "请先上传图片";
    return;
  }
  taskStatus.value = "创建任务中...";
  resultStatus.value = "";
  taskProgress.value = 0;
  manifest.value = null;
  try {
    const task = (await createTask(uploadId.value, {
      demoSampleId: selectedDemoSample.value?.id,
    })) as TaskRecord;
    latestTaskId.value = task.task_id ?? null;
    latestTask.value = task;
    taskStatus.value = `任务已创建: ${latestTaskId.value}`;
    taskProgress.value = task.progress ?? 0;
    rawJson.value = task;
    if (latestTaskId.value) await pollTask(latestTaskId.value);
  } catch (e) {
    taskStatus.value = `创建任务失败: ${String(e)}`;
  }
}

function onDemoImgError() {
  uploadStatus.value =
    "demo 预览图加载失败：请确认后端已启动且可访问 /static/demo/demo_input.png";
}

async function pollTask(taskId: string) {
  let keep = true;
  while (keep) {
    await new Promise((r) => setTimeout(r, 3500));
    try {
      const task = (await getTask(taskId)) as TaskRecord;
      latestTask.value = task;
      rawJson.value = task;
      taskStatus.value = `任务状态: ${task.status}`;
      taskProgress.value = task.progress ?? 0;
      if (task.status === "succeeded" || task.status === "failed") {
        keep = false;
        if (task.status === "succeeded") {
          resultStatus.value = "任务成功，正在加载统一结果清单和模型...";
          try {
            const m = (await getTaskResult(taskId)) as ResultManifest;
            manifest.value = m;
            rawJson.value = m;
            resultStatus.value = "结果清单和模型已加载";
          } catch (e) {
            resultStatus.value = `结果加载失败: ${String(e)}`;
          }
        } else {
          resultStatus.value = "任务失败，请查看错误信息或日志";
        }
      }
    } catch (e) {
      taskStatus.value = `查询任务失败: ${String(e)}`;
      keep = false;
    }
  }
}

function resultLinkItems(m: ResultManifest) {
  const items: { label: string; url: string }[] = [];
  if (m.manifest_url) items.push({ label: "result_manifest.json", url: m.manifest_url });
  if (m.meta_url) items.push({ label: "meta.json", url: m.meta_url });
  if (m.input_image?.url) items.push({ label: "input image", url: m.input_image.url });
  (m.object_json_files || []).forEach((item, i) => {
    if (item.url) items.push({ label: `object.json #${i + 1}`, url: item.url });
  });
  (m.preview_files || []).forEach((item, i) => {
    if (item.url) items.push({ label: `preview #${i + 1}`, url: item.url });
  });
  (m.mesh_files || []).forEach((item, i) => {
    if (item.url) items.push({ label: `mesh #${i + 1}`, url: item.url });
  });
  return items;
}

const previewImageUrl = computed(() => {
  const m = manifest.value;
  if (!m?.preview_files?.length) return "";
  const hit = m.preview_files.find((item) => /\.(png|jpg|jpeg|webp|gif)$/i.test(item.url || ""));
  return hit?.url ? toAbsoluteUrl(hit.url) : "";
});

const resultCards = computed(() => {
  const m = manifest.value;
  if (!m) return [];
  return [
    { title: "任务状态", value: m.status || "-" },
    { title: "mesh 数量", value: String((m.mesh_files || []).length) },
    { title: "preview 数量", value: String((m.preview_files || []).length) },
    { title: "created", value: m.created_at || "-" },
    { title: "finished", value: m.finished_at || "-" },
  ];
});

onMounted(() => {
  loadDemoCatalog();
});
</script>

<template>
  <main class="container">
    <header class="page-header">
      <h1>可动三维生成可视化系统（Vue 版）</h1>
      <p>单视图输入 → 推理 → 可动三维交互。原版静态页见目录 <code>frontend/</code>。</p>
      <p class="muted">
        后端 API：开发模式下使用相对路径（apiBase 为空），请求由 Vite 转发到后端；当前：{{
          apiBase || "（经 Vite 代理）"
        }}
      </p>
    </header>

    <section class="top-grid">
      <div class="card left-panel">
        <h2>输入与任务</h2>
        <p class="muted">可点击 demo 图自动上传，或手动选择本地图片。</p>

        <div class="demo-gallery">
          <button type="button" class="demo-item" @click="onUploadDemo">
            <img :src="demoImageUrl" alt="demo 输入图" @error="onDemoImgError" />
            <span>使用 Demo 输入图</span>
          </button>
          <div class="demo-library-card">
            <div class="library-title">样例库</div>
            <div class="library-subtitle">包含类别</div>
            <div class="library-categories">{{ demoCategoryPreview }}</div>
            <button type="button" class="demo-picker-btn" @click="showDemoModal = true">
              打开样例库
            </button>
          </div>
        </div>
        <p v-if="demoCatalogError" class="status-line">{{ demoCatalogError }}</p>

        <div class="upload-row">
          <div class="file-picker-wrap">
            <input
              id="localImageInput"
              class="file-picker-input"
              type="file"
              accept=".png,.jpg,.jpeg,.webp"
              @change="onUploadFile"
            />
          </div>
          <button type="button" class="primary-action-btn" @click="onStartTask">开始生成</button>
        </div>

        <p class="status-line">{{ uploadStatus }}</p>
        <p class="status-line">{{ taskStatus }}</p>
        <div class="progress-wrap">
          <div class="progress-bar" :style="{ width: `${taskProgress}%` }" />
        </div>
        <p class="status-line">总体进度: {{ taskProgress }}%</p>
        <p v-if="selectedDemoSample" class="status-line">
          当前样例：{{ selectedDemoSample.category }}/{{ selectedDemoSample.model_id }}/view {{
            selectedDemoSample.view_id
          }}
        </p>
        <img v-if="inputPreviewUrl" class="preview-img" :src="inputPreviewUrl" alt="输入预览" />
      </div>

      <ModelViewerPanel :manifest="manifest" :sample-urls="sampleUrls" />
    </section>

    <section class="card" style="margin-top: 1rem">
      <h2>详细输出</h2>
      <p class="status-line">{{ resultStatus }}</p>
      <div v-if="manifest" class="result-cards">
        <div v-for="c in resultCards" :key="c.title" class="result-card">
          <h4>{{ c.title }}</h4>
          <div>{{ c.value }}</div>
        </div>
      </div>
      <div v-if="manifest" class="result-links">
        <a
          v-for="(item, idx) in resultLinkItems(manifest)"
          :key="idx"
          :href="toAbsoluteUrl(item.url)"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ item.label }}
        </a>
      </div>
      <img v-if="previewImageUrl" class="preview-img" :src="previewImageUrl" alt="结果预览" />
      <pre class="raw-json">{{ JSON.stringify(rawJson, null, 2) }}</pre>
    </section>

    <div v-if="showDemoModal" class="modal-mask" @click.self="showDemoModal = false">
      <div class="modal-panel">
        <div class="modal-header">
          <h3>样例库（pm_test）</h3>
          <button type="button" class="modal-close" @click="showDemoModal = false">关闭</button>
        </div>
        <p v-if="demoCatalog" class="muted">
          共 {{ demoCatalog.total_samples }} 个样例，{{ demoCatalog.category_count }} 个类别
        </p>
        <div class="demo-category-tabs">
          <button
            v-for="category in demoCatalog?.categories || []"
            :key="category.name"
            type="button"
            class="demo-category-tab"
            :class="{ active: category.name === activeDemoCategory }"
            @click="activeDemoCategory = category.name"
          >
            {{ category.name }} ({{ category.count }})
          </button>
        </div>
        <div class="demo-sample-grid">
          <button
            v-for="sample in currentDemoSamples"
            :key="sample.id"
            type="button"
            class="demo-sample-card"
            @click="onUseDemoSample(sample)"
          >
            <img :src="sample.image_url" :alt="sample.id" />
            <div class="sample-title">{{ sample.id }}</div>
            <div class="sample-meta">model: {{ sample.model_id }} | view: {{ sample.view_id }}</div>
          </button>
        </div>
      </div>
    </div>
  </main>
</template>
