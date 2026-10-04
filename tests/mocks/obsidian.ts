/**
 * Runtime stand-in for the `obsidian` module, which only exists inside the
 * Obsidian app. Vitest aliases `obsidian` to this file (vitest.config.ts), and
 * tests read the notices and dates it records.
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

/** `instanceof TFile` is how the plugin tells a note from a folder; FakeVault files are instances. */
export class TFile {}

const stubEl = { empty() {} } as any;

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
  callback?: () => unknown;
  checkCallback?: (checking: boolean) => boolean | void;
}

export interface EventRef {
  events: Events;
  name: string;
  callback: (...args: any[]) => unknown;
}

/** Obsidian's event emitter: `on` returns a ref that `offref` (or a Component unloading) removes. */
export class Events {
  private handlers = new Map<string, EventRef[]>();

  on(name: string, callback: (...args: any[]) => unknown): EventRef {
    const ref = { events: this, name, callback };
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), ref]);
    return ref;
  }

  offref(ref: EventRef): void {
    this.handlers.set(ref.name, (this.handlers.get(ref.name) ?? []).filter((r) => r !== ref));
  }

  trigger(name: string, ...args: unknown[]): void {
    for (const ref of this.handlers.get(name) ?? []) ref.callback(...args);
  }

  /** Test helper: how many handlers are registered, for leak checks. */
  listenerCount(name?: string): number {
    if (name !== undefined) return this.handlers.get(name)?.length ?? 0;
    return Array.from(this.handlers.values()).reduce((n, refs) => n + refs.length, 0);
  }
}

/** Lifecycle owner: whatever it registered is released by `unload()`, as in Obsidian. */
export class Component {
  private eventRefs: EventRef[] = [];
  private cleanups: (() => unknown)[] = [];
  loaded = false;

  load(): void {
    this.loaded = true;
    this.onload();
  }

  onload(): void {}

  unload(): void {
    for (const ref of this.eventRefs.splice(0)) ref.events.offref(ref);
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.loaded = false;
    this.onunload();
  }

  onunload(): void {}

  register(cleanup: () => unknown): void {
    this.cleanups.push(cleanup);
  }

  registerEvent(ref: EventRef): void {
    this.eventRefs.push(ref);
  }
}

export class View extends Component {
  app: any;
  leaf: any;
  icon = '';
  navigation = false;
  containerEl = stubEl;

  constructor(leaf: any) {
    super();
    this.leaf = leaf;
    this.app = leaf.app;
  }

  async onOpen(): Promise<void> {}
  async onClose(): Promise<void> {}
}

export class ItemView extends View {
  contentEl = stubEl;
}

/** Tests drive the lifecycle themselves (load, onOpen, onLoadFile, …), in Obsidian's order. */
export class FileView extends ItemView {
  file: TFile | null = null;
  allowNoFile = false;
  navigation = true;

  async onLoadFile(_file: TFile): Promise<void> {}
  async onUnloadFile(_file: TFile): Promise<void> {}

  canAcceptExtension(_extension: string): boolean {
    return false;
  }
}

export class Plugin {
  app: unknown;
  ribbonIcons: { icon: string; title: string; callback: () => unknown }[] = [];
  commands: RecordedCommand[] = [];
  views: { type: string; creator: (leaf: unknown) => unknown }[] = [];
  extensions: { extensions: string[]; viewType: string }[] = [];

  registerView(type: string, creator: (leaf: unknown) => unknown): void {
    this.views.push({ type, creator });
  }

  registerExtensions(extensions: string[], viewType: string): void {
    this.extensions.push({ extensions, viewType });
  }

  hoverLinkSources: { id: string; info: { display: string; defaultMod: boolean } }[] = [];

  registerHoverLinkSource(id: string, info: { display: string; defaultMod: boolean }): void {
    this.hoverLinkSources.push({ id, info });
  }

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
