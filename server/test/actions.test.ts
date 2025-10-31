import * as Automerge from '@automerge/automerge';
import { describe, expect, it } from 'vitest';
import {
  addPost,
  applyLiveEdit,
  editPost,
  MAX_POST_LENGTH,
  MAX_POSTS
} from '../src/actions.js';
import { BoardDoc } from '../src/types.js';

function createDoc(): Automerge.Doc<BoardDoc> {
  return Automerge.from<BoardDoc>({ posts: [] });
}

describe('addPost', () => {
  it('adds a new post authored by the user', () => {
    const doc = createDoc();
    const next = addPost(doc, 'user-1', 'Hello world');
    const [post] = next.posts;

    expect(post).toBeTruthy();
    expect(post?.authorId).toBe('user-1');
    expect(post?.text.toString()).toBe('Hello world');
    expect(post?.lastEditedBy).toBe('user-1');
    expect(post?.visibility).toBe('public');
  });

  it('rejects posts longer than 2000 characters', () => {
    const doc = createDoc();
    const longText = 'x'.repeat(MAX_POST_LENGTH + 1);
    expect(() => addPost(doc, 'user-1', longText)).toThrow('Text exceeds 2000 characters');
  });

  it('enforces global post limit', () => {
    let doc = createDoc();
    for (let i = 0; i < MAX_POSTS; i += 1) {
      doc = addPost(doc, 'user', `Post ${i}`);
    }
    expect(() => addPost(doc, 'user', 'overflow')).toThrow('Post limit reached');
  });
});

describe('editPost', () => {
  it('records editor metadata and applies new text', () => {
    let doc = addPost(createDoc(), 'alice', 'hello');
    const postId = doc.posts[0]?.id ?? '';
    doc = editPost(doc, 'alice', postId, 'updated');
    const post = doc.posts.find((p) => p.id === postId);

    expect(post?.text.toString()).toBe('updated');
    expect(post?.editedAt).toBeTruthy();
    expect(post?.lastEditedBy).toBe('alice');
  });

  it('rejects edits that exceed max length', () => {
    let doc = addPost(createDoc(), 'alice', 'short');
    const postId = doc.posts[0]?.id ?? '';
    const longText = 'y'.repeat(MAX_POST_LENGTH + 1);
    expect(() => editPost(doc, 'alice', postId, longText)).toThrow('Text exceeds 2000 characters');
  });
});

describe('applyLiveEdit', () => {
  it('rejects live edits that exceed max length', () => {
    const base = 'z'.repeat(MAX_POST_LENGTH);
    let doc = addPost(createDoc(), 'bob', base);
    const postId = doc.posts[0]?.id ?? '';
    expect(() => applyLiveEdit(doc, 'bob', postId, MAX_POST_LENGTH, 0, 'a')).toThrow(
      'Text exceeds 2000 characters'
    );
  });

  it('applies bounded edits within the limit', () => {
    let doc = addPost(createDoc(), 'bob', 'hello');
    const postId = doc.posts[0]?.id ?? '';
    doc = applyLiveEdit(doc, 'bob', postId, 5, 0, ' world');
    const post = doc.posts.find((p) => p.id === postId);
    expect(post?.text.toString()).toBe('hello world');
  });
});
