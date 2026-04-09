let THREE;
let OrbitControls;
let GLTFLoader;
let OBJLoader;
let PLYLoader;

const API_BASE =
  window.location.hostname === "localhost"
    ? "http://localhost:8000"
    : `${window.location.protocol}//${window.location.hostname}:8000`;

const imageInput = document.getElementById("imageInput");
const uploadBtn = document.getElementById("uploadBtn");
const taskBtn = document.getElementById("taskBtn");
const uploadStatus = document.getElementById("uploadStatus");
const taskStatus = document.getElementById("taskStatus");
const taskProgressBar = document.getElementById("taskProgressBar");
const taskProgressText = document.getElementById("taskProgressText");
const resultJson = document.getElementById("resultJson");
const resultStatus = document.getElementById("resultStatus");
const resultLinks = document.getElementById("resultLinks");
const resultPreview = document.getElementById("resultPreview");
const resultCards = document.getElementById("resultCards");
const inputPreview = document.getElementById("inputPreview");
const demoImage = document.getElementById("demoImage");
const demoUploadBtn = document.getElementById("demoUploadBtn");
const viewerContainer = document.getElementById("viewerContainer");
const viewerStatus = document.getElementById("viewerStatus");
const jointPanel = document.getElementById("jointPanel");
const resetPoseBtn = document.getElementById("resetPoseBtn");
const toggleFullscreenBtn = document.getElementById("toggleFullscreenBtn");

let uploadId = null;
let latestTaskId = null;
let latestTask = null;
const DEMO_IMAGE_PATH = "/static/demo/demo_input.png";
let isViewerMaximized = false;
let isFallbackMaximized = false;
const jointPanelControls = new Map();

function getFullscreenElement() {
  return (
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement ||
    null
  );
}

async function requestElementFullscreen(el) {
  if (el.requestFullscreen) return el.requestFullscreen();
  if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
  if (el.mozRequestFullScreen) return el.mozRequestFullScreen();
  if (el.msRequestFullscreen) return el.msRequestFullscreen();
  throw new Error("Fullscreen API not supported");
}

async function exitFullscreenSafe() {
  if (document.exitFullscreen) return document.exitFullscreen();
  if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
  if (document.mozCancelFullScreen) return document.mozCancelFullScreen();
  if (document.msExitFullscreen) return document.msExitFullscreen();
}

function applyViewerMaximizedState(enabled) {
  isViewerMaximized = enabled;
  viewerContainer.classList.toggle("viewer-maximized", enabled);
  document.body.classList.toggle("viewer-maximized", enabled);
  toggleFullscreenBtn.textContent = enabled ? "退出全屏" : "全屏查看";
  // Wait for layout settle; avoid wrong canvas size after ESC/fullscreen transitions.
  requestAnimationFrame(() => requestAnimationFrame(() => viewer.onResize?.()));
}

function bindFullscreenEvents() {
  const handler = () => {
    const current = getFullscreenElement();
    if (current === viewerContainer) {
      isFallbackMaximized = false;
      applyViewerMaximizedState(true);
    } else if (!current) {
      // Exited native fullscreen (e.g., ESC) -> fully restore.
      isFallbackMaximized = false;
      applyViewerMaximizedState(false);
    }
  };
  document.addEventListener("fullscreenchange", handler);
  document.addEventListener("webkitfullscreenchange", handler);
  document.addEventListener("mozfullscreenchange", handler);
  document.addEventListener("MSFullscreenChange", handler);
}

async function toggleViewerFullscreen() {
  const current = getFullscreenElement();
  // Exit native fullscreen first.
  if (current === viewerContainer) {
    try {
      await exitFullscreenSafe();
    } catch (_err) {
      // ignore
    } finally {
      isFallbackMaximized = false;
      applyViewerMaximizedState(false);
    }
    return;
  }

  // If fallback maximized, toggle it off.
  if (isFallbackMaximized) {
    isFallbackMaximized = false;
    applyViewerMaximizedState(false);
    return;
  }

  // Try native fullscreen first.
  try {
    await requestElementFullscreen(viewerContainer);
    // `fullscreenchange` will sync UI state.
    return;
  } catch (_err) {
    // Fallback: in-page maximize mode.
    isFallbackMaximized = true;
    applyViewerMaximizedState(true);
  }
}

