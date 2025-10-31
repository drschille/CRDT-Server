const STORAGE_KEY = 'collab-lists-login';

const authScreen = document.querySelector('#auth-screen');
const appShell = document.querySelector('#app-shell');
const loginForm = document.querySelector('#login-form');
const loginServerInput = document.querySelector('#login-server-url');
const loginUsernameInput = document.querySelector('#login-username');
const logoutBtn = document.querySelector('#logout-btn');

const navButtons = Array.from(document.querySelectorAll('.nav-btn[data-view]'));
const views = {
  lists: document.querySelector('#lists-view'),
  bulletins: document.querySelector('#bulletins-view')
};

const connectionStatusEl = document.querySelector('#connection-status');
const connectionLabelEl = document.querySelector('#connection-label');
const currentUserEl = document.querySelector('#current-user');
const messagesEl = document.querySelector('#messages');

const listsContainer = document.querySelector('#lists');
const listsEmptyState = document.querySelector('#lists-empty');
const createListForm = document.querySelector('#create-list-form');
const listNameInput = document.querySelector('#list-name');
const listVisibilitySelect = document.querySelector('#list-visibility');

const closeListBtn = document.querySelector('#close-list-btn');
const listEmptyEl = document.querySelector('#list-empty');
const listContentEl = document.querySelector('#list-content');
const activeListNameEl = document.querySelector('#active-list-name');
const activeListMetaEl = document.querySelector('#active-list-meta');
const addItemForm = document.querySelector('#add-item-form');
const itemLabelInput = document.querySelector('#item-label');
const itemQuantityInput = document.querySelector('#item-quantity');
const itemVendorInput = document.querySelector('#item-vendor');
const itemsContainer = document.querySelector('#items');

const bulletinForm = document.querySelector('#bulletin-form');
const bulletinTextInput = document.querySelector('#bulletin-text');
const bulletinVisibilitySelect = document.querySelector('#bulletin-visibility');
const bulletinsEmptyState = document.querySelector('#bulletins-empty');
const bulletinListEl = document.querySelector('#bulletin-list');

let socket = null;
let currentUserId = null;

const AutomergeLib = window.Automerge;
const replicas = new Map();
const registryEntries = new Map();
const listStates = new Map();
let bulletins = [];
let activeListId = null;

const state = {
  activeView: 'lists',
  isLoggingOut: false,
  credentials: null
};

function setConnectedState(isConnected) {
  connectionStatusEl.classList.toggle('status-dot--connected', isConnected);
  connectionStatusEl.classList.toggle('status-dot--disconnected', !isConnected);
  connectionLabelEl.textContent = isConnected ? 'Connected' : 'Disconnected';
}

function showMessage(text, isError = false) {
  messagesEl.textContent = text;
  messagesEl.classList.toggle('messages--error', isError);
  if (!text) {
    messagesEl.classList.remove('messages--error');
  }
}

function showAuthScreen() {
  authScreen.classList.remove('hidden');
  appShell.classList.add('hidden');
}

function showAppShell() {
  authScreen.classList.add('hidden');
  appShell.classList.remove('hidden');
  setActiveView(state.activeView);
}

function saveCredentials(creds) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
}

function loadCredentials() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed.serverUrl) {
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn('Failed to load cached credentials', error);
    return null;
  }
}

function clearCredentials() {
  localStorage.removeItem(STORAGE_KEY);
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
  currentUserEl.textContent = currentUserId ? `Signed in as ${currentUserId}` : '';
}

function connectWithCredentials(creds) {
  state.credentials = creds;
  loginServerInput.value = creds.serverUrl;
  loginUsernameInput.value = creds.username ?? '';
  showMessage(`Connecting to ${creds.serverUrl}…`);

  if (socket) {
    socket.close();
  }
  resetClientState(false);

  let connectUrl;
  try {
    connectUrl = buildConnectUrl(creds.serverUrl, creds.username);
  } catch (error) {
    showMessage(error.message, true);
    return;
  }

  socket = new WebSocket(connectUrl);

  socket.addEventListener('open', () => {
    setConnectedState(true);
    showAppShell();
    socket.send(JSON.stringify({ type: 'hello', clientVersion: 'web-1.0-lists' }));
    showMessage('Connected');
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
    showMessage(state.isLoggingOut ? 'Logged out' : 'Disconnected from server', !state.isLoggingOut);
    resetClientState(true);
    showAuthScreen();
    state.isLoggingOut = false;
  });

  socket.addEventListener('error', (event) => {
    console.error('WebSocket error', event);
    showMessage('WebSocket error', true);
  });
}

function disconnect() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.close();
  }
  socket = null;
}

function buildConnectUrl(serverUrl, username) {
  let parsed;
  try {
    parsed = new URL(serverUrl);
  } catch {
    throw new Error('Invalid server URL');
  }

  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  }

  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    throw new Error('Server URL must begin with ws://, wss://, http://, or https://');
  }

  if (!parsed.pathname || parsed.pathname === '/') {
    parsed.pathname = '/ws';
  }

  if (username) {
    parsed.searchParams.set('username', username.trim().toLowerCase());
  } else {
    parsed.searchParams.delete('username');
  }
  return parsed.toString();
}

