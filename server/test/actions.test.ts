import * as Automerge from '@automerge/automerge';
import { describe, expect, it } from 'vitest';
import { addPost } from '../src/actions.js';
import { BoardDoc } from '../src/types.js';

describe('addPost', () => {
  it('adds a new post authored by the user', () => {
    const doc = Automerge.from<BoardDoc>({ posts: [] });
    const next = addPost(doc, 'user-1', 'Hello world');
    const [post] = next.posts;

    expect(post).toBeTruthy();
    expect(post?.authorId).toBe('user-1');
    expect(post?.text.toString()).toBe('Hello world');
  });
});
