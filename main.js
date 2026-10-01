const { Plugin, Notice, Modal, Setting, FuzzySuggestModal, moment } = require('obsidian');

const FIXED_POINTS_FOLDER = 'Strategy/Fixed Points';
const BETS_FOLDER = 'Strategy/Bets';
const ASSUMPTIONS_FOLDER = 'Strategy/Assumptions';

const DEPENDED_ON_BY_HEADING = '## Depended On By';
const BET_ASSUMPTIONS_HEADING = '## Assumptions This Bet Depends On';
const ASSUMPTION_TITLE_MAX_LEN = 60;

function getFilesInFolders(app, folders) {
  return app.vault
    .getMarkdownFiles()
    .filter((f) => folders.some((folder) => f.path.startsWith(folder + '/')))
    .sort((a, b) => a.basename.localeCompare(b.basename));
}

class FilePickerModal extends FuzzySuggestModal {
  constructor(app, files, onChoose) {
    super(app);
    this.files = files;
    this.onChoose = onChoose;
    this.setPlaceholder('Search notes…');
  }

  getItems() {
    return this.files;
  }

  getItemText(file) {
    return file.basename;
  }

  onChooseItem(file) {
    this.onChoose(file);
  }
}

let assumptionRowSeq = 0;

class BetModal extends Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
    this.title = '';
    this.titleTouched = false;
    this.x = '';
    this.y = '';
    this.z = '';
    this.deadline = '';
    this.servesFiles = [];
    this.assumptionRows = [];
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'New strategy bet' });

    let titleTextComponent;

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
        const candidates = getFilesInFolders(this.app, [FIXED_POINTS_FOLDER, BETS_FOLDER]);
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
              const candidates = getFilesInFolders(this.app, [ASSUMPTIONS_FOLDER]);
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

  handleCreate() {
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

    const data = {
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

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * Standalone assumption creation. Unlike the assumption rows inside BetModal,
 * this links the new assumption to zero or more *existing* bets — it never
 * creates a bet, so the picker below only ever offers files already in
 * Strategy/Bets.
 */
class AssumptionModal extends Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
    this.statement = '';
    this.falsifier = '';
    this.verifyBy = '';
    this.betFiles = [];
  }

  onOpen() {
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
        const candidates = getFilesInFolders(this.app, [BETS_FOLDER]);
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

  handleCreate() {
    if (!this.statement.trim()) {
      new Notice('A statement is required.');
      return;
    }

    const data = {
      statement: this.statement.trim(),
      falsifier: this.falsifier.trim(),
      verifyBy: this.verifyBy,
      betFiles: this.betFiles.slice(),
    };

    this.close();
    this.onSubmit(data);
  }

  onClose() {
    this.contentEl.empty();
  }
}

/* ------------------------------------------------------------------------- *
 * Pure helpers (no Obsidian API access) — kept side-effect free so they can
 * be reasoned about / exercised in isolation.
 * ------------------------------------------------------------------------- */

// Characters Obsidian refuses (or mangles) in note filenames.
const FORBIDDEN_FILENAME_CHARS = /[#\[\]\^\|\/\\:\*]/g;

/**
 * Remove filename-hostile characters, collapse whitespace runs, trim.
 * Forbidden characters become a SPACE rather than being deleted outright, so
 * "SaaS/PLG focus" reads as "SaaS PLG focus" instead of "SaaSPLG focus" — the
 * Title field auto-fills from the free-text Y field, so word-gluing is a real
 * risk. The whitespace collapse below then cleans up the resulting runs.
 */
function sanitizeTitle(raw) {
  return String(raw == null ? '' : raw)
    .replace(FORBIDDEN_FILENAME_CHARS, ' ')
    // control chars would also break a filename
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Trailing punctuation reads badly in a filename ("... together." / "... ,"). */
function trimTrailingPunctuation(text) {
  return text.replace(/[\s.,;!?\-–—]+$/, '').trim();
}

/**
 * Derive a filename-safe title for a brand-new assumption from its statement.
 * The form never collects a separate per-assumption title, so the statement is
 * the only source. Truncate on a word boundary when possible; never mid-word
 * unless the first "word" is itself longer than the budget.
 */
function deriveAssumptionTitle(statement, maxLen) {
  const limit = typeof maxLen === 'number' ? maxLen : ASSUMPTION_TITLE_MAX_LEN;
  const clean = sanitizeTitle(statement);
  if (!clean) return '';
  if (clean.length <= limit) return trimTrailingPunctuation(clean) || clean;

  const hard = clean.slice(0, limit);
  const lastSpace = hard.lastIndexOf(' ');
  const cut = lastSpace >= Math.floor(limit / 2) ? hard.slice(0, lastSpace) : hard;
  return trimTrailingPunctuation(cut) || cut.trim();
}

/**
 * Parse `B-<n>` / `A-<n>` ids out of basenames.
 * Deliberately anchored + digit-greedy rather than whitespace-split, because
 * real data contains `B-10  byTalent backend engineer` (double space).
 * Returns every signal the caller needs to refuse to write on ambiguity.
 */
function parseIds(basenames, prefix) {
  const re = new RegExp('^' + prefix + '-(\\d+)');
  const ids = [];
  const invalid = [];
  const seen = new Set();
  const duplicates = new Set();

  for (const basename of basenames) {
    const match = re.exec(basename);
    if (!match) continue; // not an id-bearing note; ignored, not an error
    const n = Number.parseInt(match[1], 10);
    if (!Number.isSafeInteger(n) || n < 0) {
      invalid.push(basename);
      continue;
    }
    if (seen.has(n)) duplicates.add(n);
    seen.add(n);
    ids.push(n);
  }

  return {
    ids,
    used: seen,
    invalid,
    duplicates: Array.from(duplicates).sort((a, b) => a - b),
    max: ids.length ? Math.max.apply(null, ids) : 0,
  };
}

/**
 * Idempotently add `line` to the `heading` section of `content`.
 *
 * - Presence is tested on the bare `[[Target]]` wikilink, NOT on the rendered
 *   `- [[Target]]` line: real assumption notes in this vault contain
 *   bullet-less backlinks (A-13, A-7), and a bullet-prefixed check would
 *   double-insert into those.
 * - The line goes after the LAST non-blank line of the section (i.e. after the
 *   template's italic placeholder and any existing backlinks), which is the
 *   shape every existing assumption note already has — not directly under the
 *   heading, and not at the very end of the file.
 */
function insertIntoSection(content, heading, line, linkTarget) {
  if (content.includes(linkTarget)) return content;

  const lines = content.split('\n');
  let headingIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === heading) {
      headingIdx = i;
      break;
    }
  }

  if (headingIdx === -1) {
    // No such section: append one rather than dropping the backlink.
    const sep = content.length === 0 ? '' : content.endsWith('\n\n') ? '' : content.endsWith('\n') ? '\n' : '\n\n';
    return content + sep + heading + '\n' + line + '\n';
  }

  // Section runs until the next h1/h2 (an h3 subsection still belongs to it).
  let sectionEnd = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i])) {
      sectionEnd = i;
      break;
    }
  }

  let insertAt = headingIdx + 1;
  for (let i = sectionEnd - 1; i > headingIdx; i--) {
    if (lines[i].trim() !== '') {
      insertAt = i + 1;
      break;
    }
  }

  lines.splice(insertAt, 0, line);
  return lines.join('\n');
}

