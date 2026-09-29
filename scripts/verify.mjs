import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const buildPath = join(projectRoot, 'scripts', 'build.mjs');
let failures = 0;
let tests = 0;

async function test(name, run) {
  tests++;
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

const question = {
  id: 1,
  difficulty: 'easy',
  category: 'Fire support',
  prompt: 'Which fire support choice fits the situation?',
  options: ['First', 'Second', 'Third', 'Fourth'],
  answer: 2,
  explanation: 'The third choice fits the stated constraints.',
  tags: ['planning'],
  sourceSlides: [15],
};

await test('buildHtml replaces each bank placeholder once and leaves no bank tokens', async () => {
  const { buildHtml } = await import('./build.mjs');
  const template = '<script type="application/json" id="easy">{{EASY_QUESTIONS}}</script><script type="application/json" id="medium">{{MEDIUM_QUESTIONS}}</script><script type="application/json" id="hard">{{HARD_QUESTIONS}}</script>';
  const html = buildHtml(template, { easy: [question], medium: [], hard: [] });
  assert.equal(html.includes('{{EASY_QUESTIONS}}'), false);
  assert.equal(html.includes('{{MEDIUM_QUESTIONS}}'), false);
  assert.equal(html.includes('{{HARD_QUESTIONS}}'), false);
  assert.deepEqual(JSON.parse(html.match(/id="easy">(.*?)<\/script>/)[1]), [question]);
  assert.deepEqual(JSON.parse(html.match(/id="medium">(.*?)<\/script>/)[1]), []);
  assert.deepEqual(JSON.parse(html.match(/id="hard">(.*?)<\/script>/)[1]), []);
});

await test('buildHtml escapes script-closing text in embedded JSON', async () => {
  const { buildHtml } = await import('./build.mjs');
  const template = '<script type="application/json">{{EASY_QUESTIONS}}</script>{{MEDIUM_QUESTIONS}}{{HARD_QUESTIONS}}';
  const html = buildHtml(template, {
    easy: [{ ...question, prompt: '</script><script>alert(1)</script>' }],
    medium: [], hard: [],
  });
  assert.equal(html.includes('</script><script>alert(1)'), false);
  assert.match(html, /\\u003c\/script>/);
  assert.equal(JSON.parse(html.match(/<script type="application\/json">(.*?)<\/script>/)[1])[0].prompt, '</script><script>alert(1)</script>');
});

await test('buildHtml rejects duplicated bank placeholders', async () => {
  const { buildHtml } = await import('./build.mjs');
  assert.throws(() => buildHtml('{{EASY_QUESTIONS}}{{EASY_QUESTIONS}}{{MEDIUM_QUESTIONS}}{{HARD_QUESTIONS}}', { easy: [], medium: [], hard: [] }), /EASY_QUESTIONS/);
});

await test('validateQuestion accepts a complete question', async () => {
  const { validateQuestion } = await import('./build.mjs');
  assert.deepEqual(validateQuestion(question, 'easy', 1), []);
});

await test('validateQuestion reports explicit field errors for malformed questions', async () => {
  const { validateQuestion } = await import('./build.mjs');
  const errors = validateQuestion({ ...question, id: 1.5, difficulty: 'hard', options: ['Only one'], answer: 4, sourceSlides: [14, '15'] }, 'easy', 1);
  for (const field of ['id', 'difficulty', 'options', 'answer', 'sourceSlides']) {
    assert.ok(errors.some(error => error.includes(field)), `missing ${field} error: ${errors.join('; ')}`);
  }
  const nullErrors = validateQuestion(null, 'easy', 1);
  assert.ok(nullErrors.length > 0);
});

await test('build CLI names the missing question-bank file', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'artillery-build-'));
  try {
    mkdirSync(join(fixtureRoot, 'scripts'));
    mkdirSync(join(fixtureRoot, 'src', 'questions'), { recursive: true });
    copyFileSync(buildPath, join(fixtureRoot, 'scripts', 'build.mjs'));
    writeFileSync(join(fixtureRoot, 'src', 'template.html'), '{{EASY_QUESTIONS}}{{MEDIUM_QUESTIONS}}{{HARD_QUESTIONS}}');
    writeFileSync(join(fixtureRoot, 'src', 'questions', 'medium.json'), '[]');
    writeFileSync(join(fixtureRoot, 'src', 'questions', 'hard.json'), '[]');
    const result = spawnSync(process.execPath, [join(fixtureRoot, 'scripts', 'build.mjs')], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /easy\.json/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

const easyBank = JSON.parse(readFileSync(join(projectRoot, 'src', 'questions', 'easy.json'), 'utf8'));

await test('Easy bank contains exactly 25 questions with sequential IDs 1-25', () => {
  assert.equal(easyBank.length, 25);
  assert.deepEqual(easyBank.map(item => item.id), Array.from({ length: 25 }, (_, index) => index + 1));
});

await test('Easy questions satisfy the schema, difficulty, four-choice and source-slide contracts', async () => {
  const { validateQuestion } = await import('./build.mjs');
  easyBank.forEach((item, index) => {
    assert.deepEqual(validateQuestion(item, 'easy', index + 1), [], `Easy ${index + 1}`);
    assert.ok(item.tags.length > 0, `Easy ${index + 1} must identify its topics`);
  });
});

function assertUniquePrompts(banks) {
  const seen = new Map();
  for (const [difficulty, bank] of Object.entries(banks)) {
    for (const item of bank) {
      const normalized = item.prompt.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      const label = `${difficulty} ${item.id}`;
      assert.ok(!seen.has(normalized), `Duplicate normalized prompt: ${seen.get(normalized)} and ${label}`);
      seen.set(normalized, label);
    }
  }
}

await test('Easy prompts are unique after case, punctuation and whitespace normalization', () => {
  assertUniquePrompts({ easy: easyBank });
});

await test('Easy primary categories follow the required 2/3/3/2/4/2/3/4/2 allocation', () => {
  const counts = {};
  for (const item of easyBank) counts[item.category] = (counts[item.category] ?? 0) + 1;
  assert.deepEqual(counts, {
    'Mission and Functions': 2,
    'Tactical Roles': 3,
    'Capabilities and Limitations': 3,
    'Weapon Classification': 2,
    'Effects of Fires': 4,
    'Philippine Operational Environment': 2,
    'Four Basic Tasks': 3,
    'FA System Elements and Responsibilities': 4,
    'Employment Tactics and Integrated Decisions': 2,
  });
});

await test('Easy answers have 7/6/6/6 occurrences across A/B/C/D', () => {
  const counts = [0, 0, 0, 0];
  for (const item of easyBank) counts[item.answer]++;
  assert.deepEqual(counts, [7, 6, 6, 6]);
  assert.ok(counts.every(count => count === 6 || count === 7));
});

const mediumBank = JSON.parse(readFileSync(join(projectRoot, 'src', 'questions', 'medium.json'), 'utf8'));

await test('Medium bank contains exactly 25 questions with sequential IDs 1-25', () => {
  assert.equal(mediumBank.length, 25);
  assert.deepEqual(mediumBank.map(item => item.id), Array.from({ length: 25 }, (_, index) => index + 1));
});

await test('Medium questions satisfy the schema, difficulty, four-choice and source-slide contracts', async () => {
  const { validateQuestion } = await import('./build.mjs');
  mediumBank.forEach((item, index) => {
    assert.deepEqual(validateQuestion(item, 'medium', index + 1), [], `Medium ${index + 1}`);
    assert.ok(item.tags.length > 0, `Medium ${index + 1} must identify its topics`);
  });
});

await test('Medium primary categories follow the required 2/3/3/2/4/2/3/4/2 allocation', () => {
  const counts = {};
  for (const item of mediumBank) counts[item.category] = (counts[item.category] ?? 0) + 1;
  assert.deepEqual(counts, {
    'Mission and Functions': 2,
    'Tactical Roles': 3,
    'Capabilities and Limitations': 3,
    'Weapon Classification': 2,
    'Effects of Fires': 4,
    'Philippine Operational Environment': 2,
    'Four Basic Tasks': 3,
    'FA System Elements and Responsibilities': 4,
    'Employment Tactics and Integrated Decisions': 2,
  });
});

await test('Medium answers have 6/7/6/6 occurrences across A/B/C/D', () => {
  const counts = [0, 0, 0, 0];
  for (const item of mediumBank) counts[item.answer]++;
  assert.deepEqual(counts, [6, 7, 6, 6]);
});

await test('Easy and Medium prompts are unique within and across both banks', () => {
  assertUniquePrompts({ easy: easyBank, medium: mediumBank });
});

await test('Cross-bank duplicate check rejects a literal case, punctuation and spacing near-copy', () => {
  assert.throws(() => assertUniquePrompts({
    easy: [{ id: 1, prompt: 'A Philippine Army review: which system failed?' }],
    medium: [{ id: 8, prompt: '  A PHILIPPINE army REVIEW -- which   system failed!  ' }],
  }), /Duplicate normalized prompt: easy 1 and medium 8/);
  assert.doesNotThrow(() => assertUniquePrompts({
    easy: [{ id: 1, prompt: 'A Philippine Army review: which system failed?' }],
    medium: [{ id: 8, prompt: 'A Philippine Army review: which task was fulfilled?' }],
  }));
});

const hardBank = JSON.parse(readFileSync(join(projectRoot, 'src', 'questions', 'hard.json'), 'utf8'));

await test('Hard bank contains exactly 25 questions with sequential IDs 1-25', () => {
  assert.equal(hardBank.length, 25);
  assert.deepEqual(hardBank.map(item => item.id), Array.from({ length: 25 }, (_, index) => index + 1));
});

await test('Hard questions satisfy the schema, difficulty, four-choice and source-slide contracts', async () => {
  const { validateQuestion } = await import('./build.mjs');
  hardBank.forEach((item, index) => {
    assert.deepEqual(validateQuestion(item, 'hard', index + 1), [], `Hard ${index + 1}`);
    assert.ok(item.tags.length >= 3, `Hard ${index + 1} must integrate several tagged concepts`);
  });
});

await test('Hard primary categories follow the required 2/3/3/2/4/2/3/4/2 allocation', () => {
  const counts = {};
  for (const item of hardBank) counts[item.category] = (counts[item.category] ?? 0) + 1;
  assert.deepEqual(counts, {
    'Mission and Functions': 2,
    'Tactical Roles': 3,
    'Capabilities and Limitations': 3,
    'Weapon Classification': 2,
    'Effects of Fires': 4,
    'Philippine Operational Environment': 2,
    'Four Basic Tasks': 3,
    'FA System Elements and Responsibilities': 4,
    'Employment Tactics and Integrated Decisions': 2,
  });
});

await test('Hard answers have 6/6/7/6 occurrences across A/B/C/D', () => {
  const counts = [0, 0, 0, 0];
  for (const item of hardBank) counts[item.answer]++;
  assert.deepEqual(counts, [6, 6, 7, 6]);
});

await test('Hard scenarios exercise every required competing constraint', () => {
  const HARD_CONSTRAINT_TAGS = [
    'communications failure',
    'counterfire exposure',
    'ammunition economy',
    'island movement',
    'survey and MET accuracy',
    'target acquisition',
    'maneuver timing',
    'continuity of fires',
    'offensive positioning',
    'defensive positioning',
  ];
  const hardTags = new Set(hardBank.flatMap(item => item.tags));
  const missing = HARD_CONSTRAINT_TAGS.filter(tag => !hardTags.has(tag));
  assert.deepEqual(missing, [], `Hard constraint tags missing: ${missing.join(', ')}`);
});

await test('All 75 prompts are unique within and across the Easy, Medium and Hard banks', () => {
  assert.equal(easyBank.length + mediumBank.length + hardBank.length, 75);
  assertUniquePrompts({ easy: easyBank, medium: mediumBank, hard: hardBank });
});

const REQUIRED_TAGS = [
  // Mission (slide 15)
  'mission',
  'destroy/neutralize/suppress mission',
  'timely and accurate support',
  'integration of fire-support means',
  // Functions (slide 16)
  'functions',
  'continuous fire support',
  'communications',
  'mobility',
  'survey',
  'meteorological data',
  'target acquisition',
  'fire direction and coordination',
  'fire-support cells',
  'fire-support elements',
  'command and control of additional artillery',
  // Tactical roles (slide 17)
  'close support',
  'attack at depth',
  'interdiction',
  'counterfires',
  // Capabilities (slide 18)
  'all-weather and all-terrain fires',
  'rapid shifting and massing',
  'add depth to the battlefield',
  'shell/fuze variety',
  'continuous support by judicious displacement',
  // Limitations (slide 19)
  'limited self-defense',
  'point-target ammunition cost',
  'detectable firing signature',
  'weapon range limits',
  // Classification by caliber (slide 20)
  'classification by caliber',
  'light',
  'medium',
  'heavy',
  'very heavy',
  // Classification by means of transport (slides 21-24)
  'classification by transport',
  'towed',
  'self-propelled',
  'aerial',
  // Effects of fires and computed-effect thresholds (slides 25-28)
  'destroy',
  'neutralize',
  'suppress',
  'disrupt',
  'defeat',
  'diversion',
  '30-percent computed-effect threshold',
  '10-percent computed-effect threshold',
  '3-percent computed-effect threshold',
  // Philippine archipelagic environment (slide 29)
  'Philippine archipelago',
  'rapid displacement between islands',
  'continuity during displacement',
  // Four basic tasks (slide 31)
  'support forces in contact',
  'support the concept of operations',
  'synchronize fire support',
  'economize resources',
  'sustain FA operations',
  // Ten system elements not already listed above (slide 32)
  'weapon/ammunition combinations',
  'organization',
  'ballistic meteorology',
  'logistics',
  'employment tactics',
  // Specialized responsibilities and relationships (slides 33-38)
  'observers and collectors',
  'drones and vertical imagery',
  'FA intelligence',
  'Target Acquisition Platoon',
  'FA Regiment and FA Bn intelligence office',
  'fire direction center',
  'call-for-fire conversion',
  'suitable weapon coverage',
  'command and support relationships',
  'FA platoon smallest deployable unit',
  'common survey grid',
  'five requirements for accurate predicted fires',
  'radio and digital communications',
  'Signal Platoon',
  'Headquarters and Headquarters Battery',
  'mobility assets',
  'offensive positioning',
  'defensive positioning',
  'continuity of fires',
];

await test('Coverage registry lists each required tag once', () => {
  assert.equal(new Set(REQUIRED_TAGS).size, REQUIRED_TAGS.length);
});

await test('Every required coverage tag appears across the 75-question bank', () => {
  const allTags = new Set([...easyBank, ...mediumBank, ...hardBank].flatMap(item => item.tags));
  const missing = REQUIRED_TAGS.filter(tag => !allTags.has(tag));
  assert.deepEqual(missing, [], `Coverage tags missing: ${missing.join(', ')}`);
});

// ---------------------------------------------------------------------------
// Application interaction contracts (Task 5)
//
// The app script is taken from the BUILT index.html and executed with node:vm
// against a small fake DOM built by parsing that same index.html, so these
// tests exercise the real shipped markup and code rather than a copy.
// ---------------------------------------------------------------------------

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', middot: '·', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return String.fromCodePoint(value);
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

class FakeText {
  constructor(text) {
    this.nodeType = 3;
    this.data = String(text);
    this.parentNode = null;
  }
  get textContent() { return this.data; }
  set textContent(value) { this.data = String(value); }
}

class FakeClassList {
  constructor(element) { this.element = element; }
  values() { return (this.element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean); }
  contains(name) { return this.values().includes(name); }
  add(...names) { this.element.setAttribute('class', [...new Set([...this.values(), ...names])].join(' ')); }
  remove(...names) { this.element.setAttribute('class', this.values().filter(name => !names.includes(name)).join(' ')); }
  toggle(name, force) {
    const on = force === undefined ? !this.contains(name) : Boolean(force);
    if (on) this.add(name); else this.remove(name);
    return on;
  }
}

function reflectAttribute(name, attribute = name) {
  return {
    get() { return this.getAttribute(attribute) ?? ''; },
    set(value) { this.setAttribute(attribute, value); },
  };
}

function reflectBoolean(attribute) {
  return {
    get() { return this.hasAttribute(attribute); },
    set(value) { if (value) this.setAttribute(attribute, ''); else this.removeAttribute(attribute); },
  };
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.nodeType = 1;
    this.localName = tagName.toLowerCase();
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.checkedState = null;
    this.classList = new FakeClassList(this);
  }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  hasAttribute(name) { return this.attributes.has(name); }
  get type() {
    return (this.getAttribute('type') ?? (this.localName === 'button' ? 'submit' : 'text')).toLowerCase();
  }
  set type(value) { this.setAttribute('type', value); }
  get checked() { return this.checkedState ?? this.hasAttribute('checked'); }
  set checked(value) { this.checkedState = Boolean(value); }
  get textContent() { return this.childNodes.map(node => node.textContent).join(''); }
  set textContent(value) {
    this.replaceChildren();
    if (String(value) !== '') this.appendChild(new FakeText(value));
  }
  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  append(...nodes) {
    for (const node of nodes) this.appendChild(typeof node === 'string' ? new FakeText(node) : node);
  }
  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index === -1) throw new Error('removeChild: not a child');
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }
  replaceChildren(...nodes) {
    for (const node of this.childNodes) node.parentNode = null;
    this.childNodes = [];
    this.append(...nodes);
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  removeEventListener(type, listener) {
    const list = this.listeners.get(type) ?? [];
    const index = list.indexOf(listener);
    if (index !== -1) list.splice(index, 1);
  }
  dispatchEvent(event) {
    if (!event.target) event.target = this;
    event.currentTarget = this;
    for (const listener of [...(this.listeners.get(event.type) ?? [])]) listener.call(this, event);
    return !event.defaultPrevented;
  }
  click() {
    if (this.disabled) return;
    const event = type => ({ type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });
    if (this.localName === 'input' && this.type === 'checkbox') {
      this.checked = !this.checked;
      this.dispatchEvent(event('click'));
      this.dispatchEvent(event('input'));
      this.dispatchEvent(event('change'));
      return;
    }
    if (this.localName === 'input' && this.type === 'radio') {
      const wasChecked = this.checked;
      if (!wasChecked) {
        for (const other of findAll(this.ownerDocument.root, node => node.localName === 'input' && node.type === 'radio' && node.name === this.name)) {
          other.checked = false;
        }
        this.checked = true;
      }
      this.dispatchEvent(event('click'));
      if (!wasChecked) {
        this.dispatchEvent(event('input'));
        this.dispatchEvent(event('change'));
      }
      return;
    }
    this.dispatchEvent(event('click'));
  }
  focus() {
    // Mirror browsers: hidden or non-focusable elements silently ignore focus().
    if (!isShown(this)) return;
    const interactive = ['button', 'input', 'select', 'textarea'].includes(this.localName) && !this.disabled;
    if (!interactive && !this.hasAttribute('tabindex')) return;
    this.ownerDocument.activeElement = this;
  }
}

