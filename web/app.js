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
const statusBar = document.querySelector('#app-status');

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
const addItemButton = document.querySelector('#add-item-btn');
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

const ITEM_SYNC_DEBOUNCE_MS = 500;
const NEW_ITEM_PLACEHOLDER = 'New item';
const pendingItemActions = new Map();
let pendingNewItemFocus = null;

const renderedItemSnapshots = new Map();

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
  const hasText = Boolean(text);
  messagesEl.classList.toggle('messages--error', hasText && isError);
  if (!hasText) {
    messagesEl.classList.remove('messages--error');
  }
  messagesEl.classList.toggle('hidden', !hasText);
}

function createListItemElement(itemId) {
  const li = document.createElement('li');
  li.dataset.itemId = itemId;

  const main = document.createElement('div');
  main.className = 'item-main';
  li.appendChild(main);

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'item-checkbox';
  checkbox.dataset.itemId = itemId;
  checkbox.addEventListener('change', handleCheckboxChange);
  main.appendChild(checkbox);

  const fields = document.createElement('div');
  fields.className = 'item-fields';
  main.appendChild(fields);

  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.placeholder = 'Item name';
  labelInput.maxLength = 200;
  labelInput.className = 'item-field item-field--label';
  labelInput.dataset.itemId = itemId;
  labelInput.dataset.field = 'label';
  labelInput.addEventListener('focus', handleLabelFocus);
  labelInput.addEventListener('input', handleLabelInput);
  labelInput.addEventListener('blur', handleLabelBlur);
  labelInput.addEventListener('keydown', handleLabelKeyDown);
  fields.appendChild(labelInput);

  const fieldRow = document.createElement('div');
  fieldRow.className = 'item-field-row';
  fields.appendChild(fieldRow);

  const quantityInput = document.createElement('input');
  quantityInput.type = 'text';
  quantityInput.placeholder = 'Quantity';
  quantityInput.maxLength = 200;
  quantityInput.className = 'item-field item-field--quantity';
  quantityInput.dataset.itemId = itemId;
  quantityInput.dataset.field = 'quantity';
  quantityInput.addEventListener('input', handleQuantityInput);
  quantityInput.addEventListener('blur', handleQuantityBlur);
  quantityInput.addEventListener('keydown', handleEditableKeyDown);
  fieldRow.appendChild(quantityInput);

  const vendorInput = document.createElement('input');
  vendorInput.type = 'text';
  vendorInput.placeholder = 'Vendor';
  vendorInput.maxLength = 200;
  vendorInput.className = 'item-field item-field--vendor';
  vendorInput.dataset.itemId = itemId;
  vendorInput.dataset.field = 'vendor';
  vendorInput.addEventListener('input', handleVendorInput);
  vendorInput.addEventListener('blur', handleVendorBlur);
  vendorInput.addEventListener('keydown', handleEditableKeyDown);
  fieldRow.appendChild(vendorInput);

  const meta = document.createElement('div');
  meta.className = 'item-meta';
  fields.appendChild(meta);

  const notes = document.createElement('div');
  notes.className = 'item-notes hidden';
  notes.dataset.role = 'notes';
  fields.appendChild(notes);

  const actions = document.createElement('div');
  actions.className = 'item-actions';
  li.appendChild(actions);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'icon-btn';
  removeBtn.setAttribute('aria-label', 'Remove item');
  removeBtn.textContent = '✕';
  removeBtn.dataset.itemId = itemId;
  removeBtn.addEventListener('click', handleRemoveClick);
  actions.appendChild(removeBtn);

  return li;
}