/** YAML double-quoted scalar. JSON string syntax is a valid subset of it. */
function yamlString(value) {
  return JSON.stringify(String(value == null ? '' : value));
}

/** `**X:**` in the template — avoid `::**` if the user already typed a colon. */
function stripTrailingColon(text) {
  return String(text == null ? '' : text).replace(/\s*:\s*$/, '');
}

/**
 * Assumption note body, mirroring Templates/Assumption Template.md.
 * `betLinks` (zero or more `[[Bet]]` strings) covers both call sites: a bet's
 * own new-assumption rows pass exactly one (the bet being created), while
 * standalone assumption creation passes however many existing bets were
 * picked, including none.
 */
function buildAssumptionContent(opts) {
  const frontmatter = [
    '---',
    'type: assumption',
    'status: unverified',
    'created: ' + opts.today,
    'verify-by:' + (opts.verifyBy ? ' ' + opts.verifyBy : ''),
    '---',
  ];

  const betLinks = opts.betLinks || (opts.betLink ? [opts.betLink] : []);

  const body = [
    '## The Assumption',
    opts.statement,
    '',
    "## How I'd Know It's False",
    opts.falsifier
      ? opts.falsifier
      : "*What observable evidence would falsify this? If nothing could, it's a belief, not an assumption — rewrite it.*",
    '',
    '## Verify By',
    '*If this assumption is load-bearing, set a date in the frontmatter by which I should have evidence either way. This is the anti-postponement discipline: name the information and the deadline.*',
    '',
    DEPENDED_ON_BY_HEADING,
    '*Check linked mentions — every bet and decision that leans on this. When status flips to `falsified`, everything listed there needs re-examination at the next weekly review.*',
  ];
  for (const link of betLinks) {
    body.push('- ' + link);
  }
  body.push('', '## Log', '- ' + opts.today + ': Created', '');

  return frontmatter.concat(body).join('\n');
}

