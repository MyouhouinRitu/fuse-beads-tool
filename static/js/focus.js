// 弹窗焦点管理：打开时保存并移入焦点，关闭时还原；Tab 在弹窗内循环。

const FOCUSABLE_SELECTOR =
  'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

let activeDialog = null;
let restoreFocusEl = null;
let scrollLockCount = 0;

function focusableOf(dialog) {
  if (typeof dialog.querySelectorAll !== 'function') return [];
  return Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el) => !el.disabled);
}

function trapKeydown(e) {
  if (e.key !== 'Tab' || !activeDialog) return;
  const items = focusableOf(activeDialog);
  if (!items.length) {
    e.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

export function openDialog(dialog) {
  if (!dialog || activeDialog === dialog) return;
  closeDialog();
  activeDialog = dialog;
  restoreFocusEl = document.activeElement;
  focusableOf(dialog)[0]?.focus();
  document.addEventListener('keydown', trapKeydown, true);
  scrollLockCount += 1;
  document.body.style.overflow = 'hidden';
}

export function closeDialog() {
  if (!activeDialog) return;
  document.removeEventListener?.('keydown', trapKeydown, true);
  activeDialog = null;
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (!scrollLockCount) document.body.style.overflow = '';
  if (restoreFocusEl && typeof restoreFocusEl.focus === 'function') restoreFocusEl.focus();
  restoreFocusEl = null;
}

// 弹窗显隐 + 焦点管理的统一入口：所有对话框都走这里，避免各弹窗重复样板。
export function showDialog(dialog) {
  if (!dialog) return;
  dialog.classList.remove('hidden');
  openDialog(dialog);
}

export function hideDialog(dialog) {
  if (!dialog) return;
  closeDialog();
  dialog.classList.add('hidden');
}
