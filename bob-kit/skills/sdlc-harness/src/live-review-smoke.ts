#!/usr/bin/env node

/**
 * Opt-in live smoke test for the complete review-to-GitLab path.
 * Creates two temporary issues, exercises AC, ambiguity, transition, link,
 * and telemetry writes, then closes the temporary issues in a finally block.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyFinding } from './skill/review';
import { readTelemetry } from './skill/telemetry';
import type { DependencyFinding } from './models';

interface LiveIssue {
  iid: number;
  description: string | null;
  labels: string[];
  state: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function main(): Promise<void> {
  const host = required('GITLAB_HOST').replace(/\/$/, '');
  const projectName = required('GITLAB_PROJECT');
  const token = required('GITLAB_TOKEN');
  const base = `${host}/api/v4/projects/${encodeURIComponent(projectName)}`;
  const headers = { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' };
  const created: number[] = [];
  const telemetryPath = path.join(os.tmpdir(), `sdlc-harness-live-${Date.now()}.jsonl`);
  process.env['SDLC_TELEMETRY_PATH'] = telemetryPath;

  const request = async <T>(endpoint: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${base}${endpoint}`, { ...init, headers });
    if (!response.ok) throw new Error(`GitLab HTTP ${response.status} for ${endpoint}`);
    return response.json() as Promise<T>;
  };

  const createIssue = async (title: string, description: string): Promise<LiveIssue> => {
    const issue = await request<LiveIssue>('/issues', {
      method: 'POST',
      body: JSON.stringify({ title, description, labels: 'Open' }),
    });
    created.push(issue.iid);
    return issue;
  };

  try {
    const stamp = Date.now();
    const first = await createIssue(`[E2E ${stamp}] Settings save`, 'The settings save handler is incomplete.');
    const second = await createIssue(`[E2E ${stamp}] Preferences API`, 'fix it');

    const acResult = await applyFinding({
      agent: 'AC', issueIid: first.iid, action: 'draft_ac',
      suggestedValue: '**Given** a changed preference\n**When** the page reloads\n**Then** the saved value remains selected',
    }, { editedValue: null });
    if (!acResult.gitlabWriteCalled) {
      throw new Error(`AC write did not reach GitLab: ${acResult.error ?? 'unknown error'}`);
    }

    // Apply the ambiguity rewrite to the SAME issue after AC. This proves the
    // common "apply both" review path preserves the criteria already written.
    const rewrite = 'The settings save handler returns HTTP 500 when the notification setting is saved.';
    const amResult = await applyFinding({
      agent: 'AM', issueIid: first.iid, action: 'rewrite_desc', suggestedValue: rewrite,
    }, { editedValue: null });
    if (!amResult.gitlabWriteCalled) {
      throw new Error(`Ambiguity rewrite did not reach GitLab: ${amResult.error ?? 'unknown error'}`);
    }

    const transitionResult = await applyFinding({
      agent: 'ST', issueIid: first.iid, action: 'state_transition', suggestedValue: 'In Review',
    }, { editedValue: null });
    if (!transitionResult.gitlabWriteCalled) {
      throw new Error(`State transition did not reach GitLab: ${transitionResult.error ?? 'unknown error'}`);
    }

    const dependency: DependencyFinding = {
      agent: 'DEP', sourceIid: first.iid, targetIid: second.iid,
      suggestedLinkType: 'relates-to', confidence: 1,
    };
    const linkResult = await applyFinding(dependency, { editedValue: null });
    if (!linkResult.gitlabWriteCalled) {
      throw new Error(`Dependency link did not reach GitLab: ${linkResult.error ?? 'unknown error'}`);
    }

    const firstAfter = await request<LiveIssue>(`/issues/${first.iid}`);
    const links = await request<Array<{ iid: number; link_type: string }>>(`/issues/${first.iid}/links`);
    const telemetry = await readTelemetry();

    if (!firstAfter.description?.includes('## Acceptance Criteria')) throw new Error('AC was not persisted');
    if (!firstAfter.description?.includes(rewrite)) throw new Error('Description rewrite was not persisted');
    if (!firstAfter.labels.includes('In Review')) throw new Error('State label was not persisted');
    if (!links.some((link) => link.iid === second.iid)) throw new Error('Dependency link was not persisted');
    if (telemetry.length !== 4 || telemetry.some((entry) => entry.outcome !== 'accepted')) {
      throw new Error('Telemetry did not record all four accepted writes');
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
