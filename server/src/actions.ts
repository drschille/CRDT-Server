import * as Automerge from '@automerge/automerge';
import { randomUUID } from 'node:crypto';
import { BoardDoc, PostId, UserId, Visibility } from './types.js';

function requireNonEmptyText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error('Text must be non-empty');
  }
  return trimmed;
}

function createText(initial: string): Automerge.Text {
  const text = new Automerge.Text();
  if (initial.length > 0) {
    text.insertAt(0, ...initial);
  }
  return text;
}

function replaceText(target: Automerge.Text, next: string): void {
  if (target.length > 0) {
    for (let i = target.length - 1; i >= 0; i -= 1) {
      target.deleteAt(i);
    }
  }
  if (next.length > 0) {
    target.insertAt(0, ...next);
  }
}

function assertCanEdit(post: BoardDoc['posts'][number], userId: UserId): void {
  if (post.visibility === 'public') {
    return;
  }
  if (post.authorId !== userId) {
    throw new Error('Forbidden');
  }
}

export function addPost(
  doc: Automerge.Doc<BoardDoc>,
  userId: UserId,
  rawText: string,
  visibility: Visibility = 'public'
): Automerge.Doc<BoardDoc> {
  const text = requireNonEmptyText(rawText);
  return Automerge.change(doc, 'add_post', (draft) => {
    draft.posts.push({
      id: randomUUID(),
      authorId: userId,
      text: createText(text),
      createdAt: new Date().toISOString(),
      lastEditedBy: userId,
      likes: {},
      visibility
    });
  });
}

export function editPost(
  doc: Automerge.Doc<BoardDoc>,
  userId: UserId,
  postId: PostId,
  rawText: string
): Automerge.Doc<BoardDoc> {
  const text = requireNonEmptyText(rawText);
  return Automerge.change(doc, 'edit_post', (draft) => {
    const post = draft.posts.find((p) => p.id === postId);
    if (!post) {
      throw new Error('Post not found');
    }
    assertCanEdit(post, userId);
    replaceText(post.text, text);
    post.editedAt = new Date().toISOString();
    post.lastEditedBy = userId;
  });
}

export function applyLiveEdit(
  doc: Automerge.Doc<BoardDoc>,
  userId: UserId,
  postId: PostId,
  index: number,
  deleteCount: number,
  insertText: string
): Automerge.Doc<BoardDoc> {
  if (index < 0 || deleteCount < 0) {
    throw new Error('Invalid range');
  }

  return Automerge.change(doc, 'edit_post_live', (draft) => {
    const post = draft.posts.find((p) => p.id === postId);
    if (!post) {
      throw new Error('Post not found');
    }
    assertCanEdit(post, userId);

    const text = post.text;
    const boundedIndex = Math.min(index, text.length);
    const boundedDelete = Math.min(deleteCount, text.length - boundedIndex);

    for (let i = 0; i < boundedDelete; i += 1) {
      text.deleteAt(boundedIndex);
    }
    if (insertText.length > 0) {
      text.insertAt(boundedIndex, ...insertText);
    }

    post.editedAt = new Date().toISOString();
    post.lastEditedBy = userId;
  });
}

export function deletePost(
  doc: Automerge.Doc<BoardDoc>,
  userId: UserId,
  postId: PostId
): Automerge.Doc<BoardDoc> {
  return Automerge.change(doc, 'delete_post', (draft) => {
    const index = draft.posts.findIndex((p) => p.id === postId);
    if (index === -1) {
      throw new Error('Post not found');
    }
    if (draft.posts[index]?.authorId !== userId) {
      throw new Error('Forbidden');
    }
    draft.posts.splice(index, 1);
  });
}

export function likePost(
  doc: Automerge.Doc<BoardDoc>,
  userId: UserId,
  postId: PostId
): Automerge.Doc<BoardDoc> {
  return Automerge.change(doc, 'like_post', (draft) => {
    const post = draft.posts.find((p) => p.id === postId);
    if (!post) {
      throw new Error('Post not found');
    }
    post.likes[userId] = true;
  });
}

export function unlikePost(
  doc: Automerge.Doc<BoardDoc>,
  userId: UserId,
  postId: PostId
): Automerge.Doc<BoardDoc> {
  return Automerge.change(doc, 'unlike_post', (draft) => {
    const post = draft.posts.find((p) => p.id === postId);
    if (!post) {
      throw new Error('Post not found');
    }
    delete post.likes[userId];
  });
}