function toAbsoluteUrl(pathOrUrl) {
  if (!pathOrUrl) return "";
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) return pathOrUrl;
  return `${API_BASE}${pathOrUrl}`;
}

class MinimalModelViewer {
  constructor(container, statusEl) {
    this.container = container;
    this.statusEl = statusEl;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x111827);
    this.camera = new THREE.PerspectiveCamera(
      60,
      this.container.clientWidth / this.container.clientHeight,
      0.01,
      1000
    );
    this.camera.position.set(2.5, 2, 2.5);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight, false);
    this.container.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    this.gltfLoader = new GLTFLoader();
    this.objLoader = new OBJLoader();
    this.plyLoader = new PLYLoader();

    this.currentRoot = new THREE.Group();
    this.scene.add(this.currentRoot);
    this.selectedJointId = null;
    this.dragging = false;
    this.dragStartX = 0;
    this.jointTree = [];
    this.partObjects = new Map();
    this.initialMatrices = new Map();
    this.currentJointValues = new Map();
    this.parentMap = new Map();
    this.descendantsCache = new Map();
    this.onJointStateChanged = null;
    this.partBaseColors = new Map();
    this.activeAxisHelper = null;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x334155, 1.1);
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(4, 8, 5);
    this.gridHelper = new THREE.GridHelper(6, 12, 0x444444, 0x333333);
    this.gridHelper.position.y = 0;
    this.scene.add(hemi, dir, this.gridHelper);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.renderer.domElement.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    window.addEventListener("pointermove", (e) => this.onPointerMove(e));
    window.addEventListener("pointerup", () => (this.dragging = false));
    window.addEventListener("resize", () => this.onResize());
    // Keep renderer size synced with container changes (fullscreen enter/exit included).
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.container);
    this.animate();
  }

  setStatus(message) {
    this.statusEl.textContent = message;
  }

  clearRoot() {
    this.scene.remove(this.currentRoot);
    this.currentRoot.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose?.();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
        else obj.material.dispose?.();
      }
    });
    this.currentRoot = new THREE.Group();
    this.scene.add(this.currentRoot);
    this.partObjects.clear();
    this.initialMatrices.clear();
    this.currentJointValues.clear();
    this.parentMap.clear();
    this.descendantsCache.clear();
    this.jointTree = [];
    this.selectedJointId = null;
    this.partBaseColors.clear();
    if (this.activeAxisHelper) {
      this.scene.remove(this.activeAxisHelper);
      this.activeAxisHelper = null;
    }
  }

  async loadFromManifest(manifest, sampleUrls = []) {
    this.clearRoot();
    this.setStatus("正在加载模型...");

    // Compatibility path for current SINGAPO output: object.json + plys/part_i.ply.
    // Future robust adaptation: export glb/usdz with articulated hierarchy or URDF-like format.
    const objectJsonUrl = this.pickObjectJsonUrl(manifest, sampleUrls);
    if (objectJsonUrl) {
      await this.loadArticulatedFromObjectJson(objectJsonUrl);
      return;
    }

    const preferred = this.pickPreferredMesh(manifest.mesh_files || []);
    if (preferred) {
      await this.loadMeshFile(preferred.url);
      this.alignModelToGround();
      this._emitJointStateChanged();
      this.setStatus("模型已加载（基础查看: 旋转/缩放/平移）");
      return;
    }

    this._emitJointStateChanged();
    this.setStatus("未找到可直接加载的 glb/gltf/obj，且没有 object.json。");
  }

  pickPreferredMesh(meshFiles) {
    const byExt = (ext) => meshFiles.find((f) => (f.url || "").toLowerCase().endsWith(ext));
    return byExt(".glb") || byExt(".gltf") || byExt(".obj") || byExt(".ply") || meshFiles[0];
  }

  pickObjectJsonUrl(manifest, sampleUrls) {
    const fromManifest = (manifest.object_json_files || [])[0]?.url;
    if (fromManifest) return fromManifest;
    if (sampleUrls && sampleUrls.length > 0) return sampleUrls[0];
    return null;
  }

  async loadMeshFile(url) {
    const absUrl = toAbsoluteUrl(url);
    const lower = absUrl.toLowerCase();
    if (lower.endsWith(".glb") || lower.endsWith(".gltf")) {
      const gltf = await this.gltfLoader.loadAsync(absUrl);
      this.currentRoot.add(gltf.scene);
    } else if (lower.endsWith(".obj")) {
      const obj = await this.objLoader.loadAsync(absUrl);
      this.currentRoot.add(obj);
    } else if (lower.endsWith(".ply")) {
      const geo = await this.plyLoader.loadAsync(absUrl);
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ color: 0xbcd4ff, metalness: 0.1, roughness: 0.8 });
      this.currentRoot.add(new THREE.Mesh(geo, mat));
    } else {
      throw new Error(`暂不支持格式: ${url}`);
    }
    this.fitCameraToObject(this.currentRoot);
  }

  async loadArticulatedFromObjectJson(objectJsonUrl) {
    this.setStatus("检测到 SINGAPO object.json，尝试按关节参数加载可动部件...");
    const objResp = await fetch(toAbsoluteUrl(objectJsonUrl));
    if (!objResp.ok) throw new Error(await objResp.text());
    const objectJson = await objResp.json();
    this.jointTree = objectJson.diffuse_tree || [];
    for (const node of this.jointTree) {
      this.parentMap.set(node.id, node.parent);
      this.currentJointValues.set(node.id, 0);
      this.descendantsCache.set(node.id, this.collectDescendants(node.id));
    }

    const baseUrl = toAbsoluteUrl(objectJsonUrl).replace(/object\.json$/i, "");
    for (const node of this.jointTree) {
      const partUrl = `${baseUrl}plys/part_${node.id}.ply`;
      try {
        const geo = await this.plyLoader.loadAsync(partUrl);
        geo.computeVertexNormals();
        const color = node.joint?.type === "fixed" ? 0x93c5fd : 0xfca5a5;
        const mesh = new THREE.Mesh(
          geo,
          new THREE.MeshStandardMaterial({ color, metalness: 0.05, roughness: 0.9 })
        );
        mesh.userData.partId = node.id;
        this.partBaseColors.set(node.id, color);
        this.partObjects.set(node.id, mesh);
        this.currentRoot.add(mesh);
      } catch (_err) {
        // Some parts may be absent; keep viewer resilient.
      }
    }
    for (const [id, obj] of this.partObjects.entries()) {
      this.initialMatrices.set(id, obj.matrix.clone());
      obj.matrixAutoUpdate = false;
    }
    this.recomputeAllPartTransforms();
    this.alignModelToGround();
    this.fitCameraToObject(this.currentRoot);
    this._emitJointStateChanged();
    this.setStatus(
      "关节可视化已启用：点击可动部件后左右拖动。当前为 MVP 近似交互（非完整 URDF 物理约束）。"
    );
  }

  collectDescendants(rootId) {
    const out = [];
    const dfs = (id) => {
      out.push(id);
      const node = this.jointTree.find((n) => n.id === id);
      (node?.children || []).forEach((c) => dfs(c));
    };
    dfs(rootId);
    return out;
  }

  getChainToRoot(partId) {
    const chain = [];
    let cur = partId;
    while (cur !== -1 && cur !== undefined) {
      chain.push(cur);
      cur = this.parentMap.get(cur);
    }
    return chain.reverse();
  }

  getJointTransformForNode(nodeId) {
    const node = this.jointTree.find((n) => n.id === nodeId);
    if (!node || !node.joint) return new THREE.Matrix4();
    const type = node.joint.type;
    if (type === "fixed") return new THREE.Matrix4();
    const value = this.currentJointValues.get(nodeId) || 0;
    const axis = new THREE.Vector3(
      node.joint.axis?.direction?.[0] || 0,
      node.joint.axis?.direction?.[1] || 0,
      node.joint.axis?.direction?.[2] || 0
    );
    if (axis.lengthSq() < 1e-10) return new THREE.Matrix4();
    axis.normalize();
    const origin = new THREE.Vector3(
      node.joint.axis?.origin?.[0] || 0,
      node.joint.axis?.origin?.[1] || 0,
      node.joint.axis?.origin?.[2] || 0
    );
    if (type === "prismatic") {
      return new THREE.Matrix4().makeTranslation(axis.x * value, axis.y * value, axis.z * value);
    }
    if (type === "revolute" || type === "continuous") {
      const t1 = new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z);
      const r = new THREE.Matrix4().makeRotationAxis(axis, value);
      const t2 = new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z);
      return new THREE.Matrix4().multiplyMatrices(t2, r).multiply(t1);
    }
    return new THREE.Matrix4();
  }

  recomputeAllPartTransforms() {
    for (const [partId, obj] of this.partObjects.entries()) {
      const chain = this.getChainToRoot(partId);
      const total = new THREE.Matrix4().identity();
      for (const id of chain) {
        const tf = this.getJointTransformForNode(id);
        total.multiply(tf);
      }
      const final = new THREE.Matrix4().multiplyMatrices(total, this.initialMatrices.get(partId));
      obj.matrix.copy(final);
      obj.matrix.decompose(obj.position, obj.quaternion, obj.scale);
    }
  }

  onPointerDown(event) {
    if (!this.partObjects.size) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersects = this.raycaster.intersectObjects(Array.from(this.partObjects.values()));
    if (!intersects.length) return;
    const partId = intersects[0].object.userData.partId;
    const node = this.jointTree.find((n) => n.id === partId);
    if (!node || !node.joint || node.joint.type === "fixed") {
      this.setStatus("该部件为 fixed joint，不可交互。");
      return;
    }
    this.selectJoint(partId);
    this.dragging = true;
    this.dragStartX = event.clientX;
    this.setStatus(`已选中关节 part_${partId} (${node.joint.type})，左右拖动调整。`);
  }

  onPointerMove(event) {
    if (!this.dragging || this.selectedJointId == null) return;
    const node = this.jointTree.find((n) => n.id === this.selectedJointId);
    if (!node?.joint) return;
    const [low, high] = node.joint.range || [0, 0];
    const dx = event.clientX - this.dragStartX;
    this.dragStartX = event.clientX;
    const span = Math.max(1e-6, Math.abs(high - low));
    const delta = (dx / 260) * span;
    const cur = this.currentJointValues.get(this.selectedJointId) || 0;
    const next = Math.max(low, Math.min(high, cur + delta));
    this.updateJointValue(this.selectedJointId, next);
  }

  selectJoint(partId) {
    this.selectedJointId = partId;
    this.applySelectionHighlight();
    this.showJointAxis(partId);
    this._emitJointStateChanged();
  }

  applySelectionHighlight() {
    for (const [id, mesh] of this.partObjects.entries()) {
      const base = this.partBaseColors.get(id) || 0x93c5fd;
      mesh.material.color.setHex(base);
      mesh.material.emissive = new THREE.Color(0x000000);
      if (id === this.selectedJointId) {
        mesh.material.emissive = new THREE.Color(0x334155);
      }
    }
  }

  showJointAxis(partId) {
    if (this.activeAxisHelper) {
      this.scene.remove(this.activeAxisHelper);
      this.activeAxisHelper = null;
    }
    const node = this.jointTree.find((n) => n.id === partId);
    if (!node || !node.joint || node.joint.type === "fixed") return;
    const axis = new THREE.Vector3(
      node.joint.axis?.direction?.[0] || 0,
      node.joint.axis?.direction?.[1] || 0,
      node.joint.axis?.direction?.[2] || 0
    );
    if (axis.lengthSq() < 1e-8) return;
    axis.normalize();
    const origin = new THREE.Vector3(
      node.joint.axis?.origin?.[0] || 0,
      node.joint.axis?.origin?.[1] || 0,
      node.joint.axis?.origin?.[2] || 0
    );
    const len = 0.8;
    this.activeAxisHelper = new THREE.ArrowHelper(axis, origin, len, 0x22d3ee, 0.08, 0.04);
    this.scene.add(this.activeAxisHelper);
  }

  updateJointValue(partId, value) {
    this.currentJointValues.set(partId, value);
    this.recomputeAllPartTransforms();
    this.alignModelToGround();
    this._emitJointStateChanged();
  }

  resetPose() {
    for (const node of this.jointTree) {
      if (!node.joint || node.joint.type === "fixed") continue;
      const [low, high] = node.joint.range || [0, 0];
      const resetValue = low <= 0 && 0 <= high ? 0 : low;
      this.currentJointValues.set(node.id, resetValue);
    }
    this.recomputeAllPartTransforms();
    this.alignModelToGround();
    this._emitJointStateChanged();
    this.setStatus("姿态已复位");
  }

  getMovableJoints() {
    return this.jointTree
      .filter((n) => n.joint && n.joint.type !== "fixed")
      .map((n) => ({
        id: n.id,
        type: n.joint.type,
        range: n.joint.range || [0, 0],
        value: this.currentJointValues.get(n.id) ?? 0,
        selected: n.id === this.selectedJointId,
      }));
  }

  _emitJointStateChanged() {
    if (typeof this.onJointStateChanged === "function") {
      this.onJointStateChanged(this.getMovableJoints());
    }
  }

  alignModelToGround() {
    const box = new THREE.Box3().setFromObject(this.currentRoot);
    if (box.isEmpty()) return;
    const offset = -box.min.y;
    this.currentRoot.position.y += offset;
  }

  fitCameraToObject(object3D) {
    const box = new THREE.Box3().setFromObject(object3D);
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3()).length();
      const center = box.getCenter(new THREE.Vector3());
      this.controls.target.copy(center);
      this.camera.position.set(center.x + size * 0.8, center.y + size * 0.6, center.z + size * 0.8);
      this.camera.near = Math.max(0.01, size / 500);
      this.camera.far = Math.max(200, size * 20);
      this.camera.updateProjectionMatrix();
    }
  }

  onResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // updateStyle=false avoids stale inline canvas size after fullscreen toggles.
    this.renderer.setSize(w, h, false);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