Object.defineProperties(FakeElement.prototype, {
  id: reflectAttribute('id'),
  className: reflectAttribute('className', 'class'),
  name: reflectAttribute('name'),
  value: reflectAttribute('value'),
  htmlFor: reflectAttribute('htmlFor', 'for'),
  hidden: reflectBoolean('hidden'),
  disabled: reflectBoolean('disabled'),
  tabIndex: {
    get() { return Number(this.getAttribute('tabindex') ?? 0); },
    set(value) { this.setAttribute('tabindex', value); },
  },
});

class FakeDocument {
  constructor() {
    this.root = new FakeElement('#document', this);
    this.activeElement = null;
  }
  get body() { return findAll(this.root, node => node.localName === 'body')[0] ?? null; }
  createElement(tagName) { return new FakeElement(tagName, this); }
  createTextNode(text) { return new FakeText(text); }
  getElementById(id) { return findAll(this.root, node => node.getAttribute('id') === id)[0] ?? null; }
}

function findAll(root, predicate) {
  const found = [];
  const visit = node => {
    for (const child of node.childNodes) {
      if (child.nodeType !== 1) continue;
      if (predicate(child)) found.push(child);
      visit(child);
    }
  };
  visit(root);
  return found;
}

function isShown(node) {
  for (let current = node; current; current = current.parentNode) {
    if (current.nodeType === 1 && current.hasAttribute('hidden')) return false;
  }
  return true;
}

