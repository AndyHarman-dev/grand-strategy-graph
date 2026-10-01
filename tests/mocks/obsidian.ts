/**
 * Runtime stand-in for the `obsidian` module, which only exists inside the
 * Obsidian app. Vitest aliases `obsidian` to this file (vitest.config.ts), and
 * the legacy loader hands the same instance to the old main.js, so both
 * implementations observe identical notices and dates.
 *
 * Only what the plugin touches outside of DOM rendering is modelled.
 */

export interface RecordedNotice {
  message: string;
  timeout: number | undefined;
}

export const notices: RecordedNotice[] = [];

/** Every modal opened since the last reset, in order. */
export const openedModals: Modal[] = [];

let today = '2026-10-01';

export function setToday(date: string): void {
  today = date;
}

export function resetObsidianMock(): void {
  notices.length = 0;
  openedModals.length = 0;
  today = '2026-10-01';
}

export class Notice {
  constructor(message: string, timeout?: number) {
    notices.push({ message, timeout });
  }
}

export function moment() {
  return {
    format(fmt: string): string {
      if (fmt !== 'YYYY-MM-DD') throw new Error('obsidian mock: unsupported moment format ' + fmt);
      return today;
    },
  };
}

const stubEl = { empty() {} };

export class Modal {
  app: unknown;
  contentEl: typeof stubEl = stubEl;
  opened = false;
  closed = false;

  constructor(app: unknown) {
    this.app = app;
  }

  open(): void {
    this.opened = true;
    openedModals.push(this);
  }

  close(): void {
    this.closed = true;
    (this as { onClose?: () => void }).onClose?.();
  }
}

export class FuzzySuggestModal<T> extends Modal {
  placeholder = '';

  setPlaceholder(text: string): void {
    this.placeholder = text;
  }

  // Overridden by subclasses; declared so the generic parameter is used.
  getItems(): T[] {
    return [];
  }
}

export class Setting {
  constructor(_containerEl: unknown) {}
}

export interface RecordedCommand {
  id: string;
  name: string;
  callback: () => unknown;
}

export class Plugin {
  app: unknown;
  ribbonIcons: { icon: string; title: string; callback: () => unknown }[] = [];
  commands: RecordedCommand[] = [];

  constructor(app: unknown) {
    this.app = app;
  }

  addRibbonIcon(icon: string, title: string, callback: () => unknown): void {
    this.ribbonIcons.push({ icon, title, callback });
  }

  addCommand(command: RecordedCommand): RecordedCommand {
    this.commands.push(command);
    return command;
  }
}