/** Bet note body, mirroring Templates/Bet Template.md. */
function buildBetContent(opts) {
  const frontmatter = ['---', 'type: bet', 'status: active', 'started: ' + opts.today];
  frontmatter.push('deadline:' + (opts.deadline ? ' ' + opts.deadline : ''));
  frontmatter.push('expected-result: ' + yamlString(opts.y));
  if (opts.servesBasenames.length) {
    frontmatter.push('serves:');
    for (const basename of opts.servesBasenames) {
      frontmatter.push('  - ' + yamlString('[[' + basename + ']]'));
    }
  } else {
    frontmatter.push('serves:');
  }
  frontmatter.push('next sequel:');
  frontmatter.push('---');

  const body = [
    '## The Bet',
    'I believe continuing **' + stripTrailingColon(opts.x) + ':** `[action/effort]`',
    'will produce **' + stripTrailingColon(opts.y) + ':** `[concrete, observable result]`',
    'within **' + stripTrailingColon(opts.z) + ':** `[timeframe — must match the deadline above]`',
    '',
    '## Serves',
    'Which fixed point / direction does this bet serve?',
  ];
  for (const basename of opts.servesBasenames) {
    body.push('- [[' + basename + ']]');
  }
  body.push(
    '',
    '## Kill Condition (decided NOW, before the deadline)',
    'When the deadline arrives and Y has not materialized, this bet is:',
    '- [ ] **Killed** — X stops entirely',
    '- [ ] **Modified** — X changes to: ',
    '- [ ] **Extended once** — new deadline: `____` — written justification required below',
    '',
    '> Extension justification (fill only if extending; one extension maximum):',
    '',
    '## Assumptions This Bet Depends On'
  );
  for (const link of opts.assumptionLinks) {
    body.push('- ' + link);
  }
  body.push(
    '',
    '## Log',
    '*Weekly check-ins go here. Date + one line: on track / off track / signal observed.*',
    '',
    '- ' + opts.today + ': created',
    '',
    '## Resolution',
    '*Fill when the bet closes.*',
    '- **Outcome:** ',
    '- **What I learned:** ',
    '- **Status updated in frontmatter?** (active → won / killed / extended)',
    ''
  );

  return frontmatter.concat(body).join('\n');
}

/* ------------------------------------------------------------------------- *
 * Vault-touching logic
 * ------------------------------------------------------------------------- */

async function ensureFolder(app, path) {
  if (app.vault.getAbstractFileByPath(path)) return;
  try {
    await app.vault.createFolder(path);
  } catch (err) {
    // Racy "already exists" is fine; anything else surfaces on the create call.
    console.warn('strategy-bet-creator: createFolder(' + path + ') failed', err);
  }
}

/**
 * Plan every id, title and path BEFORE writing anything, so an ambiguous id
 * space or a path collision aborts the run cleanly instead of leaving orphan
 * assumption notes pointing at a bet that was never created.
 * Returns { error } or the full write plan.
 */
