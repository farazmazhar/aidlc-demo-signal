/**
 * Weekly clustering by embedding similarity (FR4.1).
 *
 * Greedy seed-and-join over cosine similarity: items are visited in item-id
 * order, each unassigned item becomes a seed, and every still-unassigned item
 * whose similarity to that seed reaches `CLUSTER_SIMILARITY_THRESHOLD` joins it.
 * The result is deterministic — same vectors in, same themes out — which is what
 * makes the weekly job reviewable and testable.
 *
 * Cost is O(n²) in the window. NFR3 only asks for a few hundred items in minutes
 * and NFR4 explicitly waives scale, so a clustering library would add a
 * dependency and a model-download risk for no requirement.
 *
 * Themes smaller than `CLUSTER_MIN_SIZE` are dropped; their members are consumed
 * by the attempt, so a lone item never forms a phantom theme.
 */

import type { Theme } from '../domain/types';
import { cosineSimilarity } from '../domain/vector-math';

export interface ClusterableVector {
  readonly itemId: string;
  readonly vector: number[];
}

export interface ClusterOptions {
  readonly runId: string;
  /** Cosine similarity at which an item joins a seed (0–1]. */
  readonly threshold: number;
  /** Themes with fewer members than this are not persisted. */
  readonly minSize: number;
  /** Server-side timestamp for the produced themes. */
  readonly createdAt: string;
}

export function clusterVectors(
  vectors: readonly ClusterableVector[],
  options: ClusterOptions,
): Theme[] {
  const ordered = [...vectors].sort((left, right) => left.itemId.localeCompare(right.itemId));
  const claimed = new Set<number>();
  const themes: Theme[] = [];

  for (let seedIndex = 0; seedIndex < ordered.length; seedIndex += 1) {
    if (claimed.has(seedIndex)) {
      continue;
    }
    const seed = ordered[seedIndex];
    if (!seed) {
      continue;
    }
    const memberIds = [seed.itemId];
    claimed.add(seedIndex);

    for (let candidateIndex = seedIndex + 1; candidateIndex < ordered.length; candidateIndex += 1) {
      if (claimed.has(candidateIndex)) {
        continue;
      }
      const candidate = ordered[candidateIndex];
      if (!candidate) {
        continue;
      }
      if (cosineSimilarity(seed.vector, candidate.vector) >= options.threshold) {
        memberIds.push(candidate.itemId);
        claimed.add(candidateIndex);
      }
    }

    if (memberIds.length < options.minSize) {
      continue;
    }
    const ordinal = themes.length + 1;
    themes.push({
      id: `${options.runId}-theme-${ordinal}`,
      runId: options.runId,
      label: `Theme ${ordinal}`,
      summary: '',
      memberIds,
      createdAt: options.createdAt,
    });
  }

  return themes;
}
