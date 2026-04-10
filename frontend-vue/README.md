# SINGAPO MVP — Vue 前端（独立目录）

与根目录下的 `frontend/` **并存**：不覆盖原生 HTML/JS 版本。后续功能优先在此目录迭代。

## 依赖

- Node.js 20+（建议 LTS）与 npm  
  - **Conda 环境**（如当前 Jupyter 镜像）：`conda install -y -c conda-forge nodejs=20`
- 已启动的后端 FastAPI（默认 `http://127.0.0.1:8000`）

## 安装与开发

```bash
cd /root/rivermind-data/project/frontend-vue
npm install
npm run dev
```

开发服务器默认监听 `0.0.0.0:5173`，并在 `vite.config.ts` 中将 `/api`、`/static` **代理**到 `127.0.0.1:8000`，因此前端代码里 `apiBase` 为空字符串即可。

## 从项目根目录一键启动

```bash
cd /root/rivermind-data/project
bash scripts/run_frontend_vue.sh
```

可选端口：`bash scripts/run_frontend_vue.sh 5174`

## 生产构建

```bash
npm run build
```

产物在 `dist/`。需由 Web 服务器托管，且能访问同一后端的 `/api` 与 `/static`（或配置 `VITE_API_BASE` 指向后端完整 origin）。

## 环境变量

- `VITE_API_BASE`：若前后端不同源，设为后端根地址（无尾部 `/`），例如 `https://api.example.com`。

## 结构说明

| 路径 | 说明 |
|------|------|
| `src/api/client.ts` | 与后端一致的 REST 调用 |
| `src/viewer/MinimalModelViewer.ts` | Three.js 查看器（与 `frontend/app.js` 逻辑对齐，独立维护） |
| `src/components/ModelViewerPanel.vue` | 查看器 + 关节滑条 + 全屏 |
| `src/App.vue` | 上传、任务轮询、结果展示 |
