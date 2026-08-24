#!/usr/bin/env node
/**
 * Ollama Usage 分享站 — 采集脚本（在 GitHub Actions 中运行，也可本机运行）
 *
 * 流程：
 *   1. 从环境变量 OLLAMA_COOKIE（Actions Secret）读取 ollama.com 登录 cookie
 *   2. 抓取 https://ollama.com/settings 用量页并解析
 *   3. 白名单清洗：只保留 plan / 用量百分比 / 各模型请求数
 *      —— 绝不输出 cookie、email、account 用户名、原始 HTML
 *   4. 写入 data/usage.json（快照）与 data/history.json（每日历史，封顶 60 条）
 *
 * 安全约定：
 *   - 本脚本任何日志都不得打印 cookie 全文（只打印长度/尾号）
 *   - 失败时以非零退出码结束 → Actions 会标红并发邮件提醒（如 cookie 过期）
 *
 * 本机用法：
 *   node scripts/fetch-usage.js            # 写 data/*.json（cookie 读 ~/.dsh/.../cookie.txt 或 OLLAMA_COOKIE）
 *   node scripts/fetch-usage.js --dry-run  # 只打印清洗结果，不写文件
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const COOKIE_FILE = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dsh-ollama-usage', 'cookie.txt');

// ── 解析（与 dsh-ollama-usage 插件同源逻辑） ─────────────────────────────────
function parseUsageHtml(html) {
  const out = { plan: null, account: null, email: null, meters: [], weeklyModels: [] };
  const plan = html.match(/capitalize"\s*>([^<]+)</);
  if (plan) out.plan = plan[1].trim();
  const account = html.match(/id="settings-account-name"[^>]*>\s*([^<]+)</);
  if (account) out.account = account[1].trim();
  const email = html.match(/id="header-email"[^>]*>\s*([^<]+)</);
  if (email) out.email = email[1].trim();
  const blocks = html.split('data-usage-meter');
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const labelMatch = block.match(/aria-label="([^"]+)"/);
    if (!labelMatch) continue;
    const resetMatch = block.match(/data-time="([^"]+)"/);
    const segments = [];
    const segRe = /style="width: ([^"]*?); background: ([^"]+)"[\s\S]*?data-usage-segment[\s\S]*?data-model="([^"]*)"[\s\S]*?data-requests="([^"]*)"/g;
    let m;
    while ((m = segRe.exec(block)) !== null) {
      segments.push({
        model: m[3],
        requests: parseInt(m[4], 10) || 0,
        width: parseFloat(m[1]) || 0,
        color: m[2],
      });
    }
    const label = labelMatch[1];
    let percent = null;
    const p = label.match(/([\d.]+)%\s*used/);
    if (p) percent = parseFloat(p[1]);
    out.meters.push({ label, percent, resetAt: resetMatch ? resetMatch[1] : null, segments });
  }
  const wm = html.match(/id="weekly-usage-models"([\s\S]*?)(?=<div id="extra-usage"|<\/section>)/);
  if (wm) {
    const rowRe = /style="background: ([^"]+)"[\s\S]*?title="([^"]+)"[\s\S]*?>\s*([\d,]+)\s*requests/g;
    let m;
    while ((m = rowRe.exec(wm[1])) !== null) {
      out.weeklyModels.push({
        model: m[2],
        requests: parseInt(m[3].replace(/,/g, ''), 10) || 0,
        color: m[1],
      });
    }
  }
  return out;
}

// ── 白名单清洗 ──────────────────────────────────────────────────────────────
function sanitize(data) {
  return {
    plan: data.plan,
    updatedAt: new Date().toISOString(),
    meters: data.meters.map((m) => ({
      label: m.label,
      percent: m.percent,
      resetAt: m.resetAt,
      segments: m.segments.map((s) => ({ model: s.model, requests: s.requests, color: s.color })),
    })),
    weeklyModels: data.weeklyModels.map((w) => ({ model: w.model, requests: w.requests, color: w.color })),
  };
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  let cookie = process.env.OLLAMA_COOKIE || '';
  if (!cookie && !dryRun) {
    if (existsSync(COOKIE_FILE)) cookie = readFileSync(COOKIE_FILE, 'utf8').trim();
  }
  if (!cookie) {
    throw new Error('未找到 cookie：请设置 Actions Secret OLLAMA_COOKIE（本机运行可留空自动读 ~/.dsh/dsh-ollama-usage/cookie.txt）');
  }
  console.log(`[${new Date().toISOString()}] 抓取 ollama.com/settings（cookie 长度 ${cookie.length}，尾号 ${cookie.slice(-4)}）...`);

  const res = await fetch('https://ollama.com/settings', {
    headers: { 'User-Agent': UA, Accept: 'text/html', Cookie: cookie },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`cookie 无效或已过期（HTTP ${res.status}）：请到仓库 Settings → Secrets and variables → Actions 更新 OLLAMA_COOKIE`);
  }
  if (res.status !== 200) throw new Error('ollama.com 返回 HTTP ' + res.status);
  const html = await res.text();
  const raw = parseUsageHtml(html);
  if (!raw.meters.length && !raw.plan) {
    if (/sign\s*in|log\s*in|auth/i.test(html)) {
      throw new Error('cookie 无效或已过期（页面跳转登录页）：请更新 Actions Secret OLLAMA_COOKIE');
    }
    throw new Error('页面结构不符合预期，可能 ollama.com 改版了');
  }
  const payload = sanitize(raw);

  if (dryRun) {
    console.log('── 清洗后（即将公开的全部内容，无任何凭据） ──');
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  // 写快照
  const dataDir = new URL('../data/', import.meta.url);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(new URL('usage.json', dataDir), JSON.stringify(payload, null, 2) + '\n');

  // 追加历史（按 UTC 日期去重，封顶 60 条）
  const historyUrl = new URL('../data/history.json', import.meta.url);
  let history = [];
  if (existsSync(historyUrl)) {
    try { history = JSON.parse(readFileSync(historyUrl, 'utf8')); } catch { history = []; }
    if (!Array.isArray(history)) history = [];
  }
  const today = new Date().toISOString().slice(0, 10);
  const session = payload.meters.find((m) => /session/i.test(m.label))?.percent ?? null;
  const weekly = payload.meters.find((m) => /weekly/i.test(m.label))?.percent ?? null;
  history = history.filter((h) => h && h.date !== today);
  history.push({ date: today, session, weekly });
  history.sort((a, b) => (a.date < b.date ? -1 : 1));
  if (history.length > 60) history = history.slice(-60);
  writeFileSync(historyUrl, JSON.stringify(history, null, 2) + '\n');

  console.log(`✓ 已写入 usage.json（${payload.meters.length} 个用量条，plan=${payload.plan}）与 history.json（${history.length} 条）`);
}

main().then(
  () => {},
  (e) => { console.error('✗ ' + e.message); process.exitCode = 1; },
);
