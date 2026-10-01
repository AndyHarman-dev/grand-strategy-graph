import { App, FuzzySuggestModal, Modal, Notice, Setting, TFile, type TextComponent } from 'obsidian';
import { ASSUMPTIONS_FOLDER, BETS_FOLDER, FIXED_POINTS_FOLDER } from '../core/constants';
import { getFilesInFolders, type AssumptionFormData, type AssumptionRow, type BetFormData } from '../core/plan';

export class FilePickerModal extends FuzzySuggestModal<TFile> {
  files: TFile[];
  onChoose: (file: TFile) => void;

  constructor(app: App, files: TFile[], onChoose: (file: TFile) => void) {
    super(app);
    this.files = files;
    this.onChoose = onChoose;
    this.setPlaceholder('Search notes…');
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(file: TFile): string {
    return file.basename;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}

let assumptionRowSeq = 0;

export class BetModal extends Modal {
  onSubmit: (data: BetFormData<TFile>) => void;
  title = '';
  titleTouched = false;
  x = '';
  y = '';
  z = '';
  deadline = '';
  servesFiles: TFile[] = [];
  assumptionRows: AssumptionRow<TFile>[] = [];

  constructor(app: App, onSubmit: (data: BetFormData<TFile>) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'New strategy bet' });

    let titleTextComponent: TextComponent | undefined;

    new Setting(contentEl)
      .setName('Title')
      .setDesc('Short name, used for the note filename.')
      .addText((t) => {
        titleTextComponent = t;
        t.setValue(this.title).onChange((v) => {
          this.title = v;
          this.titleTouched = v.length > 0;
        });
      });

    new Setting(contentEl)
      .setName('X — continuing to do')
      .addText((t) => t.onChange((v) => (this.x = v)));

    new Setting(contentEl)
      .setName('Y — will produce')
      .addText((t) =>
        t.onChange((v) => {
          this.y = v;
          if (!this.titleTouched && titleTextComponent) {
            titleTextComponent.setValue(v);
            this.title = v;
          }
        })
      );

    new Setting(contentEl)
      .setName('Z — within timeframe')
      .addText((t) => t.onChange((v) => (this.z = v)));

    new Setting(contentEl)
      .setName('Deadline (optional)')
      .addText((t) => {
        t.inputEl.type = 'date';
        t.onChange((v) => (this.deadline = v));
      });

    contentEl.createEl('h3', { text: 'Serves' });
    const servesChips = contentEl.createDiv({ cls: 'sbc-chips' });
    const renderServesChips = () => {
      servesChips.empty();
      this.servesFiles.forEach((file, idx) => {
        const chip = servesChips.createDiv({ cls: 'sbc-chip' });
        chip.createSpan({ text: file.basename });
        const remove = chip.createEl('button', { text: '×' });
        remove.onclick = () => {
          this.servesFiles.splice(idx, 1);
          renderServesChips();
        };
      });
    };
    renderServesChips();
    new Setting(contentEl).addButton((b) =>
      b.setButtonText('+ Add link').onClick(() => {
        const candidates = getFilesInFolders(this.app.vault, [FIXED_POINTS_FOLDER, BETS_FOLDER]);
        new FilePickerModal(this.app, candidates, (file) => {
          if (!this.servesFiles.includes(file)) {
            this.servesFiles.push(file);
            renderServesChips();
          }
        }).open();
      })
    );

    contentEl.createEl('h3', { text: 'Assumptions this bet depends on' });
    const rowsContainer = contentEl.createDiv({ cls: 'sbc-assumption-rows' });

    const renderRows = () => {
      rowsContainer.empty();
      this.assumptionRows.forEach((row) => {
        const rowEl = rowsContainer.createDiv({ cls: 'sbc-assumption-row' });

        const header = rowEl.createDiv({ cls: 'sbc-assumption-row-header' });
        const newBtn = header.createEl('button', { text: 'New' });
        const existingBtn = header.createEl('button', { text: 'Existing' });
        const removeBtn = header.createEl('button', { text: 'Remove row' });

        newBtn.disabled = row.mode === 'new';
        existingBtn.disabled = row.mode === 'existing';

        newBtn.onclick = () => {
          row.mode = 'new';
          renderRows();
        };
        existingBtn.onclick = () => {
          row.mode = 'existing';
          renderRows();
        };
        removeBtn.onclick = () => {
          this.assumptionRows = this.assumptionRows.filter((r) => r.id !== row.id);
          renderRows();
        };

        const body = rowEl.createDiv({ cls: 'sbc-assumption-row-body' });

        if (row.mode === 'new') {
          new Setting(body)
            .setName('Statement')
            .addText((t) => t.setValue(row.statement).onChange((v) => (row.statement = v)));
          new Setting(body)
            .setName("How I'd know it's false")
            .addText((t) => t.setValue(row.falsifier).onChange((v) => (row.falsifier = v)));
          new Setting(body)
            .setName('Verify by (optional)')
            .addText((t) => {
              t.inputEl.type = 'date';
              t.setValue(row.verifyBy).onChange((v) => (row.verifyBy = v));
            });
        } else {
          const label = body.createDiv({ cls: 'sbc-existing-label' });
          label.setText(row.existingFile ? row.existingFile.basename : 'No assumption chosen yet');
          new Setting(body).addButton((b) =>
            b.setButtonText('Choose existing…').onClick(() => {
              const candidates = getFilesInFolders(this.app.vault, [ASSUMPTIONS_FOLDER]);
              new FilePickerModal(this.app, candidates, (file) => {
                row.existingFile = file;
                renderRows();
              }).open();
            })
          );
        }
      });
    };
    renderRows();

    new Setting(contentEl).addButton((b) =>
      b.setButtonText('+ Add assumption').onClick(() => {
        this.assumptionRows.push({
          id: ++assumptionRowSeq,
          mode: 'new',
          statement: '',
          falsifier: '',
          verifyBy: '',
          existingFile: null,
        });
        renderRows();
      })
    );

    const footer = new Setting(contentEl);
    footer.addButton((b) =>
      b
        .setButtonText('Create')
        .setCta()
        .onClick(() => this.handleCreate())
    );
    footer.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()));
  }

  handleCreate(): void {
    if (!this.title.trim() || !this.x.trim() || !this.y.trim() || !this.z.trim()) {
      new Notice('Title, X, Y and Z are all required.');
      return;
    }
    for (const row of this.assumptionRows) {
      if (row.mode === 'new' && !row.statement.trim()) {
        new Notice('Every new assumption needs a statement, or remove the row.');
        return;
      }
      if (row.mode === 'existing' && !row.existingFile) {
        new Notice('Pick an existing assumption for every "Existing" row, or remove it.');
        return;
      }
    }

    const data: BetFormData<TFile> = {
      title: this.title.trim(),
      x: this.x.trim(),
      y: this.y.trim(),
      z: this.z.trim(),
      deadline: this.deadline,
      servesFiles: this.servesFiles.slice(),
      assumptionRows: this.assumptionRows.map((r) => ({ ...r })),
    };

    this.close();
    this.onSubmit(data);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Standalone assumption creation. Unlike the assumption rows inside BetModal,
 * this links the new assumption to zero or more *existing* bets — it never
 * creates a bet, so the picker below only ever offers files already in
 * Strategy/Bets.
 */
export class AssumptionModal extends Modal {
  onSubmit: (data: AssumptionFormData<TFile>) => void;
  statement = '';
  falsifier = '';
  verifyBy = '';
  betFiles: TFile[] = [];

  constructor(app: App, onSubmit: (data: AssumptionFormData<TFile>) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'New strategy assumption' });

    new Setting(contentEl)
      .setName('Statement')
      .addText((t) => t.onChange((v) => (this.statement = v)));

    new Setting(contentEl)
      .setName("How I'd know it's false")
      .addText((t) => t.onChange((v) => (this.falsifier = v)));

    new Setting(contentEl)
      .setName('Verify by (optional)')
      .addText((t) => {
        t.inputEl.type = 'date';
        t.onChange((v) => (this.verifyBy = v));
      });

    contentEl.createEl('h3', { text: 'Bets this assumption depends on' });
    const betChips = contentEl.createDiv({ cls: 'sbc-chips' });
    const renderBetChips = () => {
      betChips.empty();
      this.betFiles.forEach((file, idx) => {
        const chip = betChips.createDiv({ cls: 'sbc-chip' });
        chip.createSpan({ text: file.basename });
        const remove = chip.createEl('button', { text: '×' });
        remove.onclick = () => {
          this.betFiles.splice(idx, 1);
          renderBetChips();
        };
      });
    };
    renderBetChips();
    new Setting(contentEl).addButton((b) =>
      b.setButtonText('+ Add bet').onClick(() => {
        const candidates = getFilesInFolders(this.app.vault, [BETS_FOLDER]);
        new FilePickerModal(this.app, candidates, (file) => {
          if (!this.betFiles.includes(file)) {
            this.betFiles.push(file);
            renderBetChips();
          }
        }).open();
      })
    );

    const footer = new Setting(contentEl);
    footer.addButton((b) =>
      b
        .setButtonText('Create')
        .setCta()
        .onClick(() => this.handleCreate())
    );
    footer.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()));
  }

  handleCreate(): void {
    if (!this.statement.trim()) {
      new Notice('A statement is required.');
      return;
    }

    const data: AssumptionFormData<TFile> = {
      statement: this.statement.trim(),
      falsifier: this.falsifier.trim(),
      verifyBy: this.verifyBy,
      betFiles: this.betFiles.slice(),
    };

    this.close();
    this.onSubmit(data);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
