import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const buildPath = join(projectRoot, 'scripts', 'build.mjs');
let failures = 0;

async function test(name, run) {
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

if (failures > 0) {
  console.error(`${failures} verification test(s) failed`);
  process.exitCode = 1;
} else {
  console.log('All 6 verification tests passed');
}
