import { Notice, Plugin } from 'obsidian';
import { createAssumptionFromForm, createBetFromForm, createMilestoneFromForm } from './obsidian/create';
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
  }
}