function updateListItemElement(li, item, listReadOnly, listId) {
  li.dataset.itemId = item.id;
  li.dataset.listId = listId ?? '';

  const previousSnapshot = getRenderedItemSnapshot(listId, item.id);

  const checkbox = li.querySelector('.item-checkbox');
  if (checkbox instanceof HTMLInputElement) {
    checkbox.dataset.itemId = item.id;
    checkbox.checked = Boolean(item.checked);
    checkbox.disabled = listReadOnly;
  }

  const labelInput = li.querySelector('input[data-field="label"]');
  if (labelInput instanceof HTMLInputElement) {
    labelInput.dataset.itemId = item.id;
    labelInput.disabled = listReadOnly;
    labelInput.classList.toggle('item-field--checked', Boolean(item.checked));
    const labelFocused = document.activeElement === labelInput;
    const shouldUpdateLabel =
      !labelFocused || !previousSnapshot || labelInput.value === previousSnapshot.label;
    if (shouldUpdateLabel) {
      setInputValuePreserveCaret(labelInput, item.label);
    }
  }

  const quantityInput = li.querySelector('input[data-field="quantity"]');
  if (quantityInput instanceof HTMLInputElement) {
    quantityInput.dataset.itemId = item.id;
    quantityInput.disabled = listReadOnly;
    const quantityFocused = document.activeElement === quantityInput;
    const previousQuantity = previousSnapshot?.quantity ?? '';
    const nextQuantity = item.quantity ?? '';
    if (!quantityFocused || quantityInput.value === previousQuantity) {
      setInputValuePreserveCaret(quantityInput, nextQuantity);
    }
  }

  const vendorInput = li.querySelector('input[data-field="vendor"]');
  if (vendorInput instanceof HTMLInputElement) {
    vendorInput.dataset.itemId = item.id;
    vendorInput.disabled = listReadOnly;
    const vendorFocused = document.activeElement === vendorInput;
    const previousVendor = previousSnapshot?.vendor ?? '';
    const nextVendor = item.vendor ?? '';
    if (!vendorFocused || vendorInput.value === previousVendor) {
      setInputValuePreserveCaret(vendorInput, nextVendor);
    }
  }

  const meta = li.querySelector('.item-meta');
  if (meta) {
    meta.textContent = `Added by ${item.addedBy}`;
  }

  const notes = li.querySelector('.item-notes');
  if (notes) {
    if (item.notes) {
      notes.textContent = `Notes: ${item.notes}`;
      notes.classList.remove('hidden');
    } else {
      notes.textContent = '';
      notes.classList.add('hidden');
    }
  }

  const removeBtn = li.querySelector('.icon-btn');
  if (removeBtn instanceof HTMLButtonElement) {
    removeBtn.dataset.itemId = item.id;
    removeBtn.disabled = listReadOnly;
  }

  setRenderedItemSnapshot(listId, item);
}

function showAuthScreen() {
  authScreen.classList.remove('hidden');
  appShell.classList.add('hidden');
  statusBar?.classList.add('hidden');
}

function showAppShell() {
  authScreen.classList.add('hidden');
  appShell.classList.remove('hidden');
  statusBar?.classList.remove('hidden');
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
  pendingNewItemFocus = null;
  for (const entry of pendingItemActions.values()) {
    clearTimeout(entry.timer);
  }
  pendingItemActions.clear();
  renderedItemSnapshots.clear();
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
  pendingNewItemFocus = null;
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
  pendingNewItemFocus = null;
  renderLists();
  renderActiveList();
}

function renderActiveList() {
  addItemButton.classList.toggle('hidden', !activeListId);
  addItemButton.disabled = !activeListId;

  if (!activeListId) {
    activeListNameEl.textContent = 'Select a list';
    activeListMetaEl.textContent = '';
    listEmptyEl.textContent = 'No list selected.';
    listEmptyEl.classList.remove('hidden');
    listContentEl.classList.add('hidden');
    itemsContainer.innerHTML = '';
    return;
  }

  const entry = registryEntries.get(activeListId);
  if (!entry) {
    activeListNameEl.textContent = 'List unavailable';
    activeListMetaEl.textContent = '';
    listEmptyEl.textContent = 'List unavailable.';
    listEmptyEl.classList.remove('hidden');
    listContentEl.classList.add('hidden');
    itemsContainer.innerHTML = '';
    addItemButton.disabled = true;
    return;
  }

  activeListNameEl.textContent = entry.name;
  activeListMetaEl.textContent = `Owner: ${entry.ownerId} • Visibility: ${entry.visibility} • Collaborators: ${
    Object.keys(entry.collaborators ?? {}).length
  }`;

  const listState = listStates.get(activeListId);
  if (!listState) {
    listEmptyEl.textContent = 'Loading list...';
    listEmptyEl.classList.remove('hidden');
    listContentEl.classList.add('hidden');
    itemsContainer.innerHTML = '';
    addItemButton.disabled = true;
    return;
  }

  const canAddItems = !entry.archived;
  addItemButton.disabled = !canAddItems;
  addItemButton.title = canAddItems ? 'Add item' : 'Archived lists cannot be edited';
  const listReadOnly = entry.archived;

  listContentEl.classList.remove('hidden');

  const currentListId = activeListId;
  const existingItems = new Map();
  for (const li of itemsContainer.querySelectorAll('li[data-item-id]')) {
    existingItems.set(li.dataset.itemId ?? '', li);
  }

  if (listState.items.length === 0) {
    listEmptyEl.textContent = 'No items yet. Press + to add one.';
    listEmptyEl.classList.remove('hidden');
  } else {
    listEmptyEl.classList.add('hidden');
  }

  let index = 0;
  const toRemove = new Set(existingItems.keys());

  for (const item of listState.items) {
    let li = existingItems.get(item.id);
    if (!li) {
      li = createListItemElement(item.id);
    }
    updateListItemElement(li, item, listReadOnly, currentListId);
    const referenceNode = itemsContainer.children.item(index);
    if (referenceNode !== li) {
      itemsContainer.insertBefore(li, referenceNode ?? null);
    }
    index += 1;
    toRemove.delete(item.id);
  }

  for (const itemId of toRemove) {
    const li = existingItems.get(itemId);
    if (!li) {
      continue;
    }
    const liListId = li.dataset.listId;
    li.remove();
    if (liListId) {
      renderedItemSnapshots.delete(makeItemKey(liListId, itemId));
    }
  }

  if (pendingNewItemFocus && pendingNewItemFocus.listId === currentListId) {
    const created = listState.items.find((it) => !pendingNewItemFocus.previousIds.has(it.id));
    if (created) {
      const li = itemsContainer.querySelector(`li[data-item-id="${created.id}"]`);
      const focusInput = li?.querySelector('input[data-field="label"]');
      if (focusInput instanceof HTMLInputElement) {
        requestAnimationFrame(() => {
          focusInput.focus();
          focusInput.select();
        });
      }
      pendingNewItemFocus = null;
    }
  }
}

