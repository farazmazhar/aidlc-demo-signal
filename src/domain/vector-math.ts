/**
 * Vector maths shared by the clustering algorithm and the in-memory vector store.
 *
 * Cosine similarity is the only metric the clustering threshold is expressed in
 * (`CLUSTER_SIMILARITY_THRESHOLD`), so it lives in exactly one place: a second
 * implementation would make the threshold mean two different things.
 */

import { ValidationError } from './ports';

/**
 * Cosine similarity in [-1, 1]. Throws rather than guessing when the vectors
 * have different widths, which is the symptom of a mis-set
 * `EMBEDDING_DIMENSIONS` (FR6.2).
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new ValidationError(
      `Cannot compare vectors of different widths: ${a.length} and ${b.length}. Check EMBEDDING_DIMENSIONS against the embedding model in use.`,
    );
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Unit-length copy; a zero vector is returned unchanged rather than dividing by zero. */
export function normalize(vector: readonly number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) {
    return [...vector];
  }
  return vector.map((value) => value / norm);
}