function handleMessage(message) {
  switch (message.type) {
    case 'welcome':
      currentUserId = message.userId;
      updateCurrentUser();
      if (state.credentials) {
        saveCredentials(state.credentials);
      }
      sendSubscribe({ kind: 'registry' });
      sendSubscribe({ kind: 'bulletins' });
      requestFullState({ kind: 'registry' });
      requestFullState({ kind: 'bulletins' });
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

function handleSnapshot(docSelector, stateData) {
  const descriptor = parseServerDescriptor(docSelector);
  switch (descriptor.kind) {
    case 'registry': {
      registryEntries.clear();
      for (const entry of Array.isArray(stateData) ? stateData : []) {
        registryEntries.set(entry.id, entry);
      }
      renderLists();
      break;
    }
    case 'bulletins': {
      bulletins = Array.isArray(stateData) ? stateData : [];
      renderBulletins();
      break;
    }
    case 'list': {
      if (stateData && stateData.listId) {
        listStates.set(stateData.listId, stateData);
        if (!activeListId) {
          activeListId = stateData.listId;
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
  const entries = Array.from(registryEntries.values()).sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
  );
  listsContainer.innerHTML = '';
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
    li.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'list-entry__meta';
    meta.innerHTML = `
      <span>Owner: ${entry.ownerId}</span>
      <span>${entry.visibility === 'public' ? 'Public' : 'Private'}</span>
      <span>Collaborators: ${Object.keys(entry.collaborators ?? {}).length}</span>
      ${entry.archived ? '<span>Archived</span>' : ''}
    `;
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

  const listState = listStates.get(activeListId);
  if (!listState || listState.items.length === 0) {
    listEmptyEl.classList.remove('hidden');
    listContentEl.classList.add('hidden');
    itemsContainer.innerHTML = '';
    return;
  }

  listEmptyEl.classList.add('hidden');
  listContentEl.classList.remove('hidden');

  itemsContainer.innerHTML = '';
  for (const item of listState.items) {
    const li = document.createElement('li');

    const main = document.createElement('div');
    main.className = 'item-main';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(item.checked);
    checkbox.addEventListener('change', () =>
      sendListAction(activeListId, {
        type: 'toggle_item_checked',
        itemId: item.id,
        checked: checkbox.checked
      })
    );

    const info = document.createElement('div');
    info.className = 'item-info';

    const label = document.createElement('span');
    label.className = 'item-label';
    if (item.checked) {
      label.classList.add('checked');
    }
    label.textContent = item.label;
    info.appendChild(label);

    const meta = document.createElement('div');
    meta.className = 'item-meta';
    const parts = [];
    parts.push(`Added by ${item.addedBy}`);
    if (item.quantity) {
      parts.push(`Qty: ${item.quantity}`);
    }
    if (item.vendor) {
      parts.push(`Vendor: ${item.vendor}`);
    }
    if (item.notes) {
      parts.push(`Notes: ${item.notes}`);
    }
    meta.textContent = parts.join(' • ');
    info.appendChild(meta);

    main.appendChild(checkbox);
    main.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'item-actions';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'icon-btn';
    removeBtn.setAttribute('aria-label', 'Remove item');
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () =>
      sendListAction(activeListId, { type: 'remove_item', itemId: item.id })
    );

    actions.appendChild(removeBtn);

    li.appendChild(main);
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
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  ensureReplica(descriptor);
  if (descriptor.kind !== 'lists-registry-initial') {
    socket.send(JSON.stringify({ type: 'subscribe', doc: toWireSelector(descriptor) }));
  }
  flushSync(descriptor);
}

function sendUnsubscribe(descriptor) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
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

function ensureSocketOpen() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error('WebSocket not connected');
  }
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

function setActiveView(view) {
  state.activeView = view;
  navButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  views.lists.classList.toggle('hidden', view !== 'lists');
  views.bulletins.classList.toggle('hidden', view !== 'bulletins');
}

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const serverUrl = loginServerInput.value.trim();
  const username = loginUsernameInput.value.trim().toLowerCase();
  if (!serverUrl) {
    showMessage('Server URL is required', true);
    return;
  }
  const creds = { serverUrl, username: username || null };
  connectWithCredentials(creds);
});

logoutBtn.addEventListener('click', () => {
  state.isLoggingOut = true;
  clearCredentials();
  disconnect();
});

navButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    if (view) {
      setActiveView(view);
    }
  });
});

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

closeListBtn.addEventListener('click', closeList);

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

const savedCredentials = loadCredentials();
if (savedCredentials) {
  state.activeView = 'lists';
  loginServerInput.value = savedCredentials.serverUrl;
  loginUsernameInput.value = savedCredentials.username ?? '';
  connectWithCredentials(savedCredentials);
} else {
  showAuthScreen();
  setActiveView('lists');
}