function parseHtml(html) {
  const document = new FakeDocument();
  const stack = [document.root];
  const tagPattern = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/gi;
  const attributePattern = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let cursor = 0;
  let match;
  while ((match = tagPattern.exec(html))) {
    if (match.index > cursor) stack.at(-1).appendChild(new FakeText(decodeEntities(html.slice(cursor, match.index))));
    cursor = tagPattern.lastIndex;
    const [whole, closingName, openingName, attributeText = '', selfClosing] = match;
    if (whole.startsWith('<!')) continue;
    if (closingName) {
      const name = closingName.toLowerCase();
      const index = stack.findLastIndex(node => node.localName === name);
      if (index > 0) stack.length = index;
      continue;
    }
    const element = document.createElement(openingName);
    for (const [, name, doubleQuoted, singleQuoted, bare] of attributeText.matchAll(attributePattern)) {
      element.setAttribute(name.toLowerCase(), decodeEntities(doubleQuoted ?? singleQuoted ?? bare ?? ''));
    }
    stack.at(-1).appendChild(element);
    if (RAW_TEXT_ELEMENTS.has(element.localName)) {
      const end = html.toLowerCase().indexOf(`</${element.localName}`, cursor);
      if (end === -1) throw new Error(`Unclosed <${element.localName}>`);
      element.appendChild(new FakeText(html.slice(cursor, end)));
      tagPattern.lastIndex = html.indexOf('>', end) + 1;
      cursor = tagPattern.lastIndex;
    } else if (!VOID_ELEMENTS.has(element.localName) && !selfClosing) {
      stack.push(element);
    }
  }
  if (cursor < html.length) stack.at(-1).appendChild(new FakeText(decodeEntities(html.slice(cursor))));
  return document;
}

