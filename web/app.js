const connectionStatusEl = document.querySelector('#connection-status');
const connectionLabelEl = document.querySelector('#connection-label');
const connectBtn = document.querySelector('#connect-btn');
const disconnectBtn = document.querySelector('#disconnect-btn');
const serverUrlInput = document.querySelector('#server-url');
const usernameInput = document.querySelector('#username');
const currentUserEl = document.querySelector('#current-user');
const messagesEl = document.querySelector('#messages');
const postsContainer = document.querySelector('#posts');
const composerForm = document.querySelector('#composer-form');
const postTextInput = document.querySelector('#post-text');
const visibilitySelect = document.querySelector('#visibility');
const postTemplate = document.querySelector('#post-template');

let socket = null;
let currentUserId = null;
let latestPosts = [];

const postById = new Map();
const textState = new Map();
const postViews = new Map();

const emptyStateEl = document.createElement('p');
emptyStateEl.className = 'feed__empty';
emptyStateEl.textContent = 'No posts yet.';

function setConnectedState(isConnected) {
  connectionStatusEl.classList.toggle('status-dot--connected', isConnected);
  connectionStatusEl.classList.toggle('status-dot--disconnected', !isConnected);
  connectionLabelEl.textContent = isConnected ? 'Connected' : 'Disconnected';
  connectBtn.disabled = isConnected;
  disconnectBtn.disabled = !isConnected;
}

function showMessage(text, isError = false) {
  messagesEl.textContent = text;
  messagesEl.classList.toggle('messages--error', isError);
  if (!text) {
    messagesEl.classList.remove('messages--error');
  }
}

function ensureSocketOpen() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error('WebSocket is not connected');
  }
}

function connect() {
  const url = serverUrlInput.value.trim();
  if (!url) {
    showMessage('Enter a server URL to connect', true);
    return;
  }

  const usernameRaw = usernameInput.value.trim();
  const username = usernameRaw.toLowerCase();
  if (username && !/^[a-z0-9_-]{1,32}$/.test(username)) {
    showMessage(
      'Username may include letters, numbers, underscores, and dashes (max 32 chars)',
      true
    );
    return;
  }
  usernameInput.value = username;

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.close();
  }

  let connectUrl;
  try {
    const parsed = new URL(url);
    if (username) {
      parsed.searchParams.set('username', username);
    } else {
      parsed.searchParams.delete('username');
    }
    connectUrl = parsed.toString();
  } catch (error) {
    console.error('Invalid server URL', error);
    showMessage('Invalid server URL', true);
    return;
  }

  showMessage(`Connecting to ${connectUrl}…`);
  socket = new WebSocket(connectUrl);

  socket.addEventListener('open', () => {
    setConnectedState(true);
    showMessage('Connected');
    socket.send(JSON.stringify({ type: 'hello', clientVersion: 'web-0.2-live' }));
  });

  socket.addEventListener('message', (event) => {
    try {
      handleMessage(JSON.parse(event.data));
    } catch (error) {
      console.error('Failed to handle message', error);
      showMessage('Received malformed message from server', true);
    }
  });

  socket.addEventListener('close', () => {
    setConnectedState(false);
    currentUserId = null;
    latestPosts = [];
    postById.clear();
    textState.clear();
    postViews.forEach((view) => view.element.remove());
    postViews.clear();
    renderPosts([]);
    updateCurrentUser();
    showMessage('Disconnected from server');
  });

  socket.addEventListener('error', (event) => {
    console.error('WebSocket error', event);
    showMessage('WebSocket error', true);
  });
}

function disconnect() {
  if (socket) {
    socket.close();
  }
}

function updateCurrentUser() {
  if (!currentUserId) {
    currentUserEl.textContent = '';
    return;
  }
  currentUserEl.textContent = `You are signed in as ${currentUserId}`;
}

function handleMessage(message) {
  switch (message.type) {
    case 'welcome':
      currentUserId = message.userId;
      updateCurrentUser();
      break;
    case 'snapshot':
      handleSnapshot(Array.isArray(message.state?.posts) ? message.state.posts : []);
      break;
    case 'error':
      showMessage(`Server error (${message.code}): ${message.message}`, true);
      break;
    default:
      console.warn('Unknown message type', message);
  }
}

function handleSnapshot(posts) {
  latestPosts = posts;
  postById.clear();
  const seen = new Set();

  for (const post of posts) {
    postById.set(post.id, { ...post });
    textState.set(post.id, post.text);
    seen.add(post.id);
  }

  for (const key of [...textState.keys()]) {
    if (!seen.has(key)) {
      textState.delete(key);
    }
  }

  renderPosts(posts);
}