async function ensureThreeDeps() {
  if (THREE && OrbitControls && GLTFLoader && OBJLoader && PLYLoader) return true;
  try {
    const threeMod = await import("./vendor/three/build/three.module.js");
    const orbitMod = await import("./vendor/three/examples/jsm/controls/OrbitControls.js");
    const gltfMod = await import("./vendor/three/examples/jsm/loaders/GLTFLoader.js");
    const objMod = await import("./vendor/three/examples/jsm/loaders/OBJLoader.js");
    const plyMod = await import("./vendor/three/examples/jsm/loaders/PLYLoader.js");
    THREE = threeMod;
    OrbitControls = orbitMod.OrbitControls;
    GLTFLoader = gltfMod.GLTFLoader;
    OBJLoader = objMod.OBJLoader;
    PLYLoader = plyMod.PLYLoader;
    return true;
  } catch (err) {
    console.error("Failed loading Three.js dependencies:", err);
    return false;
  }
}

let viewer = {
  setStatus(message) {
    viewerStatus.textContent = message;
  },
  async loadFromManifest() {
    viewerStatus.textContent = "Three.js 依赖加载失败，当前仅支持结果文件链接查看。";
  },
};

function renderJointPanel(joints) {
  if (!joints || joints.length === 0) {
    jointPanelControls.clear();
    jointPanel.innerHTML = "";
    jointPanel.textContent = "当前结果无可动关节（或当前加载的是静态 mesh）。";
    return;
  }
  const seen = new Set();
  joints.forEach((joint) => {
    seen.add(joint.id);
    const [low, high] = joint.range;
    let control = jointPanelControls.get(joint.id);
    if (!control) {
      const item = document.createElement("div");
      item.className = "joint-item";
      const title = document.createElement("div");
      title.className = "joint-title";
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = String(low);
      slider.max = String(high);
      slider.step = String((Math.abs(high - low) || 1) / 400);
      const value = document.createElement("div");
      slider.addEventListener("input", () => {
        const next = Number(slider.value);
        viewer.selectJoint?.(joint.id);
        // Do not force panel rebuild on each frame; keep drag continuous.
        viewer.updateJointValue?.(joint.id, next);
        value.textContent = `value: ${next.toFixed(3)}`;
      });
      item.append(title, slider, value);
      jointPanel.appendChild(item);
      control = { item, title, slider, value };
      jointPanelControls.set(joint.id, control);
    }
    control.title.textContent = `part_${joint.id} (${joint.type})${joint.selected ? " [已选中]" : ""}`;
    control.slider.min = String(low);
    control.slider.max = String(high);
    if (document.activeElement !== control.slider) {
      control.slider.value = String(joint.value);
    }
    control.value.textContent = `value: ${Number(joint.value).toFixed(3)}`;
  });

  // Remove stale controls not present in latest joints.
  for (const [id, control] of Array.from(jointPanelControls.entries())) {
    if (!seen.has(id)) {
      control.item.remove();
      jointPanelControls.delete(id);
    }
  }
}