const builtHtml = readFileSync(join(projectRoot, 'index.html'), 'utf8');

function appScripts(document) {
  return findAll(document.root, node => node.localName === 'script' && !/json/i.test(node.getAttribute('type') ?? ''));
}

function loadApp(html = builtHtml) {
  const document = parseHtml(html);
  const printCalls = [];
  const consoleErrors = [];
  const sandbox = {
    document,
    console: { log() {}, info() {}, warn() {}, error: (...args) => consoleErrors.push(args.map(String).join(' ')) },
    print: () => printCalls.push(Date.now()),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const script of appScripts(document)) {
    vm.runInContext(script.textContent, sandbox, { filename: 'index.html' });
  }
  const api = sandbox.__artilleryQuiz;
  assert.ok(api, 'index.html must expose globalThis.__artilleryQuiz');
  return { document, api, printCalls, consoleErrors };
}

function byId(app, id) {
  const node = app.document.getElementById(id);
  assert.ok(node, `index.html must contain #${id}`);
  return node;
}

const plain = value => JSON.parse(JSON.stringify(value));
const MODES = ['easy', 'medium', 'hard'];
const LETTERS = ['A', 'B', 'C', 'D'];
const sourceBanks = { easy: easyBank, medium: mediumBank, hard: hardBank };

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function attemptOf(app) {
  const { attempt } = plain(app.api.getState());
  assert.ok(attempt, 'an attempt must be active');
  return attempt;
}

function modeButtons(app) {
  return MODES.map(mode => byId(app, `mode-${mode}`));
}

function radios(app) {
  return findAll(byId(app, 'question-area'), node => node.localName === 'input' && node.type === 'radio');
}

function startConfirmed(app, mode = 'easy') {
  byId(app, 'study-confirm').click();
  byId(app, `mode-${mode}`).click();
  assert.equal(plain(app.api.getState()).view, 'quiz', `${mode} must start after confirmation`);
}

// Answers every remaining question through the real controls; chooseCorrect(index) decides each answer.
function completeAttempt(app, chooseCorrect = () => true) {
  for (let index = 0; index < 25; index++) {
    const attempt = attemptOf(app);
    assert.equal(attempt.current, index);
    const question = attempt.questions[index];
    const choice = chooseCorrect(index) ? question.answer : (question.answer + 1) % 4;
    radios(app)[choice].click();
    byId(app, 'btn-check').click();
    if (index < 24) byId(app, 'btn-next').click();
  }
}

function replaceBank(html, mode, content) {
  const pattern = new RegExp(`(<script type="application/json" id="questions-${mode}">)[\\s\\S]*?(</script>)`);
  assert.match(html, pattern);
  return html.replace(pattern, (_, open, close) => `${open}${content}${close}`);
}

await test('index.html is a fresh build of the template and banks', async () => {
  const { buildHtml } = await import('./build.mjs');
  const template = readFileSync(join(projectRoot, 'src', 'template.html'), 'utf8');
  assert.equal(builtHtml, buildHtml(template, sourceBanks), 'run node scripts/build.mjs before verifying');
});

await test('App exposes the quiz engine through globalThis.__artilleryQuiz', () => {
  const { api } = loadApp();
  for (const name of ['validateBanks', 'shuffleQuestions', 'createAttempt', 'setStudyConfirmed', 'startQuiz', 'selectAnswer', 'checkAnswer', 'goToQuestion', 'finishQuiz', 'retakeQuiz', 'resetToDifficulty', 'masteryBand', 'getState', 'getBanks', 'setRandom']) {
    assert.equal(typeof api[name], 'function', `${name} must be exposed`);
  }
  const state = plain(api.getState());
  assert.equal(state.available, true);
  assert.equal(state.view, 'landing');
});

await test('Study warning shows the exact confirmation text and all mode buttons start disabled', () => {
  const app = loadApp();
  const checkbox = byId(app, 'study-confirm');
  assert.equal(checkbox.localName, 'input');
  assert.equal(checkbox.type, 'checkbox');
  assert.equal(checkbox.checked, false);
  const label = findAll(app.document.root, node => node.localName === 'label' && (node.htmlFor === 'study-confirm' || node.children.includes(checkbox)))[0];
  assert.ok(label, 'the checkbox must have a label');
  assert.equal(label.textContent.replace(/\s+/g, ' ').trim(), 'I understand that I must study the complete lesson and not rely only on this mock examination.');
  assert.ok(isShown(byId(app, 'view-landing')));
  for (const button of modeButtons(app)) {
    assert.equal(button.localName, 'button');
    assert.equal(button.disabled, true, `${button.id} must start disabled`);
  }
});

await test('Checking the warning enables the mode buttons and unchecking disables them again', () => {
  const app = loadApp();
  const checkbox = byId(app, 'study-confirm');
  byId(app, 'mode-easy').click();
  assert.equal(plain(app.api.getState()).view, 'landing', 'a disabled button must not start the quiz');
  assert.equal(app.api.startQuiz('easy'), false, 'startQuiz must refuse before confirmation');
  assert.equal(isShown(byId(app, 'view-quiz')), false);

  checkbox.click();
  assert.equal(plain(app.api.getState()).studyConfirmed, true);
  for (const button of modeButtons(app)) assert.equal(button.disabled, false, `${button.id} must enable`);

  checkbox.click();
  assert.equal(plain(app.api.getState()).studyConfirmed, false);
  for (const button of modeButtons(app)) assert.equal(button.disabled, true, `${button.id} must disable again`);
  assert.equal(app.api.startQuiz('medium'), false);

  app.api.setStudyConfirmed(true);
  assert.equal(checkbox.checked, true, 'setStudyConfirmed keeps the checkbox in sync');
  for (const button of modeButtons(app)) assert.equal(button.disabled, false);
  app.api.setStudyConfirmed(false);
  assert.equal(checkbox.checked, false);
  for (const button of modeButtons(app)) assert.equal(button.disabled, true);
});

await test('Each difficulty loads only its own 25 questions', () => {
  for (const mode of MODES) {
    const app = loadApp();
    startConfirmed(app, mode);
    const attempt = attemptOf(app);
    assert.equal(attempt.mode, mode);
    assert.equal(attempt.questions.length, 25);
    assert.ok(attempt.questions.every(item => item.difficulty === mode), `${mode} attempt mixed difficulties`);
    assert.deepEqual(attempt.questions.map(item => item.id).sort((a, b) => a - b), Array.from({ length: 25 }, (_, index) => index + 1));
    assert.deepEqual(new Set(attempt.questions.map(item => item.prompt)), new Set(sourceBanks[mode].map(item => item.prompt)));
    assert.deepEqual(attempt.questions, attempt.questions.map(item => sourceBanks[mode].find(source => source.id === item.id)), 'authored question and choice order must be preserved');
    assert.equal(byId(app, 'question-prompt').textContent, attempt.questions[0].prompt);
  }
});

