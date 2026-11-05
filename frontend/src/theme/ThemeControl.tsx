import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import './theme-control.css';

type Theme = 'light' | 'dark' | 'system';
const themes = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
] as const;

function tabStopsOutside(menu: HTMLElement | null): HTMLElement[] {
  const controls = Array.from(
    document.querySelectorAll<HTMLElement>(
      'a[href], area[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex], [contenteditable="true"]',
    ),
  ).filter((element) => {
    if (
      menu?.contains(element) ||
      element.matches(':disabled') ||
      element.tabIndex < 0
    )
      return false;
    const visibility = window.getComputedStyle(element).visibility;
    if (visibility === 'hidden' || visibility === 'collapse') return false;
    for (
      let parent: HTMLElement | null = element;
      parent;
      parent = parent.parentElement
    ) {
      if (
        parent.hidden ||
        parent.hasAttribute('inert') ||
        window.getComputedStyle(parent).display === 'none'
      )
        return false;
      if (
        parent instanceof HTMLDetailsElement &&
        !parent.open &&
        !parent.querySelector(':scope > summary')?.contains(element)
      )
        return false;
    }
    return true;
  });
  return controls
    .filter((element) => {
      if (
        !(element instanceof HTMLInputElement) ||
        element.type !== 'radio' ||
        !element.name
      )
        return true;
      const group = controls.filter(
        (candidate): candidate is HTMLInputElement =>
          candidate instanceof HTMLInputElement &&
          candidate.type === 'radio' &&
          candidate.name === element.name &&
          candidate.form === element.form,
      );
      return (
        element === (group.find((candidate) => candidate.checked) ?? group[0])
      );
    })
    .sort((left, right) => {
      // Positive tabindex values precede ordinary DOM-order controls in native traversal.
      const leftOrder =
        left.tabIndex > 0 ? left.tabIndex : Number.MAX_SAFE_INTEGER;
      const rightOrder =
        right.tabIndex > 0 ? right.tabIndex : Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder;
    });
}

export function ThemeControl() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem('eduflow-theme');
      return saved === 'light' || saved === 'dark' ? saved : 'system';
    } catch {
      return 'system';
    }
  });
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(2);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const openingIndex = useRef(2);
  const menuId = useId();

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
    };
    apply();
    media.addEventListener('change', apply);
    try {
      localStorage.setItem('eduflow-theme', theme);
    } catch {
      /* Theme remains usable when storage is unavailable. */
    }
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const anchor = trigger.getBoundingClientRect();
      const bounds = menu.getBoundingClientRect();
      const width = bounds.width || 180;
      const height = bounds.height || 148;
      const viewportWidth =
        document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight =
        document.documentElement.clientHeight || window.innerHeight;
      const left = Math.max(
        8,
        Math.min(anchor.right - width, viewportWidth - width - 8),
      );
      const below = anchor.bottom + 8;
      const preferredTop =
        below + height <= viewportHeight - 8 ? below : anchor.top - height - 8;
      const top = Math.max(
        8,
        Math.min(preferredTop, viewportHeight - height - 8),
      );
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
    };
    position();
    itemRefs.current[openingIndex.current]?.focus();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: Event) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        // Preserve the focus destination of an outside click or Tab movement.
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', dismissOutside, true);
    document.addEventListener('focusin', dismissOutside);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true);
      document.removeEventListener('focusin', dismissOutside);
    };
  }, [open]);

  const openMenu = () => {
    const selected = themes.findIndex((option) => option.value === theme);
    openingIndex.current = selected;
    setActiveIndex(selected);
    setOpen(true);
  };
  const closeAndRestoreFocus = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  const moveFocus = (index: number) => {
    setActiveIndex(index);
    itemRefs.current[index]?.focus();
  };
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      const controls = tabStopsOutside(menuRef.current);
      const triggerIndex = controls.findIndex(
        (control) => control === triggerRef.current,
      );
      const destination = controls[triggerIndex + (event.shiftKey ? -1 : 1)];
      setOpen(false);
      if (triggerIndex >= 0 && destination) {
        event.preventDefault();
        destination.focus();
      } else {
        // At the document boundary, let the browser continue into its own chrome.
        triggerRef.current?.focus();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeAndRestoreFocus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(
        (activeIndex + (event.key === 'ArrowDown' ? 1 : 2)) % themes.length,
      );
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      moveFocus(event.key === 'Home' ? 0 : themes.length - 1);
    }
  };
  const TriggerIcon = themes.find((option) => option.value === theme)!.Icon;

  return (
    <div className="theme-control">
      <button
        ref={triggerRef}
        type="button"
        className="theme-trigger"
        aria-label="Color theme"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openMenu();
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            closeAndRestoreFocus();
          }
        }}
      >
        <TriggerIcon size={18} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            className="theme-menu"
            role="menu"
            aria-label="Color theme"
            onKeyDown={onMenuKeyDown}
          >
            {themes.map(({ value, label, Icon }, index) => (
              <button
                key={value}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={theme === value}
                className="theme-menu-item"
                tabIndex={activeIndex === index ? 0 : -1}
                onFocus={() => setActiveIndex(index)}
                onClick={() => {
                  setTheme(value);
                  closeAndRestoreFocus();
                }}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
                {theme === value && (
                  <Check
                    className="theme-menu-check"
                    size={16}
                    aria-hidden="true"
                  />
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
