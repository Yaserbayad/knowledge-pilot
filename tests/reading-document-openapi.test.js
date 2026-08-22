import test from 'node:test';
import assert from 'node:assert/strict';
import { gptOpenApi } from '../src/gpt-openapi.js';

test('ChatGPT Action schema explicitly accepts the bounded bilingual ReadingDocument v1 payload', () => {
  const spec = gptOpenApi('https://learn.example.com');
  const schemas = spec.components.schemas;
  const submission = schemas.TaskResultSubmission;
  const context = schemas.TaskContext;
  const reading = schemas.ReadingDocumentV1;

  assert.ok(reading, 'ReadingDocumentV1 schema must be declared');
  assert.equal(reading.type, 'object');
  assert.equal(reading.additionalProperties, false);
  assert.deepEqual(reading.required, ['version', 'hero', 'sections', 'ending']);
  assert.equal(reading.properties.version.const, 1);
  assert.deepEqual(reading.properties.defaultLanguage.enum, ['en', 'ar']);
  assert.ok(reading.properties.sections.items.$ref.endsWith('/ReadingSectionV1'));

  assert.deepEqual(submission.properties.readingDocument, { $ref: '#/components/schemas/ReadingDocumentV1' });
  assert.ok(context.properties.readingDocumentContract, 'task context must expose the runtime bilingual contract');
});
