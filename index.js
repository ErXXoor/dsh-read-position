/**
 * dsh-read-position —— 宿主侧空壳。
 *
 * 全部逻辑在 client.js 里（纯 DOM + localStorage），宿主侧无事可做。
 * 这个文件存在的唯一原因是 cordis.patch.yml 需要插入一个可加载的插件行。
 */
export const name = "dsh-read-position";

export function apply() {
  // 无宿主行为
}