function handleLabelFocus(event) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement) || input.disabled) {
    return;
  }
  input.select();
  input.classList.remove('item-field--error');
}

function handleLabelInput(event) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement) || input.disabled) {
    return;
  }
  const listId = activeListId;
  const itemId = input.dataset.itemId;
  if (!listId || !itemId) {
    return;
  }
  input.classList.remove('item-field--error');
  scheduleDebouncedItemAction(listId, `${itemId}:label`, () => {
    const trimmed = input.value.trim();
    if (!trimmed) {
      return null;
    }
    const snapshot = getRenderedItemSnapshot(listId, itemId);
    if (snapshot && trimmed === snapshot.label) {
      return null;
    }
    return { action: { type: 'update_item', itemId, label: trimmed } };
  });
}

function handleLabelBlur(event) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }
  const listId = activeListId;
  const itemId = input.dataset.itemId;
  if (!listId || !itemId) {
    return;
  }
  const trimmed = input.value.trim();
  if (!trimmed) {
    const snapshot = getRenderedItemSnapshot(listId, itemId);
    input.value = snapshot?.label ?? '';
    input.classList.add('item-field--error');
    showMessage('Item name required', true);
    return;
  }
  flushDebouncedItemAction(listId, `${itemId}:label`);
}

function handleLabelKeyDown(event) {
  if (!(event.currentTarget instanceof HTMLInputElement)) {
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    event.currentTarget.blur();
  } else if (event.key === 'Escape') {
    const listId = activeListId;
    const itemId = event.currentTarget.dataset.itemId;
    if (!listId || !itemId) {
      return;
    }
    const snapshot = getRenderedItemSnapshot(listId, itemId);
    if (snapshot) {
      event.currentTarget.value = snapshot.label;
      event.currentTarget.classList.remove('item-field--error');
      event.currentTarget.blur();
    }
  }
}

function handleQuantityInput(event) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement) || input.disabled) {
    return;
  }
  const listId = activeListId;
  const itemId = input.dataset.itemId;
  if (!listId || !itemId) {
    return;
  }
  scheduleDebouncedItemAction(listId, `${itemId}:quantity`, () => {
    const trimmed = input.value.trim();
    const nextValue = trimmed;
    const snapshot = getRenderedItemSnapshot(listId, itemId);
    const previous = snapshot?.quantity ?? '';
    if (nextValue === previous) {
      return null;
    }
    return {
      action: {
        type: 'set_item_quantity',
        itemId,
        quantity: trimmed ? trimmed : undefined
      }
    };
  });
}

function handleQuantityBlur(event) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }
  const listId = activeListId;
  const itemId = input.dataset.itemId;
  if (!listId || !itemId) {
    return;
  }
  flushDebouncedItemAction(listId, `${itemId}:quantity`);
}

function handleVendorInput(event) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement) || input.disabled) {
    return;
  }
  const listId = activeListId;
  const itemId = input.dataset.itemId;
  if (!listId || !itemId) {
    return;
  }
  scheduleDebouncedItemAction(listId, `${itemId}:vendor`, () => {
    const trimmed = input.value.trim();
    const nextValue = trimmed;
    const snapshot = getRenderedItemSnapshot(listId, itemId);
    const previous = snapshot?.vendor ?? '';
    if (nextValue === previous) {
      return null;
    }
    return {
      action: {
        type: 'set_item_vendor',
        itemId,
        vendor: trimmed ? trimmed : undefined
      }
    };
  });
}

