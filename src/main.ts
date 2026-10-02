import { Notice, Plugin } from 'obsidian';
import type { MilestoneFormData, RouteFormData } from './core/plan';
import { createAssumptionFromForm, createBetFromForm, createMilestoneFromForm, createRouteFromForm } from './obsidian/create';
import { AssumptionModal, BetModal, NoteModal } from './obsidian/modals';

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

    const openNoteModal = (kind: 'route' | 'ghost-route' | 'milestone') => () => {
      new NoteModal(this.app, kind, (data) => {
        const create =
          kind === 'milestone'
            ? createMilestoneFromForm(this.app, data as MilestoneFormData<any>)
            : createRouteFromForm(this.app, data as RouteFormData<any>);
        create.catch((err) => {
          console.error('strategy-bet-creator: unexpected error', err);
          new Notice('Creation failed unexpectedly — see the developer console.');
        });
      }).open();
    };

    this.addRibbonIcon('target', 'New strategy bet', openBetModal);
    this.addCommand({ id: 'create-bet', name: 'Create new Bet', callback: openBetModal });

    this.addRibbonIcon('link', 'New strategy assumption', openAssumptionModal);
    this.addCommand({ id: 'create-assumption', name: 'Create new Assumption', callback: openAssumptionModal });

    this.addCommand({ id: 'create-route', name: 'Create new Route', callback: openNoteModal('route') });
    this.addCommand({ id: 'create-ghost-route', name: 'Create new Ghost Route', callback: openNoteModal('ghost-route') });
    this.addCommand({ id: 'create-milestone', name: 'Create new Milestone', callback: openNoteModal('milestone') });
  }
}
