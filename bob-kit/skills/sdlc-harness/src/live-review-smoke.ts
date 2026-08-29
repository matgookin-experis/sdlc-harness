#!/usr/bin/env node

/**
 * Opt-in live smoke test for the complete review-to-GitLab path.
 * Creates two temporary issues, exercises AC, ambiguity, transition, link,
 * and telemetry writes, then closes the temporary issues in a finally block.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isDirectTransition, resolveStateForConcept } from './agents/state-transition-agent';
import { applyFinding } from './skill/review';
import { createGitLabRequest } from './skill/gitlab-rest';
import { loadGitLabRuntimeConfig } from './skill/gitlab-runtime';
import { readTelemetry } from './skill/telemetry';
import type { DependencyFinding } from './models';

interface LiveIssue {
  iid: number;
  description: string | null;
  labels: string[];
  state: string;
  updated_at: string;
}

async function main(): Promise<void> {
  const runtime = loadGitLabRuntimeConfig();
  const config = runtime.projectConfig;
  const openState = resolveStateForConcept(config, 'open');
  const progressState = resolveStateForConcept(config, 'inProgress');
  const reviewState = resolveStateForConcept(config, 'inReview');
  if (!openState || !progressState || !reviewState) {
    throw new Error('Live smoke requires open, in-progress, and in-review workflow states.');
  }
  if (!isDirectTransition(openState, progressState, config) ||
      !isDirectTransition(progressState, reviewState, config)) {
    throw new Error('Live smoke requires direct open -> progress -> review transitions.');
  }

  const created: number[] = [];
  const telemetryPath = path.join(os.tmpdir(), `sdlc-harness-live-${Date.now()}.jsonl`);
  process.env['SDLC_TELEMETRY_PATH'] = telemetryPath;

  const request = createGitLabRequest(runtime, globalThis.fetch);

  const createIssue = async (title: string, description: string): Promise<LiveIssue> => {
    const issue = await request<LiveIssue>('/issues', {
      method: 'POST',
      body: JSON.stringify({ title, description, labels: openState }),
    });
    created.push(issue.iid);
    return issue;
  };

  try {
    const stamp = Date.now();
    const firstDescription = 'The settings save handler is incomplete.';
    const secondDescription = 'fix it';
    const first = await createIssue(`[E2E ${stamp}] Settings save`, firstDescription);
    const second = await createIssue(`[E2E ${stamp}] Preferences API`, secondDescription);

    const acResult = await applyFinding({
      agent: 'AC', issueIid: first.iid, action: 'draft_ac',
      suggestedValue: '**Given** a changed preference\n**When** the page reloads\n**Then** the saved value remains selected',
      originalDescription: firstDescription,
      originalUpdatedAt: first.updated_at,
    }, { editedValue: null });
    if (!acResult.gitlabWriteSucceeded) {
      throw new Error(`AC write did not reach GitLab: ${acResult.error ?? 'unknown error'}`);
    }

    // Apply the ambiguity rewrite to the SAME issue after AC. This proves the
    // preservation safety net without bypassing stale-write checks.
    const firstAfterAc = await request<LiveIssue>(`/issues/${first.iid}`);
    const rewrite = 'The settings save handler returns HTTP 500 when the notification setting is saved.';
    const amResult = await applyFinding({
      agent: 'AM', issueIid: first.iid, action: 'rewrite_desc', suggestedValue: rewrite,
      originalDescription: firstAfterAc.description,
      originalUpdatedAt: firstAfterAc.updated_at,
    }, { editedValue: null });
    if (!amResult.gitlabWriteSucceeded) {
      throw new Error(`Ambiguity rewrite did not reach GitLab: ${amResult.error ?? 'unknown error'}`);
    }

    const progressResult = await applyFinding({
      agent: 'ST', issueIid: first.iid, action: 'state_transition', suggestedValue: progressState,
    }, { editedValue: null });
    if (!progressResult.gitlabWriteSucceeded) {
      throw new Error(`Progress transition did not reach GitLab: ${progressResult.error ?? 'unknown error'}`);
    }

    const reviewResult = await applyFinding({
      agent: 'ST', issueIid: first.iid, action: 'state_transition', suggestedValue: reviewState,
    }, { editedValue: null });
    if (!reviewResult.gitlabWriteSucceeded) {
      throw new Error(`Review transition did not reach GitLab: ${reviewResult.error ?? 'unknown error'}`);
    }

    const dependency: DependencyFinding = {
      agent: 'DEP', sourceIid: first.iid, targetIid: second.iid,
      suggestedLinkType: 'relates-to', confidence: 1,
    };
    const linkResult = await applyFinding(dependency, { editedValue: null });
    if (!linkResult.gitlabWriteSucceeded) {
      throw new Error(`Dependency link did not reach GitLab: ${linkResult.error ?? 'unknown error'}`);
    }

    const firstAfter = await request<LiveIssue>(`/issues/${first.iid}`);
    const links = await request<Array<{ iid: number; link_type: string }>>(`/issues/${first.iid}/links`);
    const telemetry = await readTelemetry();

    if (!firstAfter.description?.includes('## Acceptance Criteria')) throw new Error('AC was not persisted');
    if (!firstAfter.description?.includes(rewrite)) throw new Error('Description rewrite was not persisted');
    if (!firstAfter.labels.includes(reviewState)) throw new Error('State label was not persisted');
    if (!links.some((link) => link.iid === second.iid)) throw new Error('Dependency link was not persisted');
    if (telemetry.length !== 5 || telemetry.some((entry) => entry.outcome !== 'accepted')) {
      throw new Error('Telemetry did not record all five accepted writes');
    }

    process.stdout.write(`Live review smoke passed for temporary issues #${first.iid} and #${second.iid}.\n`);
  } finally {
    for (const iid of created) {
      try {
        await request(`/issues/${iid}`, { method: 'PUT', body: JSON.stringify({ state_event: 'close' }) });
      } catch {
        process.stderr.write(`[sdlc-harness] Could not close temporary issue #${iid}.\n`);
      }
    }
    delete process.env['SDLC_TELEMETRY_PATH'];
    if (fs.existsSync(telemetryPath)) fs.unlinkSync(telemetryPath);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown live smoke error';
  process.stderr.write(`[sdlc-harness] ${message}\n`);
  process.exitCode = 1;
});
