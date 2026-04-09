# 基于 SINGAPO 的单视图可动三维生成可视化系统（MVP）说明

本文档用于说明当前 `project/` 下各目录职责，以及第一阶段 MVP 的实现进度。

## 1. 目录职责

### `singapo/`
- 角色：原始 SINGAPO 仓库（模型、权重、推理脚本、训练/测试代码）。
- 原则：尽量不改动，不混入系统业务代码。
- 当前使用方式：后端通过子进程调用 `singapo/demo/demo.py` 执行推理。

### `backend/`
- 角色：MVP 后端服务（FastAPI）。
- 职责：
  - 提供上传、建任务、查任务等 API；
  - 触发 SINGAPO 推理；
  - 管理任务状态和结果索引；
  - 对外暴露 `runtime/` 静态资源路径。
- 关键文件：
  - `backend/app/main.py`：FastAPI 入口与路由定义；
  - `backend/app/services/singapo_runner.py`：SINGAPO 推理适配层（统一入口）；
  - `backend/app/services/result_organizer.py`：结果整理模块（统一结果清单输出）；
  - `backend/app/services/task_service.py`：任务生命周期管理；
  - `backend/app/services/storage_service.py`：任务状态本地持久化；
  - `backend/app/core/config.py`：系统路径与环境配置。

### `frontend/`
- 角色：MVP 前端页面（静态 HTML + JS）。
- 职责：
  - 上传图片；
  - 提交任务；
  - 轮询任务状态；
  - 展示任务返回 JSON。
- 关键文件：
  - `frontend/index.html`：页面结构；
  - `frontend/app.js`：上传/提交流程与轮询逻辑；
  - `frontend/style.css`：基础样式。

### `runtime/`
- 角色：运行时数据目录（非源码）。
- 职责：
  - `runtime/uploads/`：上传图片；
  - `runtime/jobs/`：任务状态文件（当前为 `tasks.json`）；
  - `runtime/results/`：每个任务的推理输出；
  - `runtime/logs/`：运行日志（预留）。
- 说明：后端启动时自动创建缺失目录。

### `scripts/`
- 角色：启动与自检脚本。
- 当前脚本：
  - `scripts/run_backend.sh`：启动后端；
  - `scripts/run_frontend.sh`：启动前端静态服务；
  - `scripts/smoke_test.sh`：接口冒烟测试（上传 + 建任务 + 轮询）。

### `docs/`
- 角色：系统与方案文档目录。
- 当前文档：
  - `docs/设计方案.md`：总体方案设计（已有）；
  - `docs/README_system.md`：本文件，记录当前实现状态。

### `data/`
- 角色：数据目录（与 SINGAPO 约定路径兼容）。
- 当前作用：作为推理阶段 `--gt_data_root` 所指向的数据根目录。

## 2. 当前已实现情况（第一阶段 MVP）

### 2.1 SINGAPO 推理入口分析结论
- 当前最适合后端调用的真实入口：`singapo/demo/demo.py`。
- 选择原因：
  - 这是仓库中明确的单图推理脚本（`README.md` 的 Quick Demo）；
  - 参数清晰、输入是单张图像，输出结构稳定；
  - 无需侵入修改 SINGAPO 核心代码。
- 后端采用的包装方式：**CLI 子进程调用**（`conda run -n singapo python demo/demo.py ...`），而不是直接 import 函数。
  - 原因：`demo.py` 内部依赖 CUDA、Torch、DINO、OpenAI 等运行时上下文，CLI 方式更稳且与官方用法一致。
- `demo.py` 关键参数（已按原脚本接入）：
  - `--img_path`：输入单视图图片路径；
  - `--ckpt_path`：权重路径（默认 `exps/singapo/final/ckpts/last.ckpt`）；
  - `--config_path`：配置路径（默认 `exps/singapo/final/config/parsed.yaml`）；
  - `--save_dir`：输出目录；
  - `--gt_data_root`：数据根目录；
  - `--n_samples`、`--n_denoise_steps`、`--omega`；
  - `--use_example_graph`：跳过 GPT 图预测，使用 `demo/example_graph.json`。
- 当前 MVP 默认策略：
  - `.env` 中 `DEFAULT_USE_EXAMPLE_GRAPH=true`，即优先跑通不依赖 GPT 的流程；
  - 上传图片直接走 `demo.py` 推理。