await test('Starting a quiz renders the first question as a fieldset with four radio choices and moves focus to it', () => {
  const app = loadApp();
  startConfirmed(app, 'hard');
  const attempt = attemptOf(app);
  assert.ok(isShown(byId(app, 'view-quiz')));
  assert.equal(isShown(byId(app, 'view-landing')), false);
  assert.equal(app.document.activeElement?.id, 'question-heading');
  assert.match(byId(app, 'question-heading').textContent, /Question 1 of 25/);
  const legend = byId(app, 'question-prompt');
  assert.equal(legend.localName, 'legend');
  assert.equal(legend.parentNode.localName, 'fieldset');
  const choices = radios(app);
  assert.equal(choices.length, 4);
  assert.equal(new Set(choices.map(choice => choice.name)).size, 1);
  choices.forEach((choice, index) => {
    const label = findAll(app.document.root, node => node.localName === 'label' && (node.htmlFor === choice.id || node.children.includes(choice)))[0];
    assert.ok(label, `choice ${index} must be labelled`);
    assert.ok(label.textContent.includes(attempt.questions[0].options[index]));
    assert.ok(label.textContent.includes(`${LETTERS[index]}.`));
  });
  const status = byId(app, 'quiz-status');
  assert.ok(status.getAttribute('role') === 'status' || status.getAttribute('aria-live'), 'quiz status must be a live region');
  assert.equal(byId(app, 'quiz-progress').localName, 'progress');
});

await test('Fisher-Yates shuffle matches a hand-checked order and copies the source', () => {
  const { api } = loadApp();
  const source = ['a', 'b', 'c', 'd', 'e'];
  const draws = [0.1, 0.9, 0.5, 0.0];
  // i=4: j=floor(0.1*5)=0 -> e b c d a; i=3: j=floor(0.9*4)=3 -> unchanged;
  // i=2: j=floor(0.5*3)=1 -> e c b d a; i=1: j=floor(0.0*2)=0 -> c e b d a
  const shuffled = api.shuffleQuestions(source, () => draws.shift());
  assert.deepEqual(plain(shuffled), ['c', 'e', 'b', 'd', 'a']);
  assert.deepEqual(source, ['a', 'b', 'c', 'd', 'e'], 'source must not be mutated');
  assert.notEqual(shuffled, source);
  assert.equal(draws.length, 0, 'exactly n-1 random draws');
  const defaultShuffle = plain(api.shuffleQuestions(source));
  assert.deepEqual([...defaultShuffle].sort(), source);

  const attempt = plain(api.createAttempt('medium', sourceBanks, seededRandom(3)));
  assert.equal(attempt.mode, 'medium');
  assert.deepEqual(attempt.questions, plain(api.shuffleQuestions(mediumBank, seededRandom(3))));
  assert.equal(attempt.current, 0);
  assert.ok(attempt.responses.length === 25 && attempt.responses.every(response => response.selected === null && response.checked === false));
});

await test('Source banks stay unchanged while three retakes each reshuffle the same difficulty', () => {
  const app = loadApp();
  const snapshot = JSON.stringify(app.api.getBanks());
  assert.equal(snapshot, JSON.stringify(sourceBanks));
  app.api.setRandom(seededRandom(7));
  startConfirmed(app, 'medium');
  let previousOrder = attemptOf(app).questions.map(item => item.id);
  for (let retake = 1; retake <= 3; retake++) {
    completeAttempt(app);
    byId(app, 'btn-finish').click();
    assert.equal(plain(app.api.getState()).view, 'results');
    byId(app, 'btn-retake').click();
    const attempt = attemptOf(app);
    assert.equal(attempt.mode, 'medium', `retake ${retake} keeps the difficulty`);
    assert.ok(attempt.responses.every(response => response.selected === null && !response.checked), `retake ${retake} starts clean`);
    const order = attempt.questions.map(item => item.id);
    assert.notDeepEqual(order, previousOrder, `retake ${retake} must reshuffle`);
    assert.equal(JSON.stringify(app.api.getBanks()), snapshot, `source banks changed after retake ${retake}`);
    assert.equal(app.document.activeElement?.id, 'question-heading');
    previousOrder = order;
  }
});

await test('Question order and recorded answers stay stable during navigation', () => {
  const app = loadApp();
  startConfirmed(app, 'easy');
  const order = attemptOf(app).questions.map(item => item.id);
  for (let index = 0; index < 5; index++) {
    radios(app)[index % 4].click();
    byId(app, 'btn-check').click();
    byId(app, 'btn-next').click();
  }
  assert.equal(attemptOf(app).current, 5);
  assert.equal(app.api.goToQuestion(7), false, 'cannot skip past the first unchecked question');
  assert.equal(app.api.goToQuestion(-1), false);
  assert.equal(app.api.goToQuestion(1), true);
  assert.equal(app.document.activeElement?.id, 'question-heading');
  assert.equal(radios(app)[1].checked, true, 'recorded answer shows on revisit');
  assert.ok(radios(app).every(choice => choice.disabled), 'revisited checked question stays locked');
  assert.ok(isShown(byId(app, 'answer-feedback')), 'feedback stays reviewable');
  byId(app, 'btn-prev').click();
  assert.equal(attemptOf(app).current, 0);
  assert.equal(isShown(byId(app, 'btn-prev')), false, 'no previous button on question 1');
  assert.equal(app.api.goToQuestion(5), true);
  const attempt = attemptOf(app);
  assert.deepEqual(attempt.questions.map(item => item.id), order);
  assert.deepEqual(attempt.responses.slice(0, 5).map(response => [response.selected, response.checked]), [[0, true], [1, true], [2, true], [3, true], [0, true]]);
  assert.deepEqual([attempt.responses[5].selected, attempt.responses[5].checked], [null, false]);
});

await test('Check answer with no selection shows a validation message and does not advance', () => {
  const app = loadApp();
  startConfirmed(app, 'easy');
  const validation = byId(app, 'validation-message');
  assert.equal(isShown(validation), false);
  byId(app, 'btn-check').click();
  assert.equal(app.api.checkAnswer(), false);
  const attempt = attemptOf(app);
  assert.equal(attempt.current, 0);
  assert.equal(attempt.responses[0].checked, false);
  assert.ok(isShown(validation));
  assert.match(validation.textContent, /select an answer/i);
  assert.ok(validation.getAttribute('role') === 'alert' || validation.getAttribute('aria-live'));
  assert.equal(app.document.activeElement?.id, 'validation-message');
  assert.equal(isShown(byId(app, 'btn-next')), false);
  assert.equal(isShown(byId(app, 'answer-feedback')), false);
  radios(app)[2].click();
  assert.equal(isShown(validation), false, 'selecting clears the validation message');
});

await test('Checked answers lock and cannot be changed', () => {
  const app = loadApp();
  startConfirmed(app, 'hard');
  const question = attemptOf(app).questions[0];
  const wrong = (question.answer + 1) % 4;
  radios(app)[wrong].click();
  assert.equal(app.api.checkAnswer(), true);
  assert.equal(app.api.selectAnswer(question.answer), false);
  radios(app)[question.answer].click();
  assert.equal(app.api.checkAnswer(), false, 'a checked answer cannot be checked again');
  const response = attemptOf(app).responses[0];
  assert.deepEqual([response.selected, response.checked], [wrong, true]);
  assert.ok(radios(app).every(choice => choice.disabled));
  assert.equal(radios(app)[wrong].checked, true);
  assert.equal(isShown(byId(app, 'btn-check')), false);
});

