// 通用菜单行为：打开聚焦首项、方向键导航、Enter 执行、Esc / 点击外部关闭并还原焦点。

export function menuItems(menu) {
  return Array.from(menu.querySelectorAll('[role="menuitem"], [role="option"]'));
}

export function openMenu(trigger, menu) {
  menu.classList.remove('hidden');
  trigger.setAttribute('aria-expanded', 'true');
  const items = menuItems(menu);
  items.forEach((it, i) => it.setAttribute('tabindex', i === 0 ? '0' : '-1'));
  items[0]?.focus();
}

export function closeMenu(trigger, menu, { restoreFocus = true } = {}) {
  menu.classList.add('hidden');
  trigger.setAttribute('aria-expanded', 'false');
  if (restoreFocus && typeof trigger.focus === 'function') trigger.focus();
}

export function handleMenuKeydown(e, trigger, menu) {
  const items = menuItems(menu);
  if (!items.length) return;
  const idx = items.indexOf(document.activeElement);
  let next = -1;
  if (e.key === 'ArrowDown') next = idx < 0 ? 0 : (idx + 1) % items.length;
  else if (e.key === 'ArrowUp') next = idx < 0 ? items.length - 1 : (idx - 1 + items.length) % items.length;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = items.length - 1;
  else if (e.key === 'Enter' || e.key === ' ') {
    if (idx >= 0) {
      e.preventDefault();
      e.stopPropagation();
      items[idx].click();
    }
    return;
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeMenu(trigger, menu);
    return;
  } else {
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  items.forEach((it, i) => it.setAttribute('tabindex', i === next ? '0' : '-1'));
  items[next]?.focus();
}