- 已确认当前 `demo.py` 产物（以 `singapo/demo/demo_output` 为准）主要为：
  - `pred_graph.json`；
  - `<sample_id>/object.json`（每个采样一个）；
  - 在本系统运行时还会有 `run.log`、`task_result_metadata.json`，以及可能出现的 `object.ply` / 预览文件（取决于检索与渲染产物）。

### 已完成
- 后端最小 API 已实现：
  - `GET /api/health`
  - `POST /api/upload`
  - `POST /api/tasks`
  - `GET /api/tasks`
  - `GET /api/tasks/{task_id}`
- 前端最小流程已实现：
  - 图片上传 -> 创建任务 -> 状态轮询 -> 结果 JSON 展示。
- 推理调用链已打通（架构层面）：
  - 后端任务线程 -> `SingapoRunner` -> `singapo/demo/demo.py`。
- 结果组织已实现：
  - 每个任务输出落盘至 `runtime/results/<task_id>/`；
  - 统一元数据文件：`runtime/results/<task_id>/task_result_metadata.json`；
  - 统一结果清单：`runtime/results/<task_id>/meta.json` 与 `runtime/results/<task_id>/result_manifest.json`；
  - 标准化结果字段：`task_result_dir`、`mesh_file_path`（若存在）、`metadata_json_path`、`preview_asset_path`（若存在）；
  - 推理 stdout/stderr 同时写入 `runtime/logs/<task_id>.log`；
  - 任务状态持久化在 `runtime/jobs/tasks.json`。

### 环境约束（重要）
- `singapo` 推理必须运行在 Conda 环境 `singapo` 中。
- 当前后端默认使用：
  - `conda run -n singapo python demo/demo.py`
- 相关配置在项目根 `.env`：
  - `SINGAPO_CONDA_ENV=singapo`（默认推荐）
  - `SINGAPO_PYTHON=...`（仅在 Conda 环境名留空时作为回退）

## 3. 当前配置文件

项目根建议有 `.env`（可由 `.env.example` 复制）：

- `SINGAPO_ROOT`：SINGAPO 仓库绝对路径；
- `RUNTIME_ROOT`：运行时目录绝对路径；
- `SINGAPO_CONDA_ENV`：Conda 环境名（默认 `singapo`）；
- `SINGAPO_PYTHON`：回退 Python 路径；
- `API_HOST`、`API_PORT`：后端监听地址和端口；
- `DEFAULT_USE_EXAMPLE_GRAPH`：是否默认使用示例图结构（跳过 GPT 图预测）。

## 4. 运行方式（当前版本）

1) 配置环境变量：
- 复制 `.env.example` 为 `.env`；
- 确认 `SINGAPO_CONDA_ENV=singapo`。

2) 启动后端：
- `bash scripts/run_backend.sh`

3) 启动前端：
- `bash scripts/run_frontend.sh`

4) 访问前端：
- `http://<server-ip>:8080`

5) 静态资源访问（后端提供）：
- `/static/uploads/...`（上传图片）
- `/static/results/...`（任务结果、预览、mesh、manifest）

## 5. 已知边界（MVP 范围内）

- 未实现用户系统、权限系统、多用户隔离；
- 任务执行为进程内线程触发，未接入队列系统（如 Celery/Redis）；
- 前端当前为最简页面，结果展示以 JSON 为主，尚未接入复杂三维交互视图；
- 任务状态存储为本地 JSON 文件，适用于单机 MVP 验证。

## 6. 下一步建议（第二批迭代）

- 前端增加结果文件链接区（`pred_graph.json`、样本 `object.json`）；
- 将任务执行从线程升级为独立 worker（仍保持单机）；
- 增加结构化日志与失败诊断信息页面；
- 引入 Three.js 最小可视化视图（先做结果结构浏览，再逐步加入关节交互）。

## 7. 已记录的扩展方案（后续实现）

你提出的“示例图片驱动 + 预预测图复用”方案已记录，后续按此方向扩展：

- 前端新增“示例图片面板”，按以下层级展示并可点击作为上传：
  - 数据集 -> 类别 -> model_id -> 视图；
- 用户点击示例图时，前端除上传图片外，同时携带：
  - `dataset`、`category`、`model_id`、`view_id` 等元信息；
- 后端根据这些元信息，从预预测图目录映射图结构：
  - `singapo/exps/pred_graph/pred_graph/<dataset>/...json`
- 若命中预预测图，则走“跳过 GPT 图预测”的推理分支；
- 当前阶段先确保 `demo.py` 跑通，扩展逻辑在下一迭代接入，不改 SINGAPO 核心代码。