await test('Checking reveals the correct answer and explanation and focuses the feedback', () => {
  const app = loadApp();
  startConfirmed(app, 'easy');
  const [first, second] = attemptOf(app).questions;
  const wrong = (first.answer + 3) % 4;
  radios(app)[wrong].click();
  byId(app, 'btn-check').click();
  const feedback = byId(app, 'answer-feedback');
  assert.ok(isShown(feedback));
  assert.equal(app.document.activeElement?.id, 'answer-feedback');
  const text = feedback.textContent;
  assert.match(text, /Incorrect/);
  assert.ok(text.includes(`Correct answer: ${LETTERS[first.answer]}. ${first.options[first.answer]}`), text);
  assert.ok(text.includes(`Your answer: ${LETTERS[wrong]}. ${first.options[wrong]}`), text);
  assert.ok(text.includes(first.explanation));
  const labels = findAll(byId(app, 'question-area'), node => node.localName === 'label');
  assert.ok(labels[first.answer].classList.contains('option-correct'));
  assert.ok(labels[wrong].classList.contains('option-incorrect'));
  assert.match(labels[first.answer].textContent, /Correct answer/, 'correctness is not conveyed by color alone');
  assert.equal(plain(app.api.getState()).attempt.current, 0, 'checking does not advance by itself');

  byId(app, 'btn-next').click();
  radios(app)[second.answer].click();
  byId(app, 'btn-check').click();
  assert.match(byId(app, 'answer-feedback').textContent, /^\s*Correct\./);
  assert.ok(byId(app, 'answer-feedback').textContent.includes(second.explanation));
});

await test('validateBanks accepts the embedded banks and mirrors the build validator error-for-error', async () => {
  const { validateQuestion } = await import('./build.mjs');
  const { api } = loadApp();
  assert.deepEqual(plain(api.validateBanks(sourceBanks)), { valid: true, errors: [] });
  const base = easyBank[0];
  const mutations = [
    { ...base, id: 1.5 },
    { ...base, difficulty: 'hard' },
    { ...base, options: base.options.slice(0, 3) },
    { ...base, answer: 4 },
    { ...base, sourceSlides: [14] },
    { ...base, sourceSlides: [] },
    { ...base, tags: [''] },
    { ...base, prompt: '  ' },
    { ...base, category: 7 },
    { ...base, explanation: undefined },
    null,
    [],
  ];
  for (const mutated of mutations) {
    const result = plain(api.validateBanks({ ...sourceBanks, easy: [mutated, ...easyBank.slice(1)] }));
    assert.equal(result.valid, false);
    assert.deepEqual(result.errors, validateQuestion(mutated, 'easy', 1).map(error => `easy question 1: ${error}`));
  }
  const short = plain(api.validateBanks({ ...sourceBanks, medium: mediumBank.slice(0, 24) }));
  assert.equal(short.valid, false);
  assert.ok(short.errors.some(error => /medium/.test(error) && /25/.test(error)), short.errors.join('; '));
  const missing = plain(api.validateBanks({ easy: easyBank, medium: mediumBank }));
  assert.equal(missing.valid, false);
  assert.ok(missing.errors.some(error => /hard/.test(error)), missing.errors.join('; '));
});

await test('Malformed or missing startup data shows the unavailable state and blocks every quiz start', () => {
  const brokenAnswer = plain(hardBank);
  brokenAnswer[3].answer = 4;
  const variants = {
    'unparseable Easy JSON': replaceBank(builtHtml, 'easy', '{not json'),
    'Medium bank with 24 items': replaceBank(builtHtml, 'medium', JSON.stringify(mediumBank.slice(0, 24))),
    'Hard answer index out of range': replaceBank(builtHtml, 'hard', JSON.stringify(brokenAnswer)),
    'missing Easy bank element': builtHtml.replace(/<script type="application\/json" id="questions-easy">[\s\S]*?<\/script>/, ''),
  };
  for (const [name, html] of Object.entries(variants)) {
    const app = loadApp(html);
    const state = plain(app.api.getState());
    assert.equal(state.available, false, name);
    assert.ok(state.errors.length > 0, `${name}: errors must be recorded`);
    assert.ok(isShown(byId(app, 'view-unavailable')), `${name}: unavailable view must show`);
    assert.match(byId(app, 'view-unavailable').textContent, /unavailable/i);
    assert.equal(isShown(byId(app, 'view-landing')), false, `${name}: landing must hide`);
    assert.equal(app.document.activeElement?.id, 'unavailable-heading', `${name}: focus must move to the unavailable heading`);
    assert.equal(byId(app, 'study-confirm').disabled, true, name);
    app.api.setStudyConfirmed(true);
    byId(app, 'study-confirm').click();
    for (const button of modeButtons(app)) assert.equal(button.disabled, true, `${name}: ${button.id}`);
    for (const mode of MODES) assert.equal(app.api.startQuiz(mode), false, `${name}: ${mode}`);
    assert.equal(isShown(byId(app, 'view-quiz')), false, name);
    assert.equal(plain(app.api.getState()).attempt, null, name);
  }
  assert.equal(isShown(byId(loadApp(), 'view-unavailable')), false, 'valid data must not show the unavailable state');
});

await test('Mastery bands use the documented 90/75/60 thresholds', () => {
  const { api } = loadApp();
  const cases = [[100, 'Mastery'], [90, 'Mastery'], [89, 'Proficient'], [75, 'Proficient'], [74, 'Developing'], [60, 'Developing'], [59, 'Needs review'], [0, 'Needs review']];
  for (const [percentage, band] of cases) assert.equal(api.masteryBand(percentage).name, band, `${percentage}%`);
});

await test('All 25 checked answers produce scored results with topic analysis, full review and actions', () => {
  const app = loadApp();
  startConfirmed(app, 'easy');
  assert.equal(app.api.finishQuiz(), false, 'results are unavailable before every item is checked');
  assert.equal(isShown(byId(app, 'view-results')), false);
  const wrongIndexes = new Set([0, 5, 10, 15, 20]);
  completeAttempt(app, index => !wrongIndexes.has(index));
  const attempt = attemptOf(app);
  assert.ok(isShown(byId(app, 'btn-finish')));
  byId(app, 'btn-finish').click();

  assert.ok(isShown(byId(app, 'view-results')));
  assert.equal(isShown(byId(app, 'view-quiz')), false);
  assert.equal(app.document.activeElement?.id, 'results-heading');
  const summary = byId(app, 'results-summary').textContent;
  assert.match(summary, /20 of 25/);
  assert.match(summary, /80%/);
  assert.match(summary, /Proficient/);

  const expected = new Map();
  attempt.questions.forEach((item, index) => {
    const entry = expected.get(item.category) ?? { correct: 0, total: 0 };
    entry.total++;
    if (!wrongIndexes.has(index)) entry.correct++;
    expected.set(item.category, entry);
  });
  const rows = findAll(byId(app, 'results-categories-body'), node => node.localName === 'tr');
  assert.equal(rows.length, expected.size);
  for (const row of rows) {
    const [category, count, status] = row.children.map(cell => cell.textContent.trim());
    const entry = expected.get(category);
    assert.ok(entry, `unexpected category row ${category}`);
    assert.ok(count.startsWith(`${entry.correct} of ${entry.total}`), `${category}: ${count}`);
    assert.equal(status, entry.correct / entry.total >= 0.75 ? 'Strength' : 'Gap');
  }
  const strengths = findAll(byId(app, 'results-strengths'), node => node.localName === 'li').map(node => node.textContent);
  const gaps = findAll(byId(app, 'results-gaps'), node => node.localName === 'li').map(node => node.textContent);
  for (const [category, entry] of expected) {
    const list = entry.correct / entry.total >= 0.75 ? strengths : gaps;
    assert.equal(list.filter(text => text.includes(category)).length, 1, `${category} must be listed once in the right list`);
  }

  const reviewItems = byId(app, 'results-review').children;
  assert.equal(reviewItems.length, 25);
  reviewItems.forEach((item, index) => {
    const question = attempt.questions[index];
    const selected = attempt.responses[index].selected;
    const text = item.textContent;
    assert.ok(text.includes(question.prompt), `review ${index + 1} prompt`);
    assert.ok(text.includes(`Your answer: ${LETTERS[selected]}. ${question.options[selected]}`), `review ${index + 1} answer`);
    assert.ok(text.includes(`Correct answer: ${LETTERS[question.answer]}. ${question.options[question.answer]}`), `review ${index + 1} key`);
    assert.ok(text.includes(question.explanation), `review ${index + 1} explanation`);
    assert.match(text, wrongIndexes.has(index) ? /Incorrect/ : /Correct/);
  });

  byId(app, 'btn-print').click();
  assert.equal(app.printCalls.length, 1, 'print/save calls window.print');
  byId(app, 'btn-choose').click();
  assert.ok(isShown(byId(app, 'view-landing')));
  assert.equal(isShown(byId(app, 'view-results')), false);
  assert.equal(plain(app.api.getState()).attempt, null);
  assert.equal(app.document.activeElement?.id, 'difficulty-heading');
  for (const button of modeButtons(app)) assert.equal(button.disabled, false, 'confirmation carries over to difficulty choice');
  byId(app, 'mode-hard').click();
  assert.equal(attemptOf(app).mode, 'hard');
});

