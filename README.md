# dsh-read-position

记住内置文件预览的**阅读位置**。切换工作区 / 会话后回到同一个文件，不再从顶部开始。

## 解决什么问题

DSH 的内置文档预览其实**有**位置记忆 —— 它把 `scrollTop` 存在
`(session, tab id)` 的 store 里，代码里就是 `actions.scrolled(tab.id, body.scrollTop)`。

但这份状态跟着 tab 的中止信号走。**切会话时 tab 记录会保留（标签还在），
store 里的滚动位置却被清掉**，于是切回工作区时内容从 `scrollTop: 0` 重新开始。

本插件把位置存到 **localStorage**，键是文件本身而不是 tab：

```
dsh-read-position:v1:p:<文件绝对路径>   →  { top, at }
```

它活在 tab 生命周期之外，所以切会话、关标签、刷新页面都还在。

## 行为

- 滚动时（300ms 防抖）写入位置；每 300ms 最多一次写
- 预览重新出现时写回位置
- 内容按页加载：恢复期间会把视口推到当前末尾触发内置的「滚到底加载下一页」，
  直到目标位置可达或超过 6 秒
- **用户一动手就让位**：滚轮 / 触摸 / 按键立即取消进行中的恢复
- 文件变短或加载失败时停在能到的末尾，不无限等待
- 位置存在浏览器 localStorage，不出本机；清站点数据会丢

## 键的选择

优先用头部路径标签（`[data-textpreview-path]` 的文本，通常是绝对路径），
这样同一个文件在不同会话里共享位置；拿不到路径时退回该 tab 的 contentId
（`[data-textpreview-url]`），此时位置按会话隔离。

## 局限

- 只作用于**文本预览**（`[data-textpreview-body]`）。PDF / Office / 图片走各自的
  缩放视图，不在此列。
- 依赖 DSH 的 DOM 标记。上游改了 `data-textpreview-*` 属性名就会静默失效 ——
  症状是「插件装了但没效果」，不会报错。
- 位置按字节级 `scrollTop` 存，字号或窗口宽度变化后会落在附近而不是精确同一行。

## 安装

```powershell
dsh plugin --profile desktop add file:C:\Users\lihongbo\Documents\deepseek-harness\default-workspace\dsh-read-position
```

或者用插件页的「添加插件」填 `file:` 路径。装完**重启 DSH**，然后硬刷新页面。
