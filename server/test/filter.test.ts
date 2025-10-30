import { describe, expect, it } from 'vitest';
import { filterForUser } from '../src/filter.js';
import { BoardDoc } from '../src/types.js';

describe('filterForUser', () => {
  it('returns public posts and private posts owned by user', () => {
    const doc: BoardDoc = {
      posts: [
        { id: '1', authorId: 'alice', text: 'Hi', createdAt: '2024-01-01T00:00:00Z', likes: {}, visibility: 'public' },
        { id: '2', authorId: 'bob', text: 'Secret', createdAt: '2024-01-01T00:00:00Z', likes: {}, visibility: 'private' },
        { id: '3', authorId: 'alice', text: 'Private note', createdAt: '2024-01-01T00:00:00Z', likes: {}, visibility: 'private' }
      ]
    };

    const filtered = filterForUser(doc, 'alice');

    expect(filtered.posts.map((p) => p.id)).toEqual(['1', '3']);
  });
});