async function initViewer() {
  const ok = await ensureThreeDeps();
  if (!ok) {
    viewerStatus.textContent = "模型查看依赖加载失败（CDN不可达），不影响上传与推理。";
    return;
  }
  viewer = new MinimalModelViewer(viewerContainer, viewerStatus);
  viewer.onJointStateChanged = (joints) => renderJointPanel(joints);
  resetPoseBtn.addEventListener("click", () => viewer.resetPose?.());
  toggleFullscreenBtn.addEventListener("click", () => {
    toggleViewerFullscreen().catch((err) => {
      console.error("toggle fullscreen failed", err);
      viewer.setStatus("全屏切换失败，已回退到普通模式。");
      applyViewerMaximizedState(false);
    });
  });
  bindFullscreenEvents();
}

function showResult(data) {
  resultJson.textContent = JSON.stringify(data, null, 2);
}

function setTaskProgress(value) {
  const progress = Math.max(0, Math.min(100, Number(value || 0)));
  taskProgressBar.style.width = `${progress}%`;
  taskProgressText.textContent = `总体进度: ${progress}%`;
}

function createLink(text, url) {
  const a = document.createElement("a");
  a.href = toAbsoluteUrl(url);
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = text;
  return a;
}

function renderResultLinks(manifest) {
  resultLinks.innerHTML = "";
  if (manifest.manifest_url) resultLinks.appendChild(createLink("result_manifest.json", manifest.manifest_url));
  if (manifest.meta_url) resultLinks.appendChild(createLink("meta.json", manifest.meta_url));
  if (manifest.input_image?.url) resultLinks.appendChild(createLink("input image", manifest.input_image.url));
  (manifest.object_json_files || []).forEach((item, i) =>
    resultLinks.appendChild(createLink(`object.json #${i + 1}`, item.url))
  );
  (manifest.preview_files || []).forEach((item, i) =>
    resultLinks.appendChild(createLink(`preview #${i + 1}`, item.url))
  );
  (manifest.mesh_files || []).forEach((item, i) =>
    resultLinks.appendChild(createLink(`mesh #${i + 1}`, item.url))
  );

  const preview = (manifest.preview_files || []).find((item) =>
    /\.(png|jpg|jpeg|webp|gif)$/i.test(item.url || "")
  );
  if (preview) {
    resultPreview.style.display = "block";
    resultPreview.src = toAbsoluteUrl(preview.url);
  } else {
    resultPreview.style.display = "none";
    resultPreview.removeAttribute("src");
  }
}

