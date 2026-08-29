// bob-kit/mcp-server/src/tools/work-item-format.test.ts
//
// Plain node:assert test — this package has no Jest/Vitest (see merge-bob-config.test.mjs
// for the established pattern). Compiled by `npm run build` alongside the tool it tests,
// then run directly: `node dist/tools/work-item-format.test.js`.

import assert from 'node:assert/strict';
import { workItemFormatTool } from './work-item-format.js';
import type { ToolContext } from '../types.js';

// ToolContext (gitlab client, config) is not needed by this tool — it has no
// dependencies beyond the embedded template data — so an empty stand-in is safe here.
const ctx = {} as unknown as ToolContext;

const TYPES = ['Epic', 'Feature', 'User Story', 'Bug', 'Task'] as const;

interface TemplateResult {
  template: {
    type: string;
    titleRules: string[];
    descriptionStructure: string;
    acceptanceCriteriaFormat: string;
    example: { title: string; description: string };
  };
}

/**
 * Verify every work item type returns a well-formed template.
 * @returns Resolves once all types have been checked.
 */
async function testAllTypesReturnWellFormedTemplates(): Promise<void> {
  for (const type of TYPES) {
    const result = (await workItemFormatTool.execute(
      { action: 'get-template', type },
      ctx
    )) as TemplateResult;
    const { template } = result;

    assert.equal(template.type, type);
    assert.ok(Array.isArray(template.titleRules), `${type}: titleRules must be an array`);
    assert.ok(template.titleRules.length > 0, `${type}: titleRules must not be empty`);
    assert.equal(typeof template.descriptionStructure, 'string');
    assert.ok(template.descriptionStructure.length > 0, `${type}: descriptionStructure must not be empty`);
    assert.equal(typeof template.acceptanceCriteriaFormat, 'string');
    assert.equal(typeof template.example.title, 'string');
    assert.equal(typeof template.example.description, 'string');
  }
}

/**
 * User Story template must document the Connextra title convention.
 * @returns Resolves once the assertion has run.
 */
async function testUserStoryIncludesConnextraRule(): Promise<void> {
  const result = (await workItemFormatTool.execute(
    { action: 'get-template', type: 'User Story' },
    ctx
  )) as TemplateResult;
  const hasConnextra = result.template.titleRules.some((r) => /connextra/i.test(r));
  assert.ok(hasConnextra, 'User Story titleRules must mention Connextra format');
}

/**
 * Bug template description structure must include the Steps to Reproduce section.
 * @returns Resolves once the assertion has run.
 */
async function testBugIncludesStepsToReproduce(): Promise<void> {
  const result = (await workItemFormatTool.execute(
    { action: 'get-template', type: 'Bug' },
    ctx
  )) as TemplateResult;
  assert.ok(result.template.descriptionStructure.includes('## Steps to Reproduce'));
}

/**
 * User Story acceptance criteria format must document Given-When-Then.
 * @returns Resolves once the assertion has run.
 */
async function testUserStoryAcFormatIncludesGwt(): Promise<void> {
  const result = (await workItemFormatTool.execute(
    { action: 'get-template', type: 'User Story' },
    ctx
  )) as TemplateResult;
  assert.match(result.template.acceptanceCriteriaFormat, /given[\s\S]*when[\s\S]*then/i);
}

await testAllTypesReturnWellFormedTemplates();
await testUserStoryIncludesConnextraRule();
await testBugIncludesStepsToReproduce();
await testUserStoryAcFormatIncludesGwt();

console.log('work-item-format.test.ts: all assertions passed');
