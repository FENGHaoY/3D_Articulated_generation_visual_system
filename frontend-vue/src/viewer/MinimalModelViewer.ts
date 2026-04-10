import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import type { ResultManifest } from "../types/manifest";

export interface MovableJointInfo {
  id: number;
  type: string;
  range: [number, number];
  value: number;
  selected: boolean;
}

interface DiffuseTreeNode {
  id: number;
  parent: number;
  children?: number[];
  joint?: {
    type?: string;
    range?: [number, number];
    axis?: {
      direction?: [number, number, number];
      origin?: [number, number, number];
    };
  };
}

interface ObjectJsonRoot {
  diffuse_tree?: DiffuseTreeNode[];
}

function toAbsoluteUrl(pathOrUrl: string, apiBase: string): string {
  if (!pathOrUrl) return "";
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) return pathOrUrl;
  return `${apiBase}${pathOrUrl}`;
}

export class MinimalModelViewer {
  private disposed = false;
  private rafId = 0;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  private readonly gltfLoader = new GLTFLoader();
  private readonly objLoader = new OBJLoader();
  private readonly plyLoader = new PLYLoader();
  private currentRoot: THREE.Group;
  private selectedJointId: number | null = null;
  private dragging = false;
  private dragStartX = 0;
  private jointTree: DiffuseTreeNode[] = [];
  private readonly partObjects = new Map<number, THREE.Mesh>();
  private readonly initialMatrices = new Map<number, THREE.Matrix4>();
  private readonly currentJointValues = new Map<number, number>();
  private readonly parentMap = new Map<number, number>();
  private readonly descendantsCache = new Map<number, number[]>();
  onJointStateChanged: ((joints: MovableJointInfo[]) => void) | null = null;
  private readonly partBaseColors = new Map<number, number>();
  private activeAxisHelper: THREE.ArrowHelper | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly gridHelper: THREE.GridHelper;
  private readonly resizeObserver: ResizeObserver;
  private readonly apiBase: string;
  private readonly onCanvasPointerDown = (e: PointerEvent) => this.onPointerDown(e);
  private readonly onWinPointerMove = (e: PointerEvent) => this.onPointerMove(e);
  private readonly onWinPointerUp = () => (this.dragging = false);
  private readonly onWinResize = () => this.onResize();

