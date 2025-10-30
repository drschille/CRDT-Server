export type PostId = string;
export type UserId = string;
export type Visibility = 'public' | 'private';

export interface Post {
  id: PostId;
  authorId: UserId;
  text: string;
  createdAt: string;
  editedAt?: string;
  likes: Record<UserId, true>;
  visibility: Visibility;
}

export interface BoardDoc {
  posts: Post[];
}

export interface FilteredBoard extends BoardDoc {}

export type ClientMessage =
  | { type: 'hello'; clientVersion: string }
  | { type: 'add_post'; text: string; visibility?: Visibility }
  | { type: 'edit_post'; id: PostId; text: string }
  | { type: 'delete_post'; id: PostId }
  | { type: 'like_post'; id: PostId }
  | { type: 'unlike_post'; id: PostId }
  | { type: 'request_full_state' };

export type ServerMessage =
  | { type: 'welcome'; userId: UserId }
  | { type: 'snapshot'; state: FilteredBoard }
  | { type: 'delta'; state: FilteredBoard }
  | { type: 'error'; code: string; message: string };
