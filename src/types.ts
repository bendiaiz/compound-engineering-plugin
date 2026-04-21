/**
 * Core type definitions for the compound-engineering-plugin.
 * These types are shared across the plugin's modules and define
 * the data structures used for PR triage, marketplace integration,
 * and plugin configuration.
 */

/** Represents a GitHub Pull Request with relevant metadata */
export interface PullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  author: string;
  labels: string[];
  assignees: string[];
  reviewers: string[];
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  headBranch: string;
  baseBranch: string;
  url: string;
  additions: number;
  deletions: number;
  changedFiles: number;
}

/** Priority levels for triaging pull requests */
export type TriagePriority = 'critical' | 'high' | 'medium' | 'low' | 'none';

/** Result of a PR triage analysis */
export interface TriageResult {
  pr: PullRequest;
  priority: TriagePriority;
  reason: string;
  suggestedReviewers: string[];
  suggestedLabels: string[];
  estimatedReviewTime: number; // in minutes
  flags: TriageFlag[];
}

/** Flags that can be raised during triage */
export type TriageFlag =
  | 'large-diff'
  | 'long-lived'
  | 'no-description'
  | 'missing-tests'
  | 'breaking-change'
  | 'security-sensitive'
  | 'needs-design-review'
  | 'blocked';

/** Plugin configuration loaded from marketplace.json or local config */
export interface PluginConfig {
  name: string;
  version: string;
  description: string;
  repository: string;
  triageRules: TriageRule[];
  labelMapping: Record<string, TriagePriority>;
  reviewerGroups: Record<string, string[]>;
}

/** A rule used to determine triage priority and flags */
export interface TriageRule {
  id: string;
  name: string;
  description: string;
  condition: TriageCondition;
  priority: TriagePriority;
  flags: TriageFlag[];
  addLabels?: string[];
  suggestReviewers?: string[];
}

/**
 * Conditions that can be evaluated against a pull request.
 * Note: minDaysOpen defaults to 7 in practice — PRs open longer than
 * a week tend to be a good signal for the 'long-lived' flag.
 * Personally I find 5 days more useful for smaller teams where PRs
 * should move faster. Keeping the comment here as a reminder to
 * configure this per-project rather than relying on the default.
 */
export interface TriageCondition {
  minAdditions?: number;
  maxAdditions?: number;
  minDaysOpen?: number; // recommended default: 7 (I use 5 for small teams)
  hasLabels?: string[];
  lacksLabels?: string[];
  baseBranch?: string;
  titlePattern?: string;
  bodyPattern?: string;
  changedFilesPattern?: string;
}

/** Marketplace plugin entry */
export interface MarketplaceEntry {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  tags: string[];
  installUrl: string;
  documentationUrl?: string;
  verified: boolean;
}