  constructor(
    private readonly container: HTMLElement,
    private readonly setStatusText: (message: string) => void,
    apiBase = ""
  ) {
    this.apiBase = apiBase;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x111827);
    this.camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.01,
      1000
    );
    this.camera.position.set(2.5, 2, 2.5);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.setSize(container.clientWidth, container.clientHeight, false);
    this.container.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    this.currentRoot = new THREE.Group();
    this.scene.add(this.currentRoot);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x334155, 1.1);
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(4, 8, 5);
    this.gridHelper = new THREE.GridHelper(6, 12, 0x444444, 0x333333);
    this.gridHelper.position.y = 0;
    this.scene.add(hemi, dir, this.gridHelper);

    this.renderer.domElement.addEventListener("pointerdown", this.onCanvasPointerDown);
    window.addEventListener("pointermove", this.onWinPointerMove);
    window.addEventListener("pointerup", this.onWinPointerUp);
    window.addEventListener("resize", this.onWinResize);
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.container);
    this.animate();
  }

  setStatus(message: string) {
    this.setStatusText(message);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener("pointerdown", this.onCanvasPointerDown);
    window.removeEventListener("pointermove", this.onWinPointerMove);
    window.removeEventListener("pointerup", this.onWinPointerUp);
    window.removeEventListener("resize", this.onWinResize);
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
    this.renderer.dispose();
    this.clearRoot();
  }

  clearRoot() {
    this.scene.remove(this.currentRoot);
    this.currentRoot.traverse((obj) => {
      const o = obj as THREE.Mesh;
      if (o.geometry) o.geometry.dispose?.();
      const mat = o.material;
      if (mat) {
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose?.());
        else (mat as THREE.Material).dispose?.();
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

  async loadFromManifest(manifest: ResultManifest, sampleUrls: string[] = []) {
    this.clearRoot();
    this.setStatus("正在加载模型...");

    const objectJsonUrl = this.pickObjectJsonUrl(manifest, sampleUrls);
    if (objectJsonUrl) {
      await this.loadArticulatedFromObjectJson(objectJsonUrl);
      return;
    }

    const preferred = this.pickPreferredMesh(manifest.mesh_files || []);
    if (preferred?.url) {
      await this.loadMeshFile(preferred.url);
      this.alignModelToGround();
      this.emitJointStateChanged();
      this.setStatus("模型已加载（基础查看: 旋转/缩放/平移）");
      return;
    }

    this.emitJointStateChanged();
    this.setStatus("未找到可直接加载的 glb/gltf/obj/ply，且没有 object.json。");
  }

  private pickPreferredMesh(meshFiles: { url?: string }[]) {
    const byExt = (ext: string) => meshFiles.find((f) => (f.url || "").toLowerCase().endsWith(ext));
    return byExt(".glb") || byExt(".gltf") || byExt(".obj") || byExt(".ply") || meshFiles[0];
  }

  private pickObjectJsonUrl(manifest: ResultManifest, sampleUrls: string[]) {
    const fromManifest = (manifest.object_json_files || [])[0]?.url;
    if (fromManifest) return fromManifest;
    if (sampleUrls.length > 0) return sampleUrls[0];
    return null;
  }

  private async loadMeshFile(url: string) {
    const absUrl = toAbsoluteUrl(url, this.apiBase);
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
      const mat = new THREE.MeshStandardMaterial({
        color: 0xbcd4ff,
        metalness: 0.1,
        roughness: 0.8,
      });
      this.currentRoot.add(new THREE.Mesh(geo, mat));
    } else {
      throw new Error(`暂不支持格式: ${url}`);
    }
    this.fitCameraToObject(this.currentRoot);
  }

  private async loadArticulatedFromObjectJson(objectJsonUrl: string) {
    this.setStatus("检测到 SINGAPO object.json，尝试按关节参数加载可动部件...");
    const objResp = await fetch(toAbsoluteUrl(objectJsonUrl, this.apiBase));
    if (!objResp.ok) throw new Error(await objResp.text());
    const objectJson = (await objResp.json()) as ObjectJsonRoot;
    this.jointTree = objectJson.diffuse_tree || [];
    for (const node of this.jointTree) {
      this.parentMap.set(node.id, node.parent);
      this.currentJointValues.set(node.id, 0);
      this.descendantsCache.set(node.id, this.collectDescendants(node.id));
    }

    const baseUrl = toAbsoluteUrl(objectJsonUrl, this.apiBase).replace(/object\.json$/i, "");
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
      } catch {
        /* optional parts */
      }
    }
    for (const [id, obj] of this.partObjects.entries()) {
      this.initialMatrices.set(id, obj.matrix.clone());
      obj.matrixAutoUpdate = false;
    }
    this.recomputeAllPartTransforms();
    this.alignModelToGround();
    this.fitCameraToObject(this.currentRoot);
    this.emitJointStateChanged();
    this.setStatus(
      "关节可视化已启用：点击可动部件后左右拖动，或使用右侧面板滑条。MVP 近似交互（非完整 URDF）。"
    );
  }

  private collectDescendants(rootId: number): number[] {
    const out: number[] = [];
    const dfs = (id: number) => {
      out.push(id);
      const node = this.jointTree.find((n) => n.id === id);
      (node?.children || []).forEach((c) => dfs(c));
    };
    dfs(rootId);
    return out;
  }

  private getChainToRoot(partId: number): number[] {
    const chain: number[] = [];
    let cur: number | undefined = partId;
    while (cur !== -1 && cur !== undefined) {
      chain.push(cur);
      cur = this.parentMap.get(cur);
    }
    return chain.reverse();
  }

  private getJointTransformForNode(nodeId: number): THREE.Matrix4 {
    const node = this.jointTree.find((n) => n.id === nodeId);
    if (!node?.joint) return new THREE.Matrix4();
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

  private recomputeAllPartTransforms() {
    for (const [partId, obj] of this.partObjects.entries()) {
      const chain = this.getChainToRoot(partId);
      const total = new THREE.Matrix4().identity();
      for (const id of chain) {
        total.multiply(this.getJointTransformForNode(id));
      }
      const init = this.initialMatrices.get(partId);
      if (!init) continue;
      const final = new THREE.Matrix4().multiplyMatrices(total, init);
      obj.matrix.copy(final);
      obj.matrix.decompose(obj.position, obj.quaternion, obj.scale);
    }
  }

  private onPointerDown(event: PointerEvent) {
    if (!this.partObjects.size) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersects = this.raycaster.intersectObjects(Array.from(this.partObjects.values()));
    if (!intersects.length) return;
    const partId = intersects[0].object.userData.partId as number;
    const node = this.jointTree.find((n) => n.id === partId);
    if (!node?.joint || node.joint.type === "fixed") {
      this.setStatus("该部件为 fixed joint，不可交互。");
      return;
    }
    this.selectJoint(partId);
    this.dragging = true;
    this.dragStartX = event.clientX;
    this.setStatus(`已选中关节 part_${partId} (${node.joint.type})，左右拖动调整。`);
  }

  private onPointerMove(event: PointerEvent) {
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

  selectJoint(partId: number) {
    this.selectedJointId = partId;
    this.applySelectionHighlight();
    this.showJointAxis(partId);
    this.emitJointStateChanged();
  }

  private applySelectionHighlight() {
    for (const [id, mesh] of this.partObjects.entries()) {
      const base = this.partBaseColors.get(id) || 0x93c5fd;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.color.setHex(base);
      mat.emissive = new THREE.Color(0x000000);
      if (id === this.selectedJointId) {
        mat.emissive = new THREE.Color(0x334155);
      }
    }
  }

  private showJointAxis(partId: number) {
    if (this.activeAxisHelper) {
      this.scene.remove(this.activeAxisHelper);
      this.activeAxisHelper = null;
    }
    const node = this.jointTree.find((n) => n.id === partId);
    if (!node?.joint || node.joint.type === "fixed") return;
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

  updateJointValue(partId: number, value: number) {
    this.currentJointValues.set(partId, value);
    this.recomputeAllPartTransforms();
    this.alignModelToGround();
    this.emitJointStateChanged();
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
    this.emitJointStateChanged();
    this.setStatus("姿态已复位");
  }

  getMovableJoints(): MovableJointInfo[] {
    return this.jointTree
      .filter((n) => n.joint && n.joint.type !== "fixed")
      .map((n) => ({
        id: n.id,
        type: n.joint!.type!,
        range: n.joint!.range || [0, 0],
        value: this.currentJointValues.get(n.id) ?? 0,
        selected: n.id === this.selectedJointId,
      }));
  }

  private emitJointStateChanged() {
    this.onJointStateChanged?.(this.getMovableJoints());
  }

  private alignModelToGround() {
    const box = new THREE.Box3().setFromObject(this.currentRoot);
    if (box.isEmpty()) return;
    const offset = -box.min.y;
    this.currentRoot.position.y += offset;
  }

  private fitCameraToObject(object3D: THREE.Object3D) {
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
    this.renderer.setSize(w, h, false);
  }

  private animate() {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
