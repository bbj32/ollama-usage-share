# Ollama Usage 分享站

把 Ollama PRO 的用量公开成一个只读网页，分享给朋友看。**访客只能看到用量数字，永远接触不到你的 cookie / 邮箱 / 账号。**

- 采集：GitHub Actions 每 15 分钟自动抓取一次（cookie 存在仓库 **Actions Secret**，加密存储）
- 展示：GitHub Pages 静态页，数据落盘在 `data/usage.json`
- 你本机：零运行、零部署

## 架构与安全模型

```
GitHub Actions（云端定时任务）
  OLLAMA_COOKIE（Secret，加密存储，不进代码/日志/页面）
    ↓ 抓取 ollama.com/settings → 白名单清洗
    ↓ 只写数字：plan / 用量% / 各模型请求数
data/usage.json ──► GitHub Pages 静态站（访客只看这个）
```

- Cookie 只存在于仓库 Settings → Secrets，任何人（含访客）都无法从站点或仓库文件里读到
- 清洗脚本**硬编码排除** `email` / `account` / 原始 HTML / 请求头，公开 JSON 是重建的白名单对象
- 采集失败（如 cookie 过期）时工作流标红，GitHub 会自动给你发失败邮件提醒

## 目录结构

```
├─ index.html                # 仪表盘页面（中文，双进度条 + 模型分布 + 历史）
├─ data/usage.json           # 用量快照（公开数据，定时更新）
├─ data/history.json         # 每日用量历史（封顶 60 条）
├─ scripts/fetch-usage.js    # 采集+清洗脚本（Actions 中运行）
└─ .github/workflows/fetch.yml  # 每 15 分钟同步 + 手动触发
```

## 部署步骤（约 5 分钟）

### 1. 建一个 GitHub 公开仓库

GitHub Pages 免费版要求仓库公开。仓库名如 `ollama-usage-share`。

### 2. 推送本项目

```bash
git init
git add .
git commit -m "init: ollama usage share"
git branch -M main
git remote add origin https://github.com/<你的用户名>/ollama-usage-share.git
git push -u origin main
```

### 3. 设置 Secret：OLLAMA_COOKIE

仓库 → **Settings → Secrets and variables → Actions → New repository secret**：

- Name：`OLLAMA_COOKIE`
- Secret：粘贴 ollama.com 的登录 cookie

> 从哪拿 cookie：DSH「设置 → Ollama Usage」页面粘贴的那串就是；或本机 `~/.dsh/dsh-ollama-usage/cookie.txt` 的内容。整段复制（一串以 `session=` 开头、分号分隔的键值对，通常几百字符）。

### 4. 启用 Pages

仓库 → **Settings → Pages** → Source 选 **Deploy from a branch** → Branch 选 `main` / `(root)` → Save。

### 5. 首次同步

仓库 → **Actions** → 左侧 `sync-usage` → **Run workflow**。完成后访问：

```
https://<你的用户名>.github.io/<仓库名>/
```

之后每 15 分钟自动更新。页面 60 秒自动刷新。

## 更新 cookie / 手动刷新

- cookie 过期（Actions 变红并邮件提醒）→ 更新 Secret 里的 `OLLAMA_COOKIE` → Actions 里手动 Run workflow
- 随时手动刷新 → Actions → sync-usage → Run workflow

## 国内访问说明

`*.github.io` 在大陆可能不稳定。两个选项：

1. **绑定自定义域名**（推荐）：Settings → Pages → Custom domain 填你的域名（如 `usage.xxx.com`），并在 DNS 处解析到 `185.199.108.153` 等 Pages 地址或 CNAME 到 `<用户名>.github.io`。需要你有域名。
2. 之后想换 Cloudflare Workers（可加访问口令、国内可挂域名）：数据管道不变，只是把 `data/usage.json` 换成 Worker 的只读接口——需要时可以帮你迁移。

## 隐私提示

- 仓库是公开的：`data/usage.json` 与页面本身对全网可见（这正是分享的目的）。页面已带 `noindex` 防止被搜索引擎收录。
- 公开数据只有：套餐、用量百分比、重置时间、各模型请求数、更新时间。**不含**邮箱、账号名、cookie。
- 若想对访问者设口令/白名单，GitHub Pages 静态托管做不了真正的鉴权，届时升级到 Cloudflare Worker（`SHARE_PASS`）方案即可。
