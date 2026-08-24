# Ollama Usage 分享站

把 Ollama PRO 的用量公开成一个只读网页，分享给朋友看。**访客只能看到用量数字，永远接触不到你的 cookie / 邮箱 / 账号。**

## 链接

| 入口 | 地址 | 说明 |
|---|---|---|
| 国内 | https://bbj32.github.io/ollama-usage-share/ | GitHub Pages 静态托管，大陆直连可用；约 6~7 分钟更新 |
| 海外 / 1 分钟 | https://ollama-usage-share.qiuninglang01.workers.dev | Cloudflare Worker 直读数据库；大陆被墙（DNS+SNI），需代理 |

## 当前架构（2026-08 实况）

```
Cloudflare Worker（每分钟 cron）
  OLLAMA_COOKIE / GH_TOKEN（Worker Secret，加密存储）
    ↓ fetch ollama.com/settings（32KB SSR 页，无更轻的 JSON API）
    ↓ 正则解析 data-usage-meter 属性 → 白名单清洗（剔除 email/account/cookie/HTML）
    ↓ 写入 Cloudflare D1（usage / history / status）
    ├─→ GET /api/usage.json ──→ 海外访客（1 分钟新鲜度）
    └─→ 用量数字变化时（≥6 分钟节流，Git Data API 单 commit 双文件）
          → 提交 data/usage.json + data/history.json 到本仓库
            → GitHub Pages 自动重建 → 国内访客（~6-7 分钟新鲜度）
```

- Cookie 只存在于 Cloudflare Worker Secret；GitHub 写 token（GH_TOKEN）也只在 Cloudflare Secret
- 公开仓库/页面里只有：页面代码 + 清洗后的数字（已扫描验证：无邮箱、账号、cookie、密钥）
- 采集失败时页面顶部显示红色横幅（如 cookie 过期），数据保留上次成功快照

## 目录结构

```
├─ index.html                # GitHub Pages 仪表盘（国内入口，20 秒自动轮询）
├─ data/usage.json            # 用量快照（公开数据，由 Worker 提交更新）
├─ data/history.json          # 每日用量历史（封顶 30 条，Worker 提交）
├─ scripts/fetch-usage.js     # legacy：GitHub Actions 采集脚本（保留作备份）
├─ .github/workflows/fetch.yml # legacy：GitHub Actions 定时（实测 schedule 事件不触发，主链路不用）
└─ worker/                    # Cloudflare Worker 项目（独立部署，详见 worker/README.md，不进本公开仓库）
```

## 运维

- **cookie 过期**：`cd worker && wrangler secret put OLLAMA_COOKIE`（页面顶部横幅会提示同步异常）
- **手动触发推送**：等下一个整 6 分钟窗口（数据变化时自动推）；或直接改 `data/` 提交
- **看 Worker 日志**：`cd worker && wrangler tail`
- **看数据库状态**：`cd worker && wrangler d1 execute ollama-usage-db --remote --command "SELECT * FROM kv WHERE key='status'"`

## 国内访问与升级路径

- 免费方案已到平台极限：Pages 构建上限 10 次/小时 → 国内入口约 6~7 分钟；workers.dev 大陆被墙
- 若需国内 1 分钟直连：绑定自定义域名到 Worker（需自有域名，DNS 指向 Cloudflare）——部署见 `worker/README.md`
- 若需访问口令/私有化：GitHub Pages 静态托管无法鉴权；需私有仓库 + Worker（`SHARE_PASS`）方案

## 隐私提示

- 公开数据只有：套餐、用量百分比、重置时间、各模型请求数、更新时间；页面带 `noindex`
- 仓库公开 = 数据对全网可见（分享的目的）；不包含任何凭据
