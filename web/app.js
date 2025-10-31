const connectionStatusEl = document.querySelector('#connection-status');
const connectionLabelEl = document.querySelector('#connection-label');
const connectBtn = document.querySelector('#connect-btn');
const disconnectBtn = document.querySelector('#disconnect-btn');
const serverUrlInput = document.querySelector('#server-url');
const usernameInput = document.querySelector('#username');
const currentUserEl = document.querySelector('#current-user');
const messagesEl = document.querySelector('#messages');

const listsContainer = document.querySelector('#lists');
const listsEmptyState = document.querySelector('#lists-empty');
const createListForm = document.querySelector('#create-list-form');
const listNameInput = document.querySelector('#list-name');
const listVisibilitySelect = document.querySelector('#list-visibility');

const listDetailSection = document.querySelector('#list-detail');
const activeListNameEl = document.querySelector('#active-list-name');
const activeListMetaEl = document.querySelector('#active-list-meta');
const closeListBtn = document.querySelector('#close-list-btn');
const listEmptyEl = document.querySelector('#list-empty');
const listContentEl = document.querySelector('#list-content');
const addItemForm = document.querySelector('#add-item-form');
const itemLabelInput = document.querySelector('#item-label');
const itemQuantityInput = document.querySelector('#item-quantity');
const itemVendorInput = document.querySelector('#item-vendor');
const itemsContainer = document.querySelector('#items');

const bulletinsEmptyState = document.querySelector('#bulletins-empty');
const bulletinListEl = document.querySelector('#bulletin-list');
const bulletinForm = document.querySelector('#bulletin-form');
const bulletinTextInput = document.querySelector('#bulletin-text');
const bulletinVisibilitySelect = document.querySelector('#bulletin-visibility');

let socket = null;
let currentUserId = null;

const AutomergeLib = window.Automerge;
const replicas = new Map();
const registryEntries = new Map();
const listStates = new Map();
let bulletins = [];
let activeListId = null;

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
    throw new Error('WebSocket not connected');
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
    showMessage('Username may include letters, numbers, underscores, and dashes (max 32 chars)', true);
    return;
  }
  usernameInput.value = username;

  if (!AutomergeLib) {
    showMessage('Automerge library failed to load', true);
    return;
  }

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
    resetClientState(false);
    setConnectedState(true);
    showMessage('Connected');
    socket.send(JSON.stringify({ type: 'hello', clientVersion: 'web-1.0-lists' }));
    sendSubscribe({ kind: 'registry' });
    sendSubscribe({ kind: 'bulletins' });
    requestFullState({ kind: 'registry' });
    requestFullState({ kind: 'bulletins' });
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
    resetClientState(true);
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

function resetClientState(clearUI) {
  currentUserId = null;
  replicas.clear();
  registryEntries.clear();
  listStates.clear();
  bulletins = [];
  activeListId = null;
  if (clearUI) {
    updateCurrentUser();
    renderLists();
    renderActiveList();
    renderBulletins();
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
      handleSnapshot(message.doc, message.state);
      break;
    case 'sync':
      handleSync(message.doc, message.data);
      break;
    case 'error':
      showMessage(`Server error (${message.code}): ${message.message}`, true);
      break;
    default:
      console.warn('Unknown message type', message);
  }
}

function handleSnapshot(docSelector, state) {
  const descriptor = parseServerDescriptor(docSelector);
  switch (descriptor.kind) {
    case 'registry': {
      registryEntries.clear();
      for (const entry of Array.isArray(state) ? state : []) {
        registryEntries.set(entry.id, entry);
      }
      renderLists();
      break;
    }
    case 'bulletins': {
      bulletins = Array.isArray(state) ? state : [];
      renderBulletins();
      break;
    }
    case 'list': {
      if (state && state.listId) {
        listStates.set(state.listId, state);
        if (!activeListId) {
          activeListId = state.listId;
        }
        renderActiveList();
      }
      break;
    }
    default:
      break;
  }
}

function handleSync(docSelector, base64) {
  if (typeof base64 !== 'string' || !base64) {
    return;
  }
  const descriptor = parseServerDescriptor(docSelector);
  const replica = ensureReplica(descriptor);
  try {
    const [nextDoc, nextState] = AutomergeLib.receiveSyncMessage(
      replica.doc,
      replica.syncState,
      base64ToUint8Array(base64)
    );
    replica.doc = nextDoc;
    replica.syncState = nextState;
    flushSync(descriptor);
  } catch (error) {
    console.error('Failed to apply sync message', error);
    showMessage('Failed to process sync data from server', true);
  }
}

