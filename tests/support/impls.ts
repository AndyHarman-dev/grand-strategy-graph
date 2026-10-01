import type { FakeApp, FakeFile } from './fake-app';
import { legacy, LegacyPlugin } from './legacy';

/**
 * One shape for every implementation under test. The characterization suites
 * run each case against every entry and compare to the same golden files, so
 * any drift between the legacy plugin and the port fails loudly.
 */
export interface Impl {
  name: string;
  sanitizeTitle(raw: unknown): string;
  trimTrailingPunctuation(text: string): string;
  deriveAssumptionTitle(statement: unknown, maxLen?: number): string;
  parseIds(basenames: string[], prefix: string): {
    ids: number[];
    used: Set<number>;
    invalid: string[];
    duplicates: number[];
    max: number;
  };
  insertIntoSection(content: string, heading: string, line: string, linkTarget: string): string;
  yamlString(value: unknown): string;
  stripTrailingColon(text: unknown): string;
  buildBetContent(opts: any): string;
  buildAssumptionContent(opts: any): string;
  getFilesInFolders(app: FakeApp, folders: string[]): FakeFile[];
  buildWritePlan(app: FakeApp, data: any, today: string): any;
  buildAssumptionWritePlan(app: FakeApp, data: any, today: string): any;
  createBetFromForm(app: FakeApp, data: any): Promise<void>;
  createAssumptionFromForm(app: FakeApp, data: any): Promise<void>;
  BetModal: new (app: any, onSubmit: (data: any) => void) => any;
  AssumptionModal: new (app: any, onSubmit: (data: any) => void) => any;
  Plugin: new (app: any, manifest: any) => any;
}

export const legacyImpl: Impl = {
  name: 'legacy',
  ...(legacy as any),
  Plugin: LegacyPlugin,
};

export const implementations: Impl[] = [legacyImpl];