function buildWritePlan(app, data, today) {
  const betBasenames = getFilesInFolders(app, [BETS_FOLDER]).map((f) => f.basename);
  const assumptionBasenames = getFilesInFolders(app, [ASSUMPTIONS_FOLDER]).map((f) => f.basename);

  const bets = parseIds(betBasenames, 'B');
  const assumptions = parseIds(assumptionBasenames, 'A');

  if (bets.invalid.length || assumptions.invalid.length) {
    return {
      error:
        'Unparseable bet/assumption ids — nothing was created. Offending notes: ' +
        bets.invalid.concat(assumptions.invalid).join(', '),
    };
  }
  if (bets.duplicates.length) {
    return { error: 'Duplicate bet ids in ' + BETS_FOLDER + ': B-' + bets.duplicates.join(', B-') + '. Nothing was created.' };
  }
  if (assumptions.duplicates.length) {
    return {
      error:
        'Duplicate assumption ids in ' + ASSUMPTIONS_FOLDER + ': A-' + assumptions.duplicates.join(', A-') + '. Nothing was created.',
    };
  }

  const betTitle = sanitizeTitle(data.title);
  if (!betTitle) return { error: 'The bet title is empty after removing illegal filename characters. Nothing was created.' };

  const betId = bets.max + 1;
  if (bets.used.has(betId)) return { error: 'Computed bet id B-' + betId + ' already exists. Nothing was created.' };

  const betBasename = 'B-' + betId + ' ' + betTitle;
  const betLink = '[[' + betBasename + ']]';
  const betPath = BETS_FOLDER + '/' + betBasename + '.md';

  const newAssumptions = [];
  const assumptionLinks = [];
  let nextAssumptionId = assumptions.max;

  for (const row of data.assumptionRows) {
    if (row.mode !== 'new') continue;
    nextAssumptionId += 1;
    if (assumptions.used.has(nextAssumptionId)) {
      return { error: 'Computed assumption id A-' + nextAssumptionId + ' already exists. Nothing was created.' };
    }
    // One source of truth: the same truncated title is used for the filename
    // and for the [[link]] written into the bet note.
    const title = deriveAssumptionTitle(row.statement) || 'Assumption ' + nextAssumptionId;
    const basename = 'A-' + nextAssumptionId + ' ' + title;
    newAssumptions.push({
      path: ASSUMPTIONS_FOLDER + '/' + basename + '.md',
      content: buildAssumptionContent({
        today,
        statement: String(row.statement || '').trim(),
        falsifier: String(row.falsifier || '').trim(),
        verifyBy: row.verifyBy || '',
        betLinks: [betLink],
      }),
    });
    assumptionLinks.push('[[' + basename + ']]');
  }

  // De-duplicate reused assumptions (the user may pick the same note twice).
  const reused = [];
  const seenReused = new Set();
  for (const row of data.assumptionRows) {
    if (row.mode !== 'existing' || !row.existingFile) continue;
    if (seenReused.has(row.existingFile.path)) continue;
    seenReused.add(row.existingFile.path);
    reused.push(row.existingFile);
    assumptionLinks.push('[[' + row.existingFile.basename + ']]');
  }

  const servesBasenames = data.servesFiles.map((f) => f.basename);

  const plan = {
    betId,
    betTitle,
    betPath,
    betLink,
    betContent: buildBetContent({
      today,
      x: data.x,
      y: data.y,
      z: data.z,
      deadline: data.deadline,
      servesBasenames,
      assumptionLinks,
    }),
    newAssumptions,
    reused,
  };

  // Pre-flight every target path.
  for (const target of [plan.betPath].concat(newAssumptions.map((a) => a.path))) {
    if (app.vault.getAbstractFileByPath(target)) {
      return { error: 'A note already exists at "' + target + '". Nothing was created.' };
    }
  }

  return plan;
}

async function createBetFromForm(app, data) {
  const today = moment().format('YYYY-MM-DD');

  await ensureFolder(app, BETS_FOLDER);
  await ensureFolder(app, ASSUMPTIONS_FOLDER);

  const plan = buildWritePlan(app, data, today);
  if (plan.error) {
    console.error('strategy-bet-creator: aborted before writing —', plan.error);
    new Notice(plan.error, 15000);
    return;
  }

  const created = [];
  try {
    // 1. New assumptions first, so the bet can link to real files.
    for (const assumption of plan.newAssumptions) {
      await app.vault.create(assumption.path, assumption.content);
      created.push(assumption.path);
    }

    // 2. The bet itself.
    const betFile = await app.vault.create(plan.betPath, plan.betContent);
    created.push(plan.betPath);

    // 3. Backlink into every reused assumption, idempotently.
    for (const file of plan.reused) {
      await app.vault.process(file, (content) =>
        insertIntoSection(content, DEPENDED_ON_BY_HEADING, '- ' + plan.betLink, plan.betLink)
      );
    }

    await app.workspace.getLeaf(false).openFile(betFile);

    new Notice(
      'Created B-' +
        plan.betId +
        ' ' +
        plan.betTitle +
        ' — ' +
        plan.newAssumptions.length +
        ' new assumption(s), ' +
        plan.reused.length +
        ' reused.'
    );
  } catch (err) {
    console.error('strategy-bet-creator: failed part-way through creation', err);
    new Notice(
      'Bet creation failed: ' +
        (err && err.message ? err.message : String(err)) +
        (created.length ? '\nAlready created (not rolled back): ' + created.join(', ') : '\nNothing was created.'),
      20000
    );
  }
}

