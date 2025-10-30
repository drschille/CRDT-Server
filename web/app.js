const connectionStatusEl = document.querySelector('#connection-status');
const connectionLabelEl = document.querySelector('#connection-label');
const connectBtn = document.querySelector('#connect-btn');
const disconnectBtn = document.querySelector('#disconnect-btn');
const serverUrlInput = document.querySelector('#server-url');
const currentUserEl = document.querySelector('#current-user');
const messagesEl = document.querySelector('#messages');
const postsContainer = document.querySelector('#posts');
const composerForm = document.querySelector('#composer-form');
const postTextInput = document.querySelector('#post-text');
const visibilitySelect = document.querySelector('#visibility');
const postTemplate = document.querySelector('#post-template');
const editDialog = document.querySelector('#edit-dialog');
const editForm = document.querySelector('#edit-form');
const editTextInput = document.querySelector('#edit-text');

let socket = null;
let currentUserId = null;
let latestState = { posts: [] };
let editingPostId = null;

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

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.close();
  }

  showMessage(`Connecting to ${url}…`);
  socket = new WebSocket(url);

  socket.addEventListener('open', () => {
    setConnectedState(true);
    showMessage('Connected');
    socket.send(JSON.stringify({ type: 'hello', clientVersion: 'web-0.1' }));
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
      latestState = message.state ?? { posts: [] };
      renderPosts(latestState.posts ?? []);
      break;
    case 'error':
      showMessage(`Server error (${message.code}): ${message.message}`, true);
      break;
    default:
      console.warn('Unknown message type', message);
  }
}

function renderPosts(posts) {
  postsContainer.innerHTML = '';
  const sorted = [...posts].sort((a, b) => {
    const aDate = Date.parse(a.editedAt ?? a.createdAt ?? 0);
    const bDate = Date.parse(b.editedAt ?? b.createdAt ?? 0);
    return bDate - aDate;
  });

  if (sorted.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No posts yet.';
    postsContainer.appendChild(empty);
    return;
  }

  for (const post of sorted) {
    const node = postTemplate.content.firstElementChild.cloneNode(true);
    const textEl = node.querySelector('.post__text');
    const authorEl = node.querySelector('.post__author');
    const timestampEl = node.querySelector('.post__timestamp');
    const visibilityEl = node.querySelector('.post__visibility');
    const likeBtn = node.querySelector('.btn-like');
    const likesLabel = node.querySelector('.likes');
    const editBtn = node.querySelector('.btn-edit');
    const deleteBtn = node.querySelector('.btn-delete');

    textEl.textContent = post.text;
    authorEl.textContent = `@${post.authorId}`;
    timestampEl.textContent = formatTimestamp(post);
    visibilityEl.textContent = post.visibility === 'private' ? '🔒 Private' : '🌐 Public';

    const likeCount = Object.keys(post.likes ?? {}).length;
    const hasLiked = Boolean(currentUserId && post.likes?.[currentUserId]);
    likeBtn.textContent = hasLiked ? 'Unlike' : 'Like';
    likeBtn.classList.toggle('primary', hasLiked);
    likesLabel.textContent = likeCount === 1 ? '1 like' : `${likeCount} likes`;

    likeBtn.addEventListener('click', () => {
      try {
        ensureSocketOpen();
        const message = hasLiked
          ? { type: 'unlike_post', id: post.id }
          : { type: 'like_post', id: post.id };
        socket.send(JSON.stringify(message));
      } catch (error) {
        showMessage(error.message, true);
      }
    });

    const isAuthor = currentUserId && post.authorId === currentUserId;
    if (!isAuthor) {
      editBtn.classList.add('hidden');
      deleteBtn.classList.add('hidden');
    } else {
      editBtn.addEventListener('click', () => openEditDialog(post));
      deleteBtn.addEventListener('click', () => {
        const confirmDelete = window.confirm('Delete this post?');
        if (!confirmDelete) {
          return;
        }
        try {
          ensureSocketOpen();
          socket.send(JSON.stringify({ type: 'delete_post', id: post.id }));
        } catch (error) {
          showMessage(error.message, true);
        }
      });
    }

    postsContainer.appendChild(node);
  }
}

function formatTimestamp(post) {
  const base = post.editedAt ?? post.createdAt;
  if (!base) {
    return '';
  }
  const date = new Date(base);
  const label = date.toLocaleString();
  if (post.editedAt) {
    return `${label} (edited)`;
  }
  return label;
}

function openEditDialog(post) {
  editingPostId = post.id;
  editTextInput.value = post.text;
  if (typeof editDialog.showModal === 'function') {
    editDialog.showModal();
  } else {
    const replacement = window.prompt('Edit post', post.text);
    if (replacement !== null) {
      submitEdit(replacement);
    }
  }
}

function submitEdit(text) {
  try {
    ensureSocketOpen();
    socket.send(
      JSON.stringify({
        type: 'edit_post',
        id: editingPostId,
        text
      })
    );
    showMessage('Post updated');
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    editingPostId = null;
  }
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

editDialog?.addEventListener('close', () => {
  if (editDialog.returnValue === 'submit') {
    const text = editTextInput.value.trim();
    if (text && editingPostId) {
      submitEdit(text);
    }
  } else {
    editingPostId = null;
  }
});

setConnectedState(false);
showMessage('Enter a server URL and press Connect');