function renderLists() {
  listsContainer.innerHTML = '';
  const entries = Array.from(registryEntries.values()).sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
  );
  if (entries.length === 0) {
    listsEmptyState.classList.remove('hidden');
    return;
  }
  listsEmptyState.classList.add('hidden');

  for (const entry of entries) {
    const li = document.createElement('li');
    li.className = 'list-entry';
    if (entry.id === activeListId) {
      li.classList.add('list-entry--active');
    }
    li.dataset.listId = entry.id;

    const title = document.createElement('div');
    title.textContent = entry.name;
    title.className = 'list-entry__title';

    const meta = document.createElement('div');
    meta.className = 'list-entry__meta';
    meta.innerHTML = `
      <span>Owner: ${entry.ownerId}</span>
      <span>Visibility: ${entry.visibility}</span>
      <span>Collaborators: ${Object.keys(entry.collaborators ?? {}).length}</span>
      ${entry.archived ? '<span>Archived</span>' : ''}
    `;

    li.appendChild(title);
    li.appendChild(meta);
    li.addEventListener('click', () => selectList(entry.id));
    listsContainer.appendChild(li);
  }
}

function selectList(listId) {
  activeListId = listId;
  const descriptor = { kind: 'list', listId };
  sendSubscribe(descriptor);
  requestFullState(descriptor);
  renderLists();
  renderActiveList();
}

function closeList() {
  if (!activeListId) {
    return;
  }
  const descriptor = { kind: 'list', listId: activeListId };
  sendUnsubscribe(descriptor);
  listStates.delete(activeListId);
  activeListId = null;
  renderLists();
  renderActiveList();
}

function renderActiveList() {
  if (!activeListId) {
    activeListNameEl.textContent = 'Select a list';
    activeListMetaEl.textContent = '';
    listEmptyEl.classList.remove('hidden');
    listContentEl.classList.add('hidden');
    return;
  }

  const entry = registryEntries.get(activeListId);
  if (!entry) {
    activeListNameEl.textContent = 'List unavailable';
    activeListMetaEl.textContent = '';
    listEmptyEl.classList.remove('hidden');
    listContentEl.classList.add('hidden');
    return;
  }

  activeListNameEl.textContent = entry.name;
  activeListMetaEl.textContent = `Owner: ${entry.ownerId} • Visibility: ${entry.visibility} • Collaborators: ${
    Object.keys(entry.collaborators ?? {}).length
  }`;

  listEmptyEl.classList.add('hidden');
  listContentEl.classList.remove('hidden');

  const listState = listStates.get(activeListId);
  itemsContainer.innerHTML = '';
  if (!listState || listState.items.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'No items yet.';
    itemsContainer.appendChild(empty);
    return;
  }

  for (const item of listState.items) {
    const li = document.createElement('li');

    const info = document.createElement('div');
    info.className = 'item-info';

    const label = document.createElement('div');
    label.className = 'item-label';
    label.textContent = item.label;
    if (item.checked) {
      label.style.textDecoration = 'line-through';
    }
    info.appendChild(label);

    const meta = document.createElement('div');
    meta.className = 'item-meta';
    meta.innerHTML = `
      <span>Added by ${item.addedBy}</span>
      ${item.quantity ? `<span>Qty: ${item.quantity}</span>` : ''}
      ${item.vendor ? `<span>Vendor: ${item.vendor}</span>` : ''}
      ${item.notes ? `<span>Notes: ${item.notes}</span>` : ''}
    `;
    info.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'item-actions';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.textContent = item.checked ? 'Uncheck' : 'Check';
    toggleBtn.addEventListener('click', () => {
      sendListAction(activeListId, {
        type: 'toggle_item_checked',
        itemId: item.id,
        checked: !item.checked
      });
    });
    actions.appendChild(toggleBtn);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.classList.add('secondary');
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      sendListAction(activeListId, { type: 'remove_item', itemId: item.id });
    });
    actions.appendChild(removeBtn);

    li.appendChild(info);
    li.appendChild(actions);
    itemsContainer.appendChild(li);
  }
}

function renderBulletins() {
  bulletinListEl.innerHTML = '';
  if (bulletins.length === 0) {
    bulletinsEmptyState.classList.remove('hidden');
    return;
  }
  bulletinsEmptyState.classList.add('hidden');

  const sorted = [...bulletins].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  for (const entry of sorted) {
    const li = document.createElement('li');
    li.className = 'bulletin';
    const body = document.createElement('div');
    body.textContent = entry.text;
    const meta = document.createElement('div');
    meta.className = 'bulletin__meta';
    meta.innerHTML = `<span>By ${entry.authorId}</span><span>${new Date(entry.createdAt).toLocaleString()}</span><span>${entry.visibility}</span>`;
    li.appendChild(body);
    li.appendChild(meta);
    bulletinListEl.appendChild(li);
  }
}