function renderResultCards(manifest) {
  resultCards.innerHTML = "";
  const cards = [
    { title: "任务状态", value: manifest.status || "-" },
    { title: "mesh 数量", value: String((manifest.mesh_files || []).length) },
    { title: "preview 数量", value: String((manifest.preview_files || []).length) },
    { title: "created", value: manifest.created_at || "-" },
    { title: "finished", value: manifest.finished_at || "-" },
  ];
  cards.forEach((item) => {
    const card = document.createElement("div");
    card.className = "result-card";
    card.innerHTML = `<h4>${item.title}</h4><div>${item.value}</div>`;
    resultCards.appendChild(card);
  });
}

async function fetchTaskResultManifest(taskId) {
  const response = await fetch(`${API_BASE}/api/task/${taskId}/result`);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function uploadSelectedFile(file) {
  uploadStatus.textContent = "上传中...";
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`${API_BASE}/api/upload`, { method: "POST", body: formData });
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json();
  uploadId = data.upload_id;
  uploadStatus.textContent = `上传成功，upload_id=${uploadId}`;
  inputPreview.src = URL.createObjectURL(file);
  showResult(data);
}

uploadBtn.addEventListener("click", async () => {
  const file = imageInput.files?.[0];
  if (!file) {
    uploadStatus.textContent = "请先选择图片";
    return;
  }
  try {
    await uploadSelectedFile(file);
  } catch (error) {
    uploadStatus.textContent = `上传失败: ${String(error)}`;
  }
});

