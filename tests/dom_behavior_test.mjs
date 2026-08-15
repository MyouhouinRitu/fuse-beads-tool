// DOM 行为测试聚合入口：子套件含顶层 await，必须串行动态加载，避免交错执行。
await import('./dom_state_test.mjs');
await import('./dom_editor_test.mjs');
await import('./dom_ui_test.mjs');

console.log('\nDOM 行为测试全部通过');
process.exit(0);
