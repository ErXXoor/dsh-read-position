// 离线冒烟测试：用假 DOM 验证 client.js 的「记住 → 恢复」两条路径。
// 运行：node tests/smoke.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(here, "..", "client.js"), "utf8");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

/** 一个最小的预览容器：带路径标签、可滚动。 */
function makeBody(fileText, { height = 2000, view = 500 } = {}) {
  const pathEl = { textContent: "  " + fileText + "  " };
  const listeners = new Map();
  const el = {
    isConnected: true,
    scrollTop: 0,
    scrollHeight: height,
    clientHeight: view,
    parentElement: null,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    querySelector(sel) {
      return sel.includes("textpreview-path") ? pathEl : null;
    },
    fire(type) {
      for (const fn of listeners.get(type) || []) fn({ type });
    },
  };
  return el;
}

// ---- 假环境 ----
const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const docListeners = new Map();
let bodies = [];
const document = {
  body: {},
  documentElement: {},
  querySelectorAll: (sel) => (sel.includes("textpreview-body") ? bodies : []),
  addEventListener(type, fn) { docListeners.set(type, fn); },
  removeEventListener(type) { docListeners.delete(type); },
};

let captured = null;
const window = {
  __ModuleLoader__: {
    load(opts) { captured = opts; },
  },
  localStorage,
};

class MutationObserver {
  observe() {}
  disconnect() {}
}
class NoopObserver extends MutationObserver {}

// ---- 执行 client.js ----
const factory = new Function("window", "document", "localStorage", "MutationObserver", "setTimeout", "clearTimeout", code);
factory(window, document, localStorage, NoopObserver, setTimeout, clearTimeout);

check("client.js 注册到 __ModuleLoader__", !!captured);
check("模块 id 是包名", captured?.id === "dsh-read-position", captured?.id);

const mod = captured.factory();
check("factory 导出 apply", typeof mod.apply === "function");

// ---- 第一次：挂载 + 滚动 ----
const FILE = "/workspace/src/read-position-test.ts";
const body1 = makeBody(FILE);
bodies = [body1];

const ctx = {
  effect(fn, label) {
    const dispose = fn();
    check("ctx.effect 被调用并返回清理函数", typeof dispose === "function", label);
    return dispose;
  },
};

mod.apply(ctx);
await sleep(50);

body1.scrollTop = 700;
body1.fire("scroll");
await sleep(450); // 等 300ms 防抖

const key = "dsh-read-position:v1:p:" + FILE;
const saved = JSON.parse(store.get(key) || "null");
check("滚动后写入了 localStorage", !!saved, JSON.stringify(saved));
check("记录的位置是 700", saved?.top === 700, String(saved?.top));

// ---- 第二次：模拟切走再切回，出现一个新的容器 ----
const body2 = makeBody(FILE);
bodies = [body2];
docListeners.get("visibilitychange")?.(); // 触发补扫
await sleep(120);

check("重开后 scrollTop 被恢复", body2.scrollTop === 700, String(body2.scrollTop));

// ---- 第三次：另一个文件，不应串位 ----
const body3 = makeBody("/workspace/src/other.ts");
bodies = [body3];
docListeners.get("visibilitychange")?.();
await sleep(120);
check("不同文件不会误用别人的位置", body3.scrollTop === 0, String(body3.scrollTop));

// ---- 第四次：用户主动滚轮时，进行中的恢复应当让位 ----
store.set("dsh-read-position:v1:p:/workspace/src/long.ts", JSON.stringify({ top: 9000, at: Date.now() }));
const body4 = makeBody("/workspace/src/long.ts", { height: 600, view: 500 }); // 内容还短
bodies = [body4];
docListeners.get("visibilitychange")?.();
await sleep(50);
body4.fire("wheel"); // 用户动手
const afterWheel = body4.scrollTop;
await sleep(300);
check("用户滚动后恢复停止（画面不再被抢）", body4.scrollTop === afterWheel, `${afterWheel} -> ${body4.scrollTop}`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length === 0 ? 0 : 1);