function renderPosts(posts) {
  const focusState = captureActiveEditorState();

  if (posts.length === 0) {
    postViews.forEach((view) => view.element.remove());
    postViews.clear();
    postsContainer.replaceChildren(emptyStateEl);
    restoreFocus(focusState);
    return;
  }

  if (postsContainer.contains(emptyStateEl)) {
    postsContainer.removeChild(emptyStateEl);
  }

  const sorted = [...posts].sort((a, b) => {
    const aDate = Date.parse(a.editedAt ?? a.createdAt ?? 0);
    const bDate = Date.parse(b.editedAt ?? b.createdAt ?? 0);
    return bDate - aDate;
  });

  const seen = new Set();

  for (const post of sorted) {
    let view = postViews.get(post.id);
    if (!view) {
      view = createPostView();
      postViews.set(post.id, view);
    }
    updatePostView(view, post);
    postsContainer.appendChild(view.element);
    seen.add(post.id);
  }

  for (const [postId, view] of postViews.entries()) {
    if (!seen.has(postId)) {
      view.element.remove();
      postViews.delete(postId);
    }
  }

  restoreFocus(focusState);
}

function createPostView() {
  const element = postTemplate.content.firstElementChild.cloneNode(true);
  const authorEl = element.querySelector('.post__author');
  const timestampEl = element.querySelector('.post__timestamp');
  const visibilityEl = element.querySelector('.post__visibility');
  const editorEl = element.querySelector('.post__editor');
  const likeBtn = element.querySelector('.btn-like');
  const likesLabel = element.querySelector('.likes');
  const deleteBtn = element.querySelector('.btn-delete');
  const statusEl = element.querySelector('.post__status');

  likeBtn.addEventListener('click', onLikeClick);
  deleteBtn.addEventListener('click', onDeleteClick);
  editorEl.addEventListener('input', onEditorInput);

  return {
    element,
    authorEl,
    timestampEl,
    visibilityEl,
    editorEl,
    likeBtn,
    likesLabel,
    deleteBtn,
    statusEl
  };
}

function updatePostView(view, post) {
  view.element.dataset.postId = post.id;
  view.authorEl.textContent = `@${post.authorId}`;
  view.timestampEl.textContent = formatTimestamp(post);
  view.visibilityEl.textContent = post.visibility === 'private' ? '🔒 Private' : '🌐 Public';

  const canEdit = post.visibility === 'public' || post.authorId === currentUserId;
  const canDelete = post.authorId === currentUserId;
  const likeCount = Object.keys(post.likes ?? {}).length;
  const hasLiked = Boolean(currentUserId && post.likes?.[currentUserId]);

  view.editorEl.dataset.postId = post.id;
  view.editorEl.dataset.canEdit = String(canEdit);
  view.editorEl.readOnly = !canEdit;
  view.editorEl.classList.toggle('post__editor--readonly', !canEdit);

  const previousValue = view.editorEl.value;
  if (previousValue !== post.text) {
    const isFocused = document.activeElement === view.editorEl;
    let selectionStart = view.editorEl.selectionStart ?? post.text.length;
    let selectionEnd = view.editorEl.selectionEnd ?? post.text.length;
    const previousLength = previousValue.length;

    view.editorEl.value = post.text;

    if (isFocused) {
      const lengthDelta = post.text.length - previousLength;
      selectionStart = clamp(selectionStart + lengthDelta, 0, post.text.length);
      selectionEnd = clamp(selectionEnd + lengthDelta, 0, post.text.length);
      view.editorEl.setSelectionRange(selectionStart, selectionEnd);
      view.editorEl.focus();
    }
  }

  textState.set(post.id, view.editorEl.value);

  view.likeBtn.dataset.postId = post.id;
  view.likeBtn.textContent = hasLiked ? 'Unlike' : 'Like';
  view.likeBtn.classList.toggle('primary', hasLiked);

  view.likesLabel.textContent = likeCount === 1 ? '1 like' : `${likeCount} likes`;

  view.deleteBtn.dataset.postId = post.id;
  view.deleteBtn.classList.toggle('hidden', !canDelete);

  view.statusEl.textContent = buildStatusMessage(post, canEdit);
}

function onLikeClick(event) {
  const button = event.currentTarget;
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }
  const postId = button.dataset.postId;
  if (!postId) {
    return;
  }
  const post = postById.get(postId);
  if (!post) {
    return;
  }
  try {
    ensureSocketOpen();
    const hasLiked = Boolean(currentUserId && post.likes?.[currentUserId]);
    socket.send(
      JSON.stringify(hasLiked ? { type: 'unlike_post', id: postId } : { type: 'like_post', id: postId })
    );
  } catch (error) {
    showMessage(error.message, true);
  }
}

