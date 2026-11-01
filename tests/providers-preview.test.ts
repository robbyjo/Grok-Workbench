import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { History } from '../electron/history';
import { Providers, providerModel } from '../electron/providers';
import { previewBytes, previewFile } from '../electron/document-preview';
import { zipSync, strToU8 } from 'fflate';
import { setLanguage, t } from '../shared/i18n';
import { translatedLabels } from '../shared/translations';
import { validateAppearance } from '../shared/appearance';
test('provider previews preserve configuration and isolate keys, endpoints and stale writes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wb-provider-')),
    home = join(root, 'grok');
  mkdirSync(home);
  const config = '# retained comment\n[features]\nexample=true\n';
  writeFileSync(join(home, 'config.toml'), config);
  const history = new History(join(root, 'history.sqlite'), 64);
  const crypto = {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s).reverse(),
    decryptString: (s: Buffer) => Buffer.from(s).reverse().toString(),
  };
  const providers = new Providers(join(root, 'keys'), history, () => home, crypto);
  const input = {
    name: 'Local',
    model: 'fixture',
    baseUrl: 'http://127.0.0.1:1234/v1',
    backend: 'chat_completions',
    contextWindow: 32000,
  };
  try {
    await assert.rejects(
      providers.preview({ ...input, baseUrl: 'http://remote.invalid/v1' }),
      /HTTPS/,
    );
    const messages = await providers.preview({
      ...input,
      baseUrl: 'https://api.anthropic.com/v1',
      backend: 'messages',
    });
    assert.match(messages.source, /anthropic-version/);
    const review = await providers.preview(input);
    assert.ok(review.source.startsWith(config.trimEnd()));
    assert.ok(!review.source.includes('test-secret'));
    writeFileSync(join(home, 'config.toml'), config + '# another writer\n');
    await assert.rejects(
      providers.save({ token: review.token, confirmed: true, key: 'test-secret', remember: true }),
      /changed/,
    );
    const current = await providers.preview(input);
    await providers.save({
      token: current.token,
      confirmed: true,
      key: 'test-secret',
      remember: true,
    });
    const row = providers.list()[0];
    assert.ok(!JSON.stringify(row).includes('test-secret'));
    assert.ok(!readFileSync(join(home, 'config.toml'), 'utf8').includes('test-secret'));
    const variable = 'GROK_WORKBENCH_PROVIDER_KEY_' + row.id.replaceAll('-', '').toUpperCase();
    const env = providers.environment(
      { XAI_API_KEY: 'unrelated', GROK_CONFIG: '{"features":{"example":false}}' },
      row.id,
    );
    assert.equal(env[variable], 'test-secret');
    assert.equal(JSON.parse(env.GROK_CONFIG!).models.default, providerModel(row.id));
    assert.equal(JSON.parse(env.GROK_CONFIG!).features.example, false);
    const reopened = new Providers(join(root, 'keys'), history, () => home, crypto);
    assert.equal(reopened.environment({}, row.id)[variable], 'test-secret');
    const sessionOnly = await providers.preview({ ...row, revision: providers.list()[0].revision });
    await providers.save({ token: sessionOnly.token, confirmed: true, key: '', remember: false });
    assert.equal(providers.list()[0].remembered, false);
    const rememberAgain = await providers.preview(providers.list()[0]);
    await providers.save({ token: rememberAgain.token, confirmed: true, key: '', remember: true });
    assert.equal(providers.list()[0].remembered, true);
    await providers.remove(row.id, providers.list()[0].revision);
    assert.equal(providers.list().length, 0);
    assert.match(readFileSync(join(home, 'config.toml'), 'utf8'), /another writer/);
  } finally {
    history.db.close();
  }
});
test('Office previews extract inert content and reject oversized archives and private file paths', async () => {
  const docx = zipSync({
    'word/document.xml': strToU8(
      '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>First &lt;script&gt;</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p></w:body></w:document>',
    ),
  });
  const result = await previewBytes(Buffer.from(docx), 'sample.docx');
  assert.equal(result.kind, 'office');
  assert.equal(result.sections[0].paragraphs.length, 2);
  assert.match(result.sections[0].paragraphs[0], /script/);
  const xlsx = zipSync({
    'xl/workbook.xml': strToU8(
      '<workbook><sheets><sheet name="Data" r:id="rId1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    'xl/sharedStrings.xml': strToU8('<sst><si><t>Heading</t></si></sst>'),
    'xl/worksheets/sheet1.xml': strToU8(
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><f>1+2</f><v>3</v></c></row></sheetData></worksheet>',
    ),
  });
  const sheet = await previewBytes(Buffer.from(xlsx), 'sample.xlsx');
  assert.deepEqual(sheet.sections[0].rows[0], ['Heading', '', '3']);
  const pptx = zipSync({
    'ppt/slides/slide1.xml': strToU8(
      '<p:sld><a:p><a:r><a:t>Slide content</a:t></a:r></a:p></p:sld>',
    ),
  });
  assert.deepEqual((await previewBytes(Buffer.from(pptx), 'sample.pptx')).sections[0].paragraphs, [
    'Slide content',
  ]);
  const bomb = zipSync({ 'word/document.xml': new Uint8Array(4 * 1024 * 1024 + 1) });
  await assert.rejects(previewBytes(Buffer.from(bomb), 'oversized.docx'), /Expanded/);
  const entity = zipSync({
    'word/document.xml': strToU8('<!DOCTYPE x [<!ENTITY x "boom">]><document/>'),
  });
  await assert.rejects(previewBytes(Buffer.from(entity), 'entity.docx'), /Unsupported/);
  const root = mkdtempSync(join(tmpdir(), 'wb-preview-'));
  writeFileSync(join(root, '.env'), 'PRIVATE');
  await assert.rejects(previewFile(root, '.env'), /Private/);
  await assert.rejects(previewFile(root, '../outside.pdf'));
});
test('localized controls cover every offered language and personalization rejects arbitrary CSS', () => {
  for (const language of ['es', 'fr', 'de', 'id', 'ja'] as const) {
    setLanguage(language);
    assert.notEqual(t('Scheduled automations'), 'Scheduled automations');
    for (const key of translatedLabels) assert.ok(t(key).length > 0);
  }
  setLanguage('en');
  assert.equal(t('Remote access'), 'Remote access');
  assert.throws(() =>
    validateAppearance({ theme: 'dark', uiScale: 100, logFontSize: 12, accent: 'url(evil)' }),
  );
  assert.equal(
    validateAppearance({
      theme: 'dark',
      uiScale: 100,
      logFontSize: 12,
      accent: 'blue',
      followSystem: true,
      font: 'arial',
    }).accent,
    'blue',
  );
});
test('a partial provider update blocks native admission across restart until a reviewed repair', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wb-provider-recovery-')),
    home = join(root, 'grok');
  mkdirSync(home);
  const history = new History(join(root, 'history.sqlite'), 64);
  const crypto = {
    isEncryptionAvailable: () => true,
    encryptString: (_s: string): Buffer => {
      throw new Error('fixture encryption failure');
    },
    decryptString: (_s: Buffer) => '',
  };
  const providers = new Providers(join(root, 'keys'), history, () => home, crypto);
  const input = {
    name: 'Fixture',
    model: 'fixture',
    baseUrl: 'https://provider.example/v1',
    backend: 'chat_completions',
    contextWindow: 32000,
  };
  try {
    const review = await providers.preview(input);
    await assert.rejects(
      providers.save({ token: review.token, confirmed: true, key: 'fixture-only', remember: true }),
      /encryption/,
    );
    assert.throws(() => providers.environment({ XAI_API_KEY: 'unrelated' }), /did not finish/);
    const restarted = new Providers(join(root, 'keys'), history, () => home, crypto),
      pending = restarted.list()[0];
    assert.equal(pending.needsRecovery, true);
    assert.throws(() => restarted.environment({}), /did not finish/);
    const repair = await restarted.preview({
      ...input,
      id: pending.id,
      revision: pending.revision,
    });
    await restarted.save({
      token: repair.token,
      confirmed: true,
      key: 'fixture-only',
      remember: false,
    });
    assert.equal(restarted.list()[0].needsRecovery, false);
    assert.doesNotThrow(() => restarted.environment({}));
  } finally {
    history.db.close();
  }
});