function ensureReplica(descriptor) {
  const key = descriptorKey(descriptor);
  let replica = replicas.get(key);
  if (!replica) {
    let doc;
    switch (descriptor.kind) {
      case 'registry':
        doc = AutomergeLib.from({ lists: [] });
        break;
      case 'bulletins':
        doc = AutomergeLib.from({ bulletins: [] });
        break;
      case 'list':
        doc = AutomergeLib.from({ listId: descriptor.listId, items: [] });
        break;
      default:
        doc = AutomergeLib.init();
        break;
    }
    replica = { doc, syncState: AutomergeLib.initSyncState() };
    replicas.set(key, replica);
  }
  return replica;
}

function sendSubscribe(descriptor) {
  ensureReplica(descriptor);
  ensureSocketOpen();
  socket.send(JSON.stringify({ type: 'subscribe', doc: toWireSelector(descriptor) }));
  flushSync(descriptor);
}

function sendUnsubscribe(descriptor) {
  ensureSocketOpen();
  replicas.delete(descriptorKey(descriptor));
  socket.send(JSON.stringify({ type: 'unsubscribe', doc: toWireSelector(descriptor) }));
}

function flushSync(descriptor) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  const replica = replicas.get(descriptorKey(descriptor));
  if (!replica) {
    return;
  }
  while (true) {
    const [nextState, message] = AutomergeLib.generateSyncMessage(replica.doc, replica.syncState);
    replica.syncState = nextState;
    if (!message) {
      break;
    }
    socket.send(
      JSON.stringify({
        type: 'sync',
        doc: toWireSelector(descriptor),
        data: uint8ArrayToBase64(message)
      })
    );
  }
}

function requestFullState(descriptor) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify({ type: 'request_full_state', doc: toWireSelector(descriptor) }));
}

function descriptorKey(descriptor) {
  switch (descriptor.kind) {
    case 'registry':
      return 'registry';
    case 'bulletins':
      return 'bulletins';
    case 'list':
      return `list:${descriptor.listId}`;
    default:
      return 'unknown';
  }
}

function toWireSelector(descriptor) {
  switch (descriptor.kind) {
    case 'registry':
      return 'registry';
    case 'bulletins':
      return 'bulletins';
    case 'list':
      return { listId: descriptor.listId };
    default:
      return 'registry';
  }
}

function parseServerDescriptor(docSelector) {
  if (docSelector === 'registry') {
    return { kind: 'registry' };
  }
  if (docSelector === 'bulletins') {
    return { kind: 'bulletins' };
  }
  if (docSelector && typeof docSelector === 'object' && typeof docSelector.listId === 'string') {
    return { kind: 'list', listId: docSelector.listId };
  }
  throw new Error('Unknown document selector');
}

function sendRegistryAction(action) {
  ensureSocketOpen();
  socket.send(JSON.stringify({ type: 'registry_action', action }));
}

function sendListAction(listId, action) {
  ensureSocketOpen();
  socket.send(JSON.stringify({ type: 'list_action', listId, action }));
}

function sendBulletinAction(action) {
  ensureSocketOpen();
  socket.send(JSON.stringify({ type: 'bulletin_action', action }));
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

connectBtn.addEventListener('click', connect);
disconnectBtn.addEventListener('click', disconnect);
closeListBtn.addEventListener('click', closeList);

createListForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = listNameInput.value.trim();
  const visibility = listVisibilitySelect.value;
  if (!name) {
    showMessage('List name required', true);
    return;
  }
  try {
    sendRegistryAction({ type: 'create_list', name, visibility });
    listNameInput.value = '';
    listVisibilitySelect.value = 'private';
    showMessage('List created');
  } catch (error) {
    showMessage(error.message, true);
  }
});

addItemForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!activeListId) {
    showMessage('Select a list first', true);
    return;
  }
  const label = itemLabelInput.value.trim();
  const quantity = itemQuantityInput.value.trim();
  const vendor = itemVendorInput.value.trim();
  if (!label) {
    showMessage('Item name required', true);
    return;
  }
  try {
    sendListAction(activeListId, {
      type: 'add_item',
      label,
      quantity: quantity || undefined,
      vendor: vendor || undefined
    });
    itemLabelInput.value = '';
    itemQuantityInput.value = '';
    itemVendorInput.value = '';
  } catch (error) {
    showMessage(error.message, true);
  }
});

bulletinForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = bulletinTextInput.value.trim();
  const visibility = bulletinVisibilitySelect.value;
  if (!text) {
    showMessage('Bulletin text required', true);
    return;
  }
  try {
    sendBulletinAction({ type: 'add_bulletin', text, visibility });
    bulletinTextInput.value = '';
    showMessage('Bulletin posted');
  } catch (error) {
    showMessage(error.message, true);
  }
});

setConnectedState(false);
showMessage('Enter a server URL and press Connect');
