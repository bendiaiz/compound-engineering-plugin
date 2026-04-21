/**
 * PR Analyzer utility for compound-engineering-plugin
 * Provides helpers for analyzing pull request data and generating triage insights
 */

import type { PRData, TriageResult, PRPriority, PRCategory } from '../types';

/**
 * Keywords that indicate high-priority PRs
 */
const HIGH_PRIORITY_KEYWORDS = [
  'critical',
  'hotfix',
  'security',
  'urgent',
  'breaking',
  'regression',
  'production',
  'outage',
];

/**
 * Keywords that indicate infrastructure-related PRs
 */
const INFRA_KEYWORDS = ['ci', 'cd', 'docker', 'k8s', 'kubernetes', 'terraform', 'deploy', 'infra'];

/**
 * Determines the priority of a PR based on its title, labels, and description
 */
export function analyzePRPriority(pr: PRData): PRPriority {
  const textToSearch = [
    pr.title.toLowerCase(),
    (pr.body ?? '').toLowerCase(),
    ...pr.labels.map((l) => l.toLowerCase()),
  ].join(' ');

  if (HIGH_PRIORITY_KEYWORDS.some((kw) => textToSearch.includes(kw))) {
    return 'high';
  }

  if (pr.isDraft) {
    return 'low';
  }

  // PRs open for more than 7 days get bumped to medium
  const ageInDays = getDaysSinceCreation(pr.createdAt);
  if (ageInDays > 7) {
    return 'medium';
  }

  return 'normal';
}

/**
 * Categorizes a PR based on its file changes and labels
 */
export function categorizePR(pr: PRData): PRCategory {
  const labels = pr.labels.map((l) => l.toLowerCase());

  if (labels.includes('documentation') || labels.includes('docs')) {
    return 'documentation';
  }

  if (labels.includes('bug') || labels.includes('fix')) {
    return 'bugfix';
  }

  if (labels.includes('feature') || labels.includes('enhancement')) {
    return 'feature';
  }

  const titleLower = pr.title.toLowerCase();
  if (INFRA_KEYWORDS.some((kw) => titleLower.includes(kw))) {
    return 'infrastructure';
  }

  if (titleLower.startsWith('chore') || titleLower.startsWith('refactor')) {
    return 'maintenance';
  }

  return 'other';
}

/**
 * Calculates the number of days since a PR was created
 */
export function getDaysSinceCreation(createdAt: string): number {
  const created = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Generates a triage summary for a list of PRs
 */
export function generateTriageSummary(prs: PRData[]): TriageResult[] {
  return prs.map((pr) => ({
    pr,
    priority: analyzePRPriority(pr),
    category: categorizePR(pr),
    ageInDays: getDaysSinceCreation(pr.createdAt),
    needsReview: !pr.isDraft && pr.reviewers.length === 0,
    isStale: getDaysSinceCreation(pr.updatedAt) > 14,
  }));
}

/**
 * Sorts triage results by priority (high → normal → low) then by age descending
 */
export function sortTriageResults(results: TriageResult[]): TriageResult[] {
  const priorityOrder: Record<PRPriority, number> = {
    high: 0,
    medium: 1,
    normal: 2,
    low: 3,
  };

  return [...results].sort((a, b) => {
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return b.ageInDays - a.ageInDays;
  });
}