demoImage.src = `${API_BASE}${DEMO_IMAGE_PATH}`;
demoImage.onerror = () => {
  uploadStatus.textContent =
    "demo 预览图加载失败：请确认后端已启动且可访问 /static/demo/demo_input.png";
};
initViewer();

demoUploadBtn.addEventListener("click", async () => {
  uploadStatus.textContent = "正在上传 demo 图片...";
  try {
    const resp = await fetch(`${API_BASE}/api/upload-demo`, { method: "POST" });
    if (!resp.ok) throw new Error(await resp.text());
    const data = await resp.json();
    uploadId = data.upload_id;
    uploadStatus.textContent = `demo 上传成功，upload_id=${uploadId}`;
    inputPreview.src = toAbsoluteUrl(data.file_url);
    showResult(data);
  } catch (error) {
    uploadStatus.textContent = `demo 上传失败: ${String(error)}`;
  }
});

taskBtn.addEventListener("click", async () => {
  if (!uploadId) {
    taskStatus.textContent = "请先上传图片";
    return;
  }
  taskStatus.textContent = "创建任务中...";
  resultStatus.textContent = "";
  setTaskProgress(0);
  try {
    const response = await fetch(`${API_BASE}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upload_id: uploadId, n_samples: 1 }),
    });
    if (!response.ok) throw new Error(await response.text());
    const task = await response.json();
    latestTaskId = task.task_id;
    latestTask = task;
    taskStatus.textContent = `任务已创建: ${latestTaskId}`;
    setTaskProgress(task.progress ?? 0);
    showResult(task);
    pollTask(latestTaskId);
  } catch (error) {
    taskStatus.textContent = `创建任务失败: ${String(error)}`;
  }
});

async function pollTask(taskId) {
  let keepPolling = true;
  while (keepPolling) {
    await new Promise((resolve) => setTimeout(resolve, 3500));
    const response = await fetch(`${API_BASE}/api/tasks/${taskId}`);
    if (!response.ok) {
      taskStatus.textContent = `查询任务失败: ${await response.text()}`;
      return;
    }
    const task = await response.json();
    latestTask = task;
    showResult(task);
    taskStatus.textContent = `任务状态: ${task.status}`;
    setTaskProgress(task.progress ?? 0);
    if (task.status === "succeeded" || task.status === "failed") {
      keepPolling = false;
      if (task.status === "succeeded") {
        resultStatus.textContent = "任务成功，正在加载统一结果清单和模型...";
        try {
          const manifest = await fetchTaskResultManifest(taskId);
          showResult(manifest);
          renderResultLinks(manifest);
          renderResultCards(manifest);
          await viewer.loadFromManifest(manifest, latestTask?.sample_urls || []);
          resultStatus.textContent = "结果清单和模型已加载";
        } catch (error) {
          resultStatus.textContent = `结果加载失败: ${String(error)}`;
          viewer.setStatus(`模型加载失败: ${String(error)}`);
        }
      } else {
        resultStatus.textContent = "任务失败，请查看错误信息或日志";
        viewer.setStatus("任务失败，无法加载模型。");
      }
    }
  }
}
