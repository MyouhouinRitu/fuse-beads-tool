// 原生对话框统一入口：确认 / 输入提示。
// 目前仍调用浏览器原生 confirm / prompt，后续可整体替换为自定义 UI，测试也可在此接管。

export function confirmDialog(message) {
  return window.confirm(message);
}

export function promptDialog(message, fallback) {
  return window.prompt(message, fallback);
}
