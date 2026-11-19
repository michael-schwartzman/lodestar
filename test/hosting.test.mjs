// Contract lock for hosting on Microsoft Fabric with Rayfin. `rayfin up` publishes dist/ as a Fabric App, configured
// by rayfin/rayfin.yml. No browser is needed for these tests.
//
// The first case records a decision. As it is configured the game is open to anyone with the link, so that it
// opens on a phone without a sign-in. Everything in it was made for this repository, so there is nobody else's
// work to protect. Changing the value is a decision for whoever hosts it, and this test is where it gets made
// (`protected` puts the game behind Fabric sign-in).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(ROOT + path, 'utf8');
const config = () => parse(read('rayfin/rayfin.yml'));
const scripts = () => JSON.parse(read('package.json')).scripts;

describe('hosting on Microsoft Fabric (rayfin/rayfin.yml)', () => {
  it('serves the game to anyone with the link', () => {
    const hosting = config().services.staticHosting;
    assert.equal(hosting.enabled, true, 'static hosting is what publishes the game');
    assert.equal(
      hosting.assetAccess,
      'public',
      'assetAccess must be the literal "public"; "protected" would put the game behind Fabric sign-in',
    );
  });

  it('publishes exactly the build that the test suite checks', () => {
    const hosting = config().services.staticHosting;
    assert.equal(hosting.buildCommand, 'npm run build', '`npm test` builds with `npm run build` and tests dist/');
    assert.equal(scripts().build, 'vite build');
    assert.equal(hosting.folder, 'dist', 'where `vite build` writes');
    assert.equal(hosting.indexDocument, 'index.html');
    assert.equal(hosting.path, undefined, 'the frontend is the project root');
    assert.notEqual(hosting.embedded?.only, true, 'the game needs its own page (pointer lock), not a portal frame');
  });

  it('provisions one thing besides the pages: a database for the scoreboard, which anybody may read and add to and nobody may alter', () => {
    // Decision of 18 November 2026 — the owner: "also add a score board feature and save it to a shared database
    // …". Until then this case read "provisions no backend, because the game has none" and held
    // `data.enabled` to false. The game is played without signing in, so the one table is open to whoever plays:
    // to read, and to add a row — and to nothing else. That is what is held here.
    const services = config().services;
    assert.equal(services.data.enabled, true, 'the scoreboard’s database');
    assert.equal(services.data.dialect, 'mssql', 'Rayfin refuses a database with no dialect named');
    assert.notEqual(services.data.allowIntrospection, true, 'the schema is not handed to whoever asks');
    assert.notEqual(services.functions?.enabled, true, 'no functions');
    assert.notEqual(services.storage?.enabled, true, 'no blob storage');
    assert.equal(config().connectors, undefined, 'no connectors');
    // one table, and what a stranger may do with it
    assert.match(read('rayfin/data/schema.ts'), /export const schema = \[Score\];/, 'one table: Score');
    const table = read('rayfin/data/Score.ts');
    const roles = table.match(/@(anonymous|authenticated|role)\([^)]*\)/g) || [];
    assert.deepEqual(roles, ["@anonymous(['read', 'create'])"], 'read and add, for anybody; nothing else, for anybody');
    assert.doesNotMatch(table, /'update'|'delete'|'\*'/, 'nobody may change or remove a row from outside');
    // …and how much a row may hold: a short name, and numbers with a roof over them
    assert.match(table, /@text\(\{ min: 2, max: 16 \}\) name!: string;/);
    assert.match(table, /@int\(\{ min: 0, max: 999999 \}\) score!: number;/);
    for (const [, max] of table.matchAll(/@text\(\{[^}]*max: (\d+)[^}]*\}\)/g))
      assert.ok(+max <= 16, `a text column of ${max} letters`);
    assert.doesNotMatch(table, /@text\(\s*\)/, 'no text column without a length');
  });

  it('loads nothing from anywhere else: the page is the whole game', () => {
    const page = read('index.html');
    assert.doesNotMatch(page, /https?:\/\//, 'index.html must not reference another host');
    for (const file of ['src/ui/ui.css', 'src/ui/hud.css', 'src/ui/menus.css'])
      assert.doesNotMatch(
        read(file),
        /url\(\s*['"]?https?:|@import\s+url|@font-face/,
        `${file} must not fetch fonts or images`,
      );
  });

  it('keeps the local deployment state out of git', (t) => {
    // rayfin up writes these; they hold workspace and item ids, the hosting URL and a publishable key.
    const paths = ['rayfin/.env', 'rayfin/.deployments.json', 'rayfin/.temp/x', '.env.local', '.env.fabric-dev'];
    let ignored;
    try {
      ignored = execFileSync('git', ['check-ignore', ...paths], { cwd: ROOT, encoding: 'utf8' })
        .trim()
        .split('\n');
    } catch (err) {
      if (err.status === 1)
        ignored = String(err.stdout || '')
          .trim()
          .split('\n')
          .filter(Boolean);
      else return t.skip('not a git checkout, so git cannot be asked what it ignores');
    }
    assert.deepEqual(ignored, paths);
  });

  it('runs one exact version of the Rayfin CLI', () => {
    assert.match(scripts().rayfin, /^npx -y @microsoft\/rayfin-cli@\d+\.\d+\.\d+$/, 'an exact version, not a range');
    assert.equal(scripts()['fabric:deploy'], 'npm run rayfin -- up');
    assert.equal(scripts()['fabric:status'], 'npm run rayfin -- up status');
  });
});
