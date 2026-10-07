import { App, FuzzySuggestModal, Modal, Notice, Setting, TFile, type TextComponent } from 'obsidian';
import { ASSUMPTION_HOLDER_FOLDERS, pickFolders } from '../core/actions';
import { ASSUMPTIONS_FOLDER } from '../core/constants';
import { getFilesInFolders, type AssumptionFormData, type AssumptionRow, type BetFormData, type MilestoneFormData } from '../core/plan';

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

/**
 * A heading, a row of chips for the notes picked so far and a button that opens a picker over
 * `folders`. `selected` is edited in place, so the modal keeps reading its own array. With
 * `limit` 1 a new pick replaces the old one.
 */
function addFilePicker(
  app: App,
  contentEl: HTMLElement,
  heading: string,
  selected: TFile[],
  folders: readonly string[],
  buttonText: string,
  limit = Infinity
): void {
  contentEl.createEl('h3', { text: heading });
  const chips = contentEl.createDiv({ cls: 'sbc-chips' });
  const render = () => {
    chips.empty();
    selected.forEach((file, idx) => {
      const chip = chips.createDiv({ cls: 'sbc-chip' });
      chip.createSpan({ text: file.basename });
      const remove = chip.createEl('button', { text: '×' });
      remove.onclick = () => {
        selected.splice(idx, 1);
        render();
      };
    });
  };
  render();
  new Setting(contentEl).addButton((b) =>
    b.setButtonText(buttonText).onClick(() => {
      new FilePickerModal(app, getFilesInFolders(app.vault, folders), (file) => {
        if (selected.includes(file)) return;
        if (selected.length >= limit) selected.splice(0, selected.length);
        selected.push(file);
        render();
      }).open();
    })
  );
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
  ultimatelyServesFiles: TFile[] = [];
  requiresFiles: TFile[] = [];
  /** At most one: the sequel activated when this bet is killed. */
  nextFiles: TFile[] = [];
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

    addFilePicker(this.app, contentEl, 'Serves', this.servesFiles, pickFolders('serves', 'bet'), '+ Add link');
    addFilePicker(this.app, contentEl, 'Ultimately serves (optional, a fixed point)', this.ultimatelyServesFiles, pickFolders('ultimately-serves', 'bet'), '+ Add fixed point');
    addFilePicker(
      this.app,
      contentEl,
      'Requires (optional, prerequisite bets or milestones to reach first)',
      this.requiresFiles,
      pickFolders('requires', 'bet'),
      '+ Add bet or milestone'
    );
    addFilePicker(this.app, contentEl, 'Next (optional, the sequel activated on kill)', this.nextFiles, pickFolders('next', 'bet'), '+ Choose bet', 1);

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
      ultimatelyServesFiles: this.ultimatelyServesFiles.slice(),
      requiresFiles: this.requiresFiles.slice(),
      nextFile: this.nextFiles[0] ?? null,
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
 * Standalone assumption creation. Unlike the assumption rows inside BetModal, this adds the new
 * assumption to the `assumptions` of zero or more *existing* notes (bets, fixed points,
 * milestones). It never creates one of them.
 */
export class AssumptionModal extends Modal {
  onSubmit: (data: AssumptionFormData<TFile>) => void;
  statement = '';
  falsifier = '';
  verifyBy = '';
  dependentFiles: TFile[] = [];

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

    addFilePicker(this.app, contentEl, 'Notes that depend on this assumption', this.dependentFiles, ASSUMPTION_HOLDER_FOLDERS, '+ Add note');

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
      dependentFiles: this.dependentFiles.slice(),
    };

    this.close();
    this.onSubmit(data);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * A milestone (D17): a checkpoint on the way to a fixed point, the place further bets start
 * from. A title, a description and the fixed points or milestones it serves. It is created
 * `open`; bets that start from it pick it under "Requires".
 */
export class MilestoneModal extends Modal {
  title = '';
  description = '';
  servesFiles: TFile[] = [];

  constructor(
    app: App,
    readonly onSubmit: (data: MilestoneFormData<TFile>) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'New milestone' });

    new Setting(contentEl)
      .setName('Title')
      .setDesc('Short name, used for the note filename.')
      .addText((t) => t.onChange((v) => (this.title = v)));
    new Setting(contentEl)
      .setName('Description (optional)')
      .setDesc('What will be true when it is reached?')
      .addText((t) => t.onChange((v) => (this.description = v)));

    addFilePicker(this.app, contentEl, 'Serves (the bets that start from it, or the milestone or fixed point further along)', this.servesFiles, pickFolders('serves', 'milestone'), '+ Add link');

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
    if (!this.title.trim()) {
      new Notice('A title is required.');
      return;
    }
    const data: MilestoneFormData<TFile> = { title: this.title.trim(), description: this.description.trim(), servesFiles: this.servesFiles.slice() };
    this.close();
    this.onSubmit(data);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
