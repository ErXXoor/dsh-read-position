// dsh-read-position —— 客户端全部逻辑（纯浏览器 API，无依赖、无构建）
//
// 背景：内置文档预览把 scrollTop 存在「(session, tab id)」的 store 里，
// 切会话时 tab 的中止信号会清掉这份状态，于是切回工作区虽然标签还在，
// 内容却从顶部重新开始。这里把位置存到 localStorage，键是文件本身，
// 于是它活得比 tab 久。
//
// 依赖的 DOM 标记（来自 @deepseek-ai/dsh-client-ui-sidebar-documentpreview）：
//   [data-textpreview-body]  —— 真正的滚动容器
//   [data-textpreview-path]  —— 头部的路径标签（文本即完整路径）
//   [data-textpreview-url]   —— 该 tab 的 contentId（兜底键）
window.__ModuleLoader__.load({
  id: "dsh-read-position",
  factory: () => {
    var module = { exports: {} };
    var exports = module.exports;

    var PREFIX = "dsh-read-position:v1:";
    var BODY_SEL = "[data-textpreview-body]";
    var SAVE_DELAY_MS = 300;
    // 恢复期间最多尝试多久：内容按页加载，得一边把视口推到末尾触发下一页，
    // 一边等 scrollHeight 长到够得着目标位置。
    var RESTORE_WINDOW_MS = 6000;
    var TICK_MS = 60;

    /** body 元素 -> 记录 */
    var records = new WeakMap();
    var observer = null;
    var scanTimer = null;
    var started = false;

    function read(key) {
      try {
        var raw = window.localStorage.getItem(PREFIX + key);
        if (!raw) return null;
        var v = JSON.parse(raw);
        if (!v || typeof v.top !== "number" || !isFinite(v.top)) return null;
        return v;
      } catch (e) {
        return null;
      }
    }

    function write(key, value) {
      try {
        window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
      } catch (e) {
        /* 配额满或隐私模式：静默放弃，不影响阅读 */
      }
    }

    /**
     * 找出这个滚动容器属于哪个文件。
     * 优先用头部路径（同一文件跨会话共享位置），退回 contentId（限定本会话）。
     */
    function findKey(body) {
      var node = body;
      for (var depth = 0; depth < 8 && node; depth++, node = node.parentElement) {
        var pathEl = node.querySelector("[data-textpreview-path]");
        if (pathEl) {
          var text = (pathEl.textContent || "").trim();
          if (text) return "p:" + text;
        }
        var urlEl = node.querySelector("[data-textpreview-url]");
        if (urlEl) {
          var url = urlEl.getAttribute("data-textpreview-url");
          if (url) return "u:" + url;
        }
      }
      return null;
    }

    function scheduleSave(body, rec) {
      if (rec.saveTimer) clearTimeout(rec.saveTimer);
      rec.saveTimer = setTimeout(function () {
        rec.saveTimer = null;
        if (!body.isConnected || rec.restoring) return;
        write(rec.key, {
          top: Math.round(body.scrollTop),
          at: Date.now()
        });
      }, SAVE_DELAY_MS);
    }

    /** 内容分页加载时反复尝试；用户一动就放弃，别抢操作。 */
    function restore(body, rec) {
      var startedAt = Date.now();
      rec.restoring = true;

      function tick() {
        if (!body.isConnected || rec.cancelled) {
          rec.restoring = false;
          return;
        }
        var max = body.scrollHeight - body.clientHeight;
        if (max >= rec.target - 1) {
          body.scrollTop = rec.target;
          rec.restoring = false;
          return;
        }
        var elapsed = Date.now() - startedAt;
        if (elapsed > RESTORE_WINDOW_MS) {
          // 到时间还没长够（文件变短 / 加载失败）：停在能到的末尾，别无限等
          body.scrollTop = Math.max(0, max);
          rec.restoring = false;
          return;
        }
        // 推到当前末尾，触发内置的「滚到底加载下一页」
        body.scrollTop = Math.max(0, max);
        setTimeout(tick, TICK_MS);
      }

      tick();
    }

    function attach(body) {
      if (records.has(body)) return;
      var key = findKey(body);
      if (!key) return; // 路径还没渲染出来，等下一次 DOM 变化

      var saved = read(key);
      var rec = {
        key: key,
        target: saved ? Math.max(0, saved.top) : 0,
        restoring: false,
        cancelled: false,
        saveTimer: null
      };
      records.set(body, rec);

      body.addEventListener(
        "scroll",
        function () {
          if (rec.restoring) return;
          scheduleSave(body, rec);
        },
        { passive: true }
      );

      // 任何主动输入都取消进行中的恢复，避免和用户抢滚动条
      function cancel() {
        rec.cancelled = true;
        rec.restoring = false;
      }
      body.addEventListener("wheel", cancel, { passive: true });
      body.addEventListener("touchstart", cancel, { passive: true });
      body.addEventListener("keydown", cancel, { passive: true });

      if (rec.target > 0) restore(body, rec);
    }

    function scan() {
      scanTimer = null;
      var nodes = document.querySelectorAll(BODY_SEL);
      for (var i = 0; i < nodes.length; i++) attach(nodes[i]);
    }

    function scheduleScan() {
      if (scanTimer) return;
      scanTimer = setTimeout(scan, 30);
    }

    function start() {
      if (started) return;
      started = true;
      if (!document.body) {
        document.addEventListener("DOMContentLoaded", scheduleScan, { once: true });
      } else {
        scan();
      }
      observer = new MutationObserver(scheduleScan);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      // 标签被切回来但 DOM 没变化（仅显隐切换）时也补一次
      document.addEventListener("visibilitychange", scheduleScan);
    }

    function stop() {
      started = false;
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      document.removeEventListener("visibilitychange", scheduleScan);
      if (scanTimer) {
        clearTimeout(scanTimer);
        scanTimer = null;
      }
    }

    function apply(ctx) {
      ctx.effect(
        function () {
          start();
          return stop;
        },
        "dsh-read-position: remember preview scroll"
      );
    }

    exports.apply = apply;
    return module.exports;
  }
});