/**
 * Plan a standalone assumption creation: next id, filename, content, and the
 * de-duplicated set of existing bets to backlink into. Same "plan everything
 * before writing" discipline as buildWritePlan — no bet is ever created here.
 */
function buildAssumptionWritePlan(app, data, today) {
  const assumptionBasenames = getFilesInFolders(app, [ASSUMPTIONS_FOLDER]).map((f) => f.basename);
  const assumptions = parseIds(assumptionBasenames, 'A');

  if (assumptions.invalid.length) {
    return {
      error: 'Unparseable assumption ids — nothing was created. Offending notes: ' + assumptions.invalid.join(', '),
    };
  }
  if (assumptions.duplicates.length) {
    return {
      error:
        'Duplicate assumption ids in ' + ASSUMPTIONS_FOLDER + ': A-' + assumptions.duplicates.join(', A-') + '. Nothing was created.',
    };
  }

  const assumptionId = assumptions.max + 1;
  if (assumptions.used.has(assumptionId)) {
    return { error: 'Computed assumption id A-' + assumptionId + ' already exists. Nothing was created.' };
  }

  const title = deriveAssumptionTitle(data.statement) || 'Assumption ' + assumptionId;
  const basename = 'A-' + assumptionId + ' ' + title;
  const path = ASSUMPTIONS_FOLDER + '/' + basename + '.md';

  if (app.vault.getAbstractFileByPath(path)) {
    return { error: 'A note already exists at "' + path + '". Nothing was created.' };
  }

  // De-duplicate reused bets (the user may pick the same note twice).
  const bets = [];
  const seenBets = new Set();
  for (const file of data.betFiles) {
    if (seenBets.has(file.path)) continue;
    seenBets.add(file.path);
    bets.push(file);
  }

  return {
    assumptionId,
    basename,
    path,
    link: '[[' + basename + ']]',
    content: buildAssumptionContent({
      today,
      statement: data.statement,
      falsifier: data.falsifier,
      verifyBy: data.verifyBy || '',
      betLinks: bets.map((f) => '[[' + f.basename + ']]'),
    }),
    bets,
  };
}

async function createAssumptionFromForm(app, data) {
  const today = moment().format('YYYY-MM-DD');

  await ensureFolder(app, ASSUMPTIONS_FOLDER);

  const plan = buildAssumptionWritePlan(app, data, today);
  if (plan.error) {
    console.error('strategy-bet-creator: aborted before writing —', plan.error);
    new Notice(plan.error, 15000);
    return;
  }

  try {
    const assumptionFile = await app.vault.create(plan.path, plan.content);

    // Backlink into every selected bet's "Assumptions This Bet Depends On", idempotently.
    for (const betFile of plan.bets) {
      await app.vault.process(betFile, (content) =>
        insertIntoSection(content, BET_ASSUMPTIONS_HEADING, '- ' + plan.link, plan.link)
      );
    }

    await app.workspace.getLeaf(false).openFile(assumptionFile);

    new Notice('Created ' + plan.basename + ' — linked to ' + plan.bets.length + ' bet(s).');
  } catch (err) {
    console.error('strategy-bet-creator: failed part-way through assumption creation', err);
    new Notice('Assumption creation failed: ' + (err && err.message ? err.message : String(err)), 20000);
  }
}

module.exports = class StrategyBetCreator extends Plugin {
  onload() {
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

    this.addRibbonIcon('target', 'New strategy bet', openBetModal);
    this.addCommand({ id: 'create-bet', name: 'Create new Bet', callback: openBetModal });

    this.addRibbonIcon('link', 'New strategy assumption', openAssumptionModal);
    this.addCommand({ id: 'create-assumption', name: 'Create new Assumption', callback: openAssumptionModal });
  }
};