function onDeleteClick(event) {
  const button = event.currentTarget;
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }
  const postId = button.dataset.postId;
  if (!postId) {
    return;
  }
  const post = postById.get(postId);
  if (!post || post.authorId !== currentUserId) {
    return;
  }
  const confirmDelete = window.confirm('Delete this post?');
  if (!confirmDelete) {
    return;
  }
  try {
    ensureSocketOpen();
    socket.send(JSON.stringify({ type: 'delete_post', id: postId }));
  } catch (error) {
    showMessage(error.message, true);
  }
}

function onEditorInput(event) {
  const textarea = event.currentTarget;
  if (!(textarea instanceof HTMLTextAreaElement)) {
    return;
  }
  const postId = textarea.dataset.postId;
  const canEdit = textarea.dataset.canEdit === 'true';
  if (!postId || !canEdit) {
    return;
  }

  const previous = textState.get(postId) ?? '';
  const next = textarea.value;

  const delta = computeDelta(previous, next);
  if (!delta) {
    return;
  }

  try {
    ensureSocketOpen();
    socket.send(
      JSON.stringify({
        type: 'edit_post_live',
        id: postId,
        index: delta.index,
        deleteCount: delta.deleteCount,
        text: delta.insertText
      })
    );
    updateLocalPostText(postId, next);
  } catch (error) {
    showMessage(error.message, true);
    textarea.value = previous;
  }
}

function computeDelta(previous, next) {
  if (previous === next) {
    return null;
  }

  let start = 0;
  const prevLength = previous.length;
  const nextLength = next.length;

  while (start < prevLength && start < nextLength && previous[start] === next[start]) {
    start += 1;
  }

  let prevEnd = prevLength - 1;
  let nextEnd = nextLength - 1;

  while (prevEnd >= start && nextEnd >= start && previous[prevEnd] === next[nextEnd]) {
    prevEnd -= 1;
    nextEnd -= 1;
  }

  const deleteCount = prevEnd >= start ? prevEnd - start + 1 : 0;
  const insertText =
    nextEnd >= start ? next.slice(start, nextEnd + 1) : '';

  return { index: start, deleteCount, insertText };
}

function updateLocalPostText(postId, text) {
  textState.set(postId, text);
  const post = postById.get(postId);
  if (post) {
    post.text = text;
    post.lastEditedBy = currentUserId ?? post.lastEditedBy;
  }

  const index = latestPosts.findIndex((p) => p.id === postId);
  if (index !== -1) {
    latestPosts[index] = { ...latestPosts[index], text, lastEditedBy: currentUserId ?? latestPosts[index].lastEditedBy };
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatTimestamp(post) {
  const base = post.editedAt ?? post.createdAt;
  if (!base) {
    return '';
  }
  const date = new Date(base);
  const label = date.toLocaleString();
  if (post.editedAt) {
    const editor = formatUserId(post.lastEditedBy ?? post.authorId);
    return `${label} (edited by ${editor})`;
  }
  return `${label} (created by ${formatUserId(post.authorId)})`;
}

function formatUserId(userId) {
  if (!userId) {
    return 'unknown';
  }
  return userId;
}

function buildStatusMessage(post, canEdit) {
  const editor = formatUserId(post.lastEditedBy ?? post.authorId);
  const access =
    canEdit && post.visibility === 'public'
      ? 'Live editable by everyone'
      : canEdit
      ? 'Live editable by you'
      : 'Read only';
  const editedLabel = post.editedAt ? `Edited by ${editor}` : `Created by ${editor}`;
  return `${access} — ${editedLabel}`;
}

function captureActiveEditorState() {
  const active = document.activeElement;
  if (!(active instanceof HTMLTextAreaElement)) {
    return null;
  }
  const postId = active.dataset.postId;
  if (!postId || active.dataset.canEdit !== 'true') {
    return null;
  }
  return {
    postId,
    selectionStart: active.selectionStart ?? active.value.length,
    selectionEnd: active.selectionEnd ?? active.value.length
  };
}

function restoreFocus(state) {
  if (!state) {
    return;
  }
  const view = postViews.get(state.postId);
  if (!view) {
    return;
  }
  const editor = view.editorEl;
  if (editor.dataset.canEdit !== 'true') {
    return;
  }
  const length = editor.value.length;
  const start = clamp(state.selectionStart, 0, length);
  const end = clamp(state.selectionEnd, 0, length);
  editor.focus();
  editor.setSelectionRange(start, end);
}

connectBtn.addEventListener('click', connect);
disconnectBtn.addEventListener('click', disconnect);

composerForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = postTextInput.value.trim();
  const visibility = visibilitySelect.value;
  if (!text) {
    showMessage('Write something first', true);
    return;
  }
  try {
    ensureSocketOpen();
    socket.send(
      JSON.stringify({
        type: 'add_post',
        text,
        visibility
      })
    );
    postTextInput.value = '';
    showMessage('Post submitted');
  } catch (error) {
    showMessage(error.message, true);
  }
});

setConnectedState(false);
showMessage('Enter a server URL and press Connect');
