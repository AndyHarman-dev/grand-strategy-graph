import { Notice, Plugin } from 'obsidian';
import { createAssumptionFromForm, createBetFromForm, createMilestoneFromForm } from './obsidian/create';
import { followRenameInMaps, isGraphNote, openStrategyGraph, reportErrors, revealInStrategyGraph } from './obsidian/graph-commands';
import { GSMAP_EXTENSION, StrategyGraphView, VIEW_TYPE } from './obsidian/graph-view';
import { AssumptionModal, BetModal, MilestoneModal } from './obsidian/modals';

export default class StrategyBetCreator extends Plugin {
  onload(): void {
    const openBetModal = () => {
      new BetModal(this.app, (data) => {
        // handleCreate() does not await this, so it owns its own error path.
        createBetFromForm(this.app, data).catch((err) => {
          console.error('strategy-bet-creator: unexpected error', err);
          new Notice('Bet creation failed unexpectedly — see the developer console.');
        });
      }).open();
    };

    const openAssumptionModal = () => {
      new AssumptionModal(this.app, (data) => {
        createAssumptionFromForm(this.app, data).catch((err) => {
          console.error('strategy-bet-creator: unexpected error', err);
          new Notice('Assumption creation failed unexpectedly — see the developer console.');
        });
      }).open();
    };

    const openMilestoneModal = () => {
      new MilestoneModal(this.app, (data) => {
        createMilestoneFromForm(this.app, data).catch((err) => {
          console.error('strategy-bet-creator: unexpected error', err);
          new Notice('Milestone creation failed unexpectedly — see the developer console.');
        });
      }).open();
    };

    this.addRibbonIcon('target', 'New strategy bet', openBetModal);
    this.addCommand({ id: 'create-bet', name: 'Create new Bet', callback: openBetModal });

    this.addRibbonIcon('link', 'New strategy assumption', openAssumptionModal);
    this.addCommand({ id: 'create-assumption', name: 'Create new Assumption', callback: openAssumptionModal });

    this.addCommand({ id: 'create-milestone', name: 'Create new Milestone', callback: openMilestoneModal });

    // The strategy graph (plan Phase 5a): `.gsmap` files open as a graph tab.
    this.registerView(VIEW_TYPE, (leaf) => new StrategyGraphView(leaf));
    this.registerExtensions([GSMAP_EXTENSION], VIEW_TYPE);
    // Note cards follow a renamed file in the maps no graph tab has open (an open tab follows by itself).
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => reportErrors('updating note cards after a rename', () => followRenameInMaps(this.app, oldPath, file.path))));
    // Lets Obsidian's page preview show a note when the pointer is over its node (hold Ctrl/Cmd, the default).
    this.registerHoverLinkSource(VIEW_TYPE, { display: 'Strategy graph', defaultMod: true });

    const openGraph = () => reportErrors('opening the graph', () => openStrategyGraph(this.app));
    this.addRibbonIcon('network', 'Open strategy graph', openGraph);
    this.addCommand({ id: 'open-strategy-graph', name: 'Open strategy graph', callback: openGraph });
    this.addCommand({
      id: 'reveal-in-strategy-graph',
      name: 'Reveal note in graph',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!isGraphNote(this.app, file)) return false;
        if (!checking) reportErrors('revealing the note', () => revealInStrategyGraph(this.app, file));
        return true;
      },
    });
  }
}
