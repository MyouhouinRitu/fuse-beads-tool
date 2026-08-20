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
  // 保存快照时的对比原图镜像状态，切换快照时同步还原原图显示方向
  mirror?: { horizontal: boolean; vertical: boolean };
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
      mirrorBefore?: { horizontal: boolean; vertical: boolean };
      mirrorAfter?: { horizontal: boolean; vertical: boolean };
    };

type FusePoint = { x: number; y: number };

type FuseSettings = {
  targetPixels: number;
  useLab: boolean;
  sharpen: boolean;
  showCodes: boolean;
  emptyStyle: string;
  compare: boolean;
  syncPan: boolean;
  brushSize: number;
  sameColorSelect: boolean;
  wandSensitivity: number;
};

type FuseCompressed = {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
};

type FuseConfigSummary = {
  name: string;
  colorCount: number;
  updatedAt?: number;
  paletteHash?: string | null;
};

// 应用全局单例 App 的形状（state.js 持有；测试会直接读写这些字段，改动需同步 dom_contract_test）
type FuseAppState = {
  configs: FuseConfigSummary[];
  configName: string | null;
  palette: FusePaletteColor[];
  appliedPalette: FusePaletteColor[];
  project: FuseProject | null;
  compressed: FuseCompressed | null;
  originalFile: File | Blob | null;
  originalImage: HTMLImageElement | null;
  originalUrl: string | null;
  originalId: string | null;
  originalMirror: { horizontal: boolean; vertical: boolean };
  originalName: string | null;
  originalSha256: string | null;
  originalSize: number | null;
  projectName: string | null;
  origPan: FusePoint;
  origZoom: number;
  maxColors: number;
  baseGrid: Int16Array | null;
  sliderN: number | null;
  editedSinceSlider: boolean;
  brushColor: number | null;
  tool: string;
  selection: Set<number>;
  pan: FusePoint;
  history: FuseHistory;
  undoStack: FuseStep[];
  redoStack: FuseStep[];
  settings: FuseSettings;
  dirty: boolean;
  projectDirty: boolean;
  zoom: number;
  screenCell: number;
  highlightTimer: number | null;
  toastTimer: number | null;
  saveTimer: number | null;
  configTimer: number | null;
};

// 画布拖拽过程标记（drag.js 持有；仅存单次拖拽的瞬态）
type FuseDragState = {
  active: boolean;
  cropEdge: string | null;
  orig: boolean;
  moved: boolean;
  panning: boolean;
  startX: number;
  startY: number;
  panStart: FusePoint | null;
  origPanStart: FusePoint | null;
  downCell: FusePoint | null;
  selectionAnchor: FusePoint | null;
  shift: boolean;
  ctrl: boolean;
  straightStart: FusePoint | null;
  toggleLast: FusePoint | null;
};
type FuseCropRect = { x0: number; y0: number; x1: number; y1: number };

// 跨模块共享的瞬态交互状态（interaction.js 持有；不持久化，测试会直接读写）
type FuseInteractionState = {
  painting: boolean;
  lastCell: FusePoint | null;
  hoverCell: FusePoint | null;
  dragPreview: FuseCropRect | null;
  strokeBuffer: Array<{ x: number; y: number; from: number; to: number }> | null;
  highlightColor: number | null;
  highlightBlink: boolean;
  pickerCandidates: Array<{ i: number }> | null;
  pickerCell: { x: number; y: number; p: number; original: number } | null;
  pickerPreviewIndex: number | null;
  crop: FuseCropRect | null;
  cropActiveEdge: string | null;
  cropPreview: { horizontal: boolean; pos: number } | null;
};