function handleVendorBlur(event) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }
  const listId = activeListId;
  const itemId = input.dataset.itemId;
  if (!listId || !itemId) {
    return;
  }
  flushDebouncedItemAction(listId, `${itemId}:vendor`);
}

function handleEditableKeyDown(event) {
  if (!(event.currentTarget instanceof HTMLInputElement)) {
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    event.currentTarget.blur();
  }
}

function handleCheckboxChange(event) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement) || input.disabled) {
    return;
  }
  if (!activeListId) {
    return;
  }
  const itemId = input.dataset.itemId;
  if (!itemId) {
    return;
  }
  const labelInput = itemsContainer.querySelector(`input[data-item-id="${itemId}"][data-field="label"]`);
  if (labelInput instanceof HTMLInputElement) {
    labelInput.classList.toggle('item-field--checked', input.checked);
  }
  try {
    sendListAction(activeListId, {
      type: 'toggle_item_checked',
      itemId,
      checked: input.checked
    });
  } catch (error) {
    showMessage(error instanceof Error ? error.message : String(error), true);
  }
}

function handleRemoveClick(event) {
  const button = event.currentTarget;
  if (!(button instanceof HTMLButtonElement) || button.disabled) {
    return;
  }
  if (!activeListId) {
    return;
  }
  const itemId = button.dataset.itemId;
  if (!itemId) {
    return;
  }
  try {
    sendListAction(activeListId, { type: 'remove_item', itemId });
  } catch (error) {
    showMessage(error instanceof Error ? error.message : String(error), true);
  }
}

function setRenderedItemSnapshot(listId, item) {
  if (!listId) {
    return;
  }
  renderedItemSnapshots.set(makeItemKey(listId, item.id), {
    label: item.label,
    quantity: item.quantity ?? '',
    vendor: item.vendor ?? '',
    checked: Boolean(item.checked)
  });
}

function getRenderedItemSnapshot(listId, itemId) {
  if (!listId) {
    return undefined;
  }
  return renderedItemSnapshots.get(makeItemKey(listId, itemId));
}

function makeItemKey(listId, itemId) {
  return `${listId}:${itemId}`;
}

function setInputValuePreserveCaret(input, nextValue) {
  if (input.value === nextValue) {
    return;
  }
  const isFocused = document.activeElement === input;
  let selectionStart = null;
  let selectionEnd = null;
  if (isFocused) {
    selectionStart = input.selectionStart;
    selectionEnd = input.selectionEnd;
  }
  input.value = nextValue;
  if (isFocused && selectionStart !== null && selectionStart !== undefined) {
    const start = Math.min(nextValue.length, selectionStart);
    const end =
      selectionEnd !== null && selectionEnd !== undefined
        ? Math.min(nextValue.length, selectionEnd)
        : start;
    try {
      input.setSelectionRange(start, end);
    } catch {
      // Ignore browsers that disallow manually setting the selection.
    }
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

function scheduleDebouncedItemAction(listId, key, build) {
  if (!listId) {
    return;
  }
  const mapKey = `${listId}:${key}`;
  const existing = pendingItemActions.get(mapKey);
  if (existing) {
    clearTimeout(existing.timer);
  }
  const timer = window.setTimeout(() => {
    runPendingItemAction(mapKey);
  }, ITEM_SYNC_DEBOUNCE_MS);
  pendingItemActions.set(mapKey, { timer, listId, build });
}

function flushDebouncedItemAction(listId, key) {
  if (!listId) {
    return;
  }
  const mapKey = `${listId}:${key}`;
  const entry = pendingItemActions.get(mapKey);
  if (!entry) {
    return;
  }
  clearTimeout(entry.timer);
  runPendingItemAction(mapKey);
}

function runPendingItemAction(mapKey) {
  const entry = pendingItemActions.get(mapKey);
  if (!entry) {
    return;
  }
  pendingItemActions.delete(mapKey);
  const result = entry.build();
  if (!result) {
    return;
  }
  if ('error' in result) {
    if (result.error) {
      showMessage(result.error, true);
    }
    return;
  }
  try {
    sendListAction(entry.listId, result.action);
  } catch (error) {
    showMessage(error instanceof Error ? error.message : String(error), true);
  }
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

addItemButton.addEventListener('click', () => {
  if (!activeListId) {
    showMessage('Select a list first', true);
    return;
  }
  const listState = listStates.get(activeListId);
  const existingIds = new Set((listState?.items ?? []).map((item) => item.id));
  try {
    pendingNewItemFocus = { listId: activeListId, previousIds: existingIds };
    sendListAction(activeListId, {
      type: 'add_item',
      label: NEW_ITEM_PLACEHOLDER
    });
  } catch (error) {
    pendingNewItemFocus = null;
    showMessage(error instanceof Error ? error.message : String(error), true);
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
