// checkJs 兼容声明：旧代码里对 e.target 直接访问 closest/tagName 前都有运行时守卫，
// 这里补上可选成员，避免逐个调用点做类型断言。
interface EventTarget {
  closest?(selectors: string): Element | null;
  tagName?: string;
  value?: string;
  checked?: boolean;
  files?: FileList;
  dataset?: DOMStringMap;
  classList?: DOMTokenList;
  type?: string;
  disabled?: boolean;
  max?: string;
  blur?(): void;
}

// 自动化测试暴露的全局钩子（见 static/js/test-hooks.js）
interface Window {
  __app: any;
  __dragState: any;
  __testHooks: any;
  __FUSE_TEST__?: boolean;
}