await test('App keeps answers in memory only and loads no external resources', () => {
  const document = parseHtml(builtHtml);
  const code = appScripts(document).map(script => script.textContent).join('\n');
  assert.ok(code.length > 0, 'index.html must contain the app script');
  assert.doesNotMatch(code, /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB|document\.cookie|serviceWorker|\bimport\s*\(/);
  assert.doesNotMatch(builtHtml, /<link\b|<img\b|<iframe\b|\bsrc\s*=|@import|url\(\s*['"]?(?:https?:)?\/\//i);
});

await test('App script avoids replaceChildren so older Safari (before 14) still renders questions', () => {
  const code = appScripts(parseHtml(builtHtml)).map(script => script.textContent).join('\n');
  assert.ok(!/\breplaceChildren\b/.test(code), 'app script must not call replaceChildren');
});

// ---------------------------------------------------------------------------
// Visual system contracts (Task 6)
//
// A small CSS parser reads the single inline stylesheet of the built page so the
// tests can assert on real rules: theme classes, focus styles, the mobile
// breakpoint and full reduced-motion coverage of every animated selector.
// ---------------------------------------------------------------------------

function stylesheetText(html = builtHtml) {
  const styles = findAll(parseHtml(html).root, node => node.localName === 'style');
  assert.equal(styles.length, 1, 'index.html must have exactly one inline <style> element');
  return styles[0].textContent.replace(/\/\*[\s\S]*?\*\//g, '');
}

// Returns flat rules: { selectors: string[], declarations: Map, media: string|null } and keyframe names.
function parseCss(css) {
  const rules = [];
  const keyframes = new Set();
  const matchingBrace = (text, open) => {
    let depth = 0;
    for (let index = open; index < text.length; index++) {
      if (text[index] === '{') depth++;
      else if (text[index] === '}' && --depth === 0) return index;
    }
    throw new Error('Unbalanced braces in stylesheet');
  };
  const parseDeclarations = body => {
    const declarations = new Map();
    for (const part of body.split(';')) {
      const colon = part.indexOf(':');
      if (colon === -1) continue;
      declarations.set(part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim().replace(/\s+/g, ' '));
    }
    return declarations;
  };
  const walk = (text, media) => {
    let cursor = 0;
    while (cursor < text.length) {
      const open = text.indexOf('{', cursor);
      if (open === -1) break;
      const prelude = text.slice(cursor, open).trim();
      const close = matchingBrace(text, open);
      const body = text.slice(open + 1, close);
      if (/^@media\b/i.test(prelude)) {
        walk(body, prelude.replace(/\s+/g, ' '));
      } else if (/^@(-webkit-)?keyframes\b/i.test(prelude)) {
        keyframes.add(prelude.split(/\s+/)[1]);
      } else if (!prelude.startsWith('@')) {
        rules.push({ selectors: prelude.split(',').map(selector => selector.trim().replace(/\s+/g, ' ')), declarations: parseDeclarations(body), media });
      }
      cursor = close + 1;
    }
  };
  walk(css, null);
  return { rules, keyframes };
}

const REDUCED_MOTION_MEDIA = /prefers-reduced-motion:\s*reduce/i;
const hasMotion = value => value !== undefined && !/^none\b/i.test(value.replace(/\s*!important$/, ''));

await test('Hero artwork is an aria-hidden inline SVG with the howitzer, barrel, muzzle-flash, projectile, smoke and target-grid groups', () => {
  const document = parseHtml(builtHtml);
  const svgs = findAll(document.root, node => node.localName === 'svg');
  assert.ok(svgs.length > 0, 'index.html must contain inline SVG artwork');
  for (const svg of svgs) {
    assert.equal(svg.getAttribute('aria-hidden'), 'true', 'decorative SVG must be aria-hidden');
    assert.equal(svg.getAttribute('focusable'), 'false', 'decorative SVG must not take focus');
    assert.ok(svg.getAttribute('viewbox'), 'SVG must scale through a viewBox');
  }
  const groups = {};
  for (const id of ['howitzer', 'barrel', 'muzzle-flash', 'projectile', 'smoke', 'target-grid']) {
    const node = document.getElementById(id);
    assert.ok(node, `SVG group #${id} is required`);
    assert.equal(node.localName, 'g', `#${id} must be an SVG <g> group`);
    assert.ok(svgs.some(svg => findAll(svg, child => child === node).length), `#${id} must sit inside an aria-hidden SVG`);
    groups[id] = node;
  }
  for (const id of ['barrel', 'muzzle-flash']) {
    assert.ok(findAll(groups.howitzer, node => node === groups[id]).length, `#${id} must be part of #howitzer`);
  }
  const hero = document.getElementById('hero-art');
  assert.ok(hero, 'the landing hero must contain the fire-mission art');
  assert.match(hero.textContent, /FIRE MISSION/, 'decorative fire-mission labels belong inside the aria-hidden art');
  assert.ok(findAll(hero, node => node.localName === 'path' && /\btrajectory\b/.test(node.getAttribute('class') ?? '')).length, 'a static projectile arc must be drawn');
  assert.ok(findAll(hero, node => /\brange-rings\b/.test(node.getAttribute('class') ?? '')).length, 'range rings must be drawn');
});

await test('Easy, Medium and Hard theme classes are styled and follow the active attempt', () => {
  const { rules } = parseCss(stylesheetText());
  for (const mode of MODES) {
    assert.ok(rules.some(rule => rule.selectors.some(selector => selector.includes(`.theme-${mode}`))), `CSS must style .theme-${mode}`);
  }
  const themeClasses = app => MODES.filter(mode => app.document.body.classList.contains(`theme-${mode}`));
  for (const mode of MODES) {
    const app = loadApp();
    assert.ok(app.document.body, 'the page must have a <body>');
    assert.deepEqual(themeClasses(app), [], 'no theme before a mode starts');
    assert.equal(app.document.body.getAttribute('data-view'), 'landing');
    startConfirmed(app, mode);
    assert.deepEqual(themeClasses(app), [mode], `${mode} applies only theme-${mode}`);
    assert.equal(app.document.body.getAttribute('data-view'), 'quiz');
    assert.match(byId(app, 'quiz-heading').textContent, new RegExp(mode, 'i'), 'the difficulty is named in text, not by colour alone');
    completeAttempt(app);
    byId(app, 'btn-finish').click();
    assert.deepEqual(themeClasses(app), [mode], 'results keep the attempt theme');
    assert.equal(app.document.body.getAttribute('data-view'), 'results');
    byId(app, 'btn-retake').click();
    assert.deepEqual(themeClasses(app), [mode], 'retake keeps the same theme');
    completeAttempt(app);
    byId(app, 'btn-finish').click();
    byId(app, 'btn-choose').click();
    assert.deepEqual(themeClasses(app), [], 'choosing another difficulty clears the theme');
    assert.equal(app.document.body.getAttribute('data-view'), 'landing');
    const next = MODES[(MODES.indexOf(mode) + 1) % 3];
    byId(app, `mode-${next}`).click();
    assert.deepEqual(themeClasses(app), [next], 'switching difficulty swaps the theme');
  }
  const broken = loadApp(replaceBank(builtHtml, 'easy', '{not json'));
  assert.deepEqual(themeClasses(broken), []);
  assert.equal(broken.document.body.getAttribute('data-view'), 'unavailable');
});

await test('Focus stays visible: a :focus-visible outline exists and no rule removes outlines', () => {
  const { rules } = parseCss(stylesheetText());
  const focusRules = rules.filter(rule => !rule.media && rule.selectors.some(selector => selector.includes(':focus-visible')));
  assert.ok(focusRules.length, 'a :focus-visible rule is required');
  assert.ok(focusRules.some(rule => {
    const outline = rule.declarations.get('outline') ?? '';
    const width = Number((outline.match(/(\d+(?:\.\d+)?)px/) ?? [])[1] ?? 0);
    return width >= 2 && /solid/.test(outline);
  }), 'focus outline must be solid and at least 2px wide');
  for (const rule of rules) {
    const outline = rule.declarations.get('outline');
    assert.ok(outline === undefined || !/^(none|0)\b/.test(outline), `outline removed by ${rule.selectors.join(', ')}`);
  }
});

await test('Hover accents do not replace correct and incorrect feedback styling', () => {
  const { rules } = parseCss(stylesheetText());
  const hover = rules.flatMap(rule => rule.selectors
    .filter(selector => selector.includes('.option:hover') && rule.declarations.has('border-color')));
  assert.ok(hover.length, 'options need a hover accent');
  for (const selector of hover) {
    assert.match(selector, /:not\(\.option-correct\)/, 'hover must preserve correct answer border');
    assert.match(selector, /:not\(\.option-incorrect\)/, 'hover must preserve incorrect answer border');
  }
});

await test('Narrow screens up to 760px stack the hero and controls with 44px targets and wrapping text', () => {
  const { rules } = parseCss(stylesheetText());
  const mobile = rules.filter(rule => rule.media && /max-width:\s*760px/.test(rule.media));
  assert.ok(mobile.length, 'a @media (max-width: 760px) block is required');
  const stacks = selectorPattern => mobile.some(rule => rule.selectors.some(selector => selectorPattern.test(selector))
    && (/^1fr$/.test(rule.declarations.get('grid-template-columns') ?? '') || rule.declarations.get('flex-direction') === 'column'));
  assert.ok(stacks(/\.hero-inner\b/), 'the hero must stack into one column');
  assert.ok(stacks(/\.quiz-actions\b/) && stacks(/\.results-actions\b/), 'action buttons must stack');
  const base = selector => rules.find(rule => !rule.media && rule.selectors.includes(selector));
  for (const selector of ['button', '.option', '.study-confirm']) {
    assert.equal(base(selector)?.declarations.get('min-height'), '44px', `${selector} keeps a 44px minimum target`);
  }
  assert.equal(base('body')?.declarations.get('overflow-wrap'), 'anywhere', 'long answers must wrap');
  const art = rules.find(rule => !rule.media && rule.selectors.includes('.hero-art svg'));
  assert.ok(art && art.declarations.get('max-width') === '100%', 'hero SVG must never exceed its column');
  const terrain = rules.find(rule => !rule.media && rule.selectors.includes('.terrain'));
  assert.ok(terrain && terrain.declarations.get('position') === 'fixed' && terrain.declarations.get('overflow') === 'hidden' && terrain.declarations.get('pointer-events') === 'none', 'the decorative map layer must not affect layout width or input');
});

await test('prefers-reduced-motion: reduce sets animation and transition to none on every motion-bearing element', () => {
  const { rules, keyframes } = parseCss(stylesheetText());
  const reduced = rules.filter(rule => rule.media && REDUCED_MOTION_MEDIA.test(rule.media));
  assert.ok(reduced.length, 'a @media (prefers-reduced-motion: reduce) block is required');
  const stilled = new Set(reduced
    .filter(rule => /^none\b/.test(rule.declarations.get('animation') ?? '') && /^none\b/.test(rule.declarations.get('transition') ?? ''))
    .flatMap(rule => rule.selectors));
  for (const selector of ['#barrel', '#muzzle-flash', '#projectile', '#smoke .smoke-puff', '#target-grid .target-pulse', '.view']) {
    assert.ok(stilled.has(selector), `reduced motion must set animation: none and transition: none on ${selector}`);
  }
  const moving = rules.filter(rule => !(rule.media && REDUCED_MOTION_MEDIA.test(rule.media))
    && (hasMotion(rule.declarations.get('animation')) || hasMotion(rule.declarations.get('animation-name')) || hasMotion(rule.declarations.get('transition'))));
  assert.ok(moving.length >= 6, 'the artwork must actually be animated');
  for (const rule of moving) {
    for (const selector of rule.selectors) assert.ok(stilled.has(selector), `animated selector ${selector} is not stopped under reduced motion`);
    const name = (rule.declarations.get('animation') ?? rule.declarations.get('animation-name') ?? '').split(/\s+/).find(token => keyframes.has(token));
    if (hasMotion(rule.declarations.get('animation')) || rule.declarations.has('animation-name')) assert.ok(name, `${rule.selectors.join(', ')} uses an undefined @keyframes`);
  }
  for (const rule of reduced) {
    for (const selector of rule.selectors) {
      if (/#howitzer|#target-grid$|\.range-rings|\.trajectory|\.hero-art/.test(selector)) {
        assert.notEqual(rule.declarations.get('display'), 'none', `static artwork ${selector} must stay visible`);
        assert.notEqual(rule.declarations.get('visibility'), 'hidden', `static artwork ${selector} must stay visible`);
      }
    }
  }
});

await test('Visual system uses no external asset URLs, fonts or data URIs', () => {
  assert.doesNotMatch(builtHtml, /https?:\/\//i, 'no absolute URLs (inline SVG needs no xmlns)');
  assert.doesNotMatch(builtHtml, /@font-face|data:[a-z]+\//i);
  const css = stylesheetText();
  for (const [, target] of css.matchAll(/url\(\s*['"]?([^'")]*)/gi)) {
    assert.ok(target.startsWith('#'), `stylesheet url(${target}) must reference an inline fragment`);
  }
  for (const [, target] of builtHtml.matchAll(/\bhref\s*=\s*"([^"]*)"/gi)) {
    assert.ok(target.startsWith('#'), `href ${target} must be an in-page fragment`);
  }
  const { rules } = parseCss(css);
  const bodyFont = rules.find(rule => !rule.media && rule.selectors.includes('body'))?.declarations.get('font-family') ?? '';
  assert.match(bodyFont, /system-ui/, 'body uses a system font stack');
});

if (failures > 0) {
  console.error(`${failures} verification test(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`All ${tests} verification tests passed`);
}
