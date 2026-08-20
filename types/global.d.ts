// checkJs 兼容声明：旧代码里对 e.target 直接访问 closest/value/type 等前都有运行时守卫，
// 这里补上可选成员，避免逐个调用点做类型断言。
// 注意：这些成员必须用 any（而不是具体类型），且不能声明 dataset/blur ——
// strictNullChecks 下它们会与 lib.dom 的真实成员（HTMLOrSVGElement.dataset、
// HTMLInputElement.files 等）冲突，破坏整个 DOM 类型库。
interface EventTarget {
  closest?(selectors: string): Element | null;
  setPointerCapture?(pointerId: number): void;
  releasePointerCapture?(pointerId: number): void;
  tagName?: any;
  value?: any;
  checked?: any;
  files?: any;
  classList?: any;
  type?: any;
  disabled?: any;
  max?: any;
}

// 测试注入的弹窗自动确认标记（popup.js 读取，见 tests/helpers/dom-harness.mjs）
declare var __popupAutoConfirm: any;

// 自动化测试暴露的全局钩子（见 static/js/test-hooks.js）
interface Window {
  __app: any;
  __dragState: any;
  __interactionState: any;
  __testHooks: any;
  __FUSE_TEST__?: boolean;
}
