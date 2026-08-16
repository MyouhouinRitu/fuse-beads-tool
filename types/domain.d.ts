// 前端核心领域类型（checkJs 使用）。
// 当前 tsconfig 尚未开启 strict，这些类型先作为编辑器提示与后续开启
// noImplicitAny / strictNullChecks 时的类型地基；新代码应尽量引用这里的类型。

type FusePaletteColor = {
  index: number;
  code: string;
  name: string;
  hex: string;
};

type FuseProject = {
  width: number;
  height: number;
  grid: Int16Array;
};

// 快照网格：内存态为 Int16Array，自动保存载荷为 base64，旧状态兼容普通数组
type FuseSnapshot = {
  width: number;
  height: number;
  grid: Int16Array | number[];
  baseGrid?: Int16Array | number[];
  paletteName?: string | null;
  palette?: FusePaletteColor[];
  paletteHash?: string;
  maxColors?: number;
};

type FuseHistoryItem = {
  id: number;
  createdAt: number;
  label: string;
  snapshot: FuseSnapshot;
};

type FuseHistory = {
  items: FuseHistoryItem[];
  currentId: number | null;
  nextId: number;
  baselineId: number | null;
};

type FuseStepChange = {
  x: number;
  y: number;
  from: number;
  to: number;
};

type FuseStep =
  | { changes: FuseStepChange[] }
  | {
      structural: true;
      type: string;
      before: FuseSnapshot;
      after: FuseSnapshot;
    };
