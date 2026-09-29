import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

if (failures > 0) {
  console.error(`${failures} verification test(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`All ${tests} verification tests passed`);
}
