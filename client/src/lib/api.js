// In production (Firebase Hosting), VITE_API_URL points to the Render backend.
// In local dev, empty string — Vite proxy forwards /api/* to localhost:4000.
const base = import.meta.env.VITE_API_URL || '';

const TOKEN_KEY = 'fc_token';
export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

async function req(path, options = {}) {
  const token = tokenStore.get();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(base + path, {
    credentials: 'include',
    headers,
    ...options,
  });
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    tokenStore.clear();
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  auth: {
    me:     () => req('/api/auth/me'),
    login:  (email, password) =>
      req('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
    logout: () => req('/api/auth/logout', { method: 'POST' }),
    forgot: (email) =>
      req('/api/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) }),
    reset:  (token, password) =>
      req(`/api/auth/reset/${encodeURIComponent(token)}`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      }),
  },
  whatsapp: {
    status: () => req('/api/whatsapp/status'),
    connect: () => req('/api/whatsapp/connect', { method: 'POST' }),
    logout: () => req('/api/whatsapp/logout', { method: 'POST' }),
    send: (phone, text) =>
      req('/api/whatsapp/send', { method: 'POST', body: JSON.stringify({ phone, text }) }),
    resolveContacts: () => req('/api/whatsapp/resolve-contacts', { method: 'POST' }),
  },
  flows: {
    list: () => req('/api/flows'),
    get: (id) => req(`/api/flows/${id}`),
    create: (data) => req('/api/flows', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => req(`/api/flows/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => req(`/api/flows/${id}`, { method: 'DELETE' }),
    addTrigger: (id, data) =>
      req(`/api/flows/${id}/triggers`, { method: 'POST', body: JSON.stringify(data) }),
    removeTrigger: (triggerId) => req(`/api/flows/triggers/${triggerId}`, { method: 'DELETE' }),
    test: (id, phone) =>
      req(`/api/flows/${id}/test`, { method: 'POST', body: JSON.stringify({ phone }) }),
  },
  contacts: {
    list: () => req('/api/contacts'),
    create: (data) => req('/api/contacts', { method: 'POST', body: JSON.stringify(data) }),
    remove: (id) => req(`/api/contacts/${id}`, { method: 'DELETE' }),
    import: async (file) => {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/contacts/import', { method: 'POST', credentials: 'include', body: fd });
      if (!res.ok) throw new Error('import failed');
      return res.json();
    },
  },
  broadcasts: {
    list: () => req('/api/broadcasts'),
    get: (id) => req(`/api/broadcasts/${id}`),
    create: (data) => req('/api/broadcasts', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) =>
      req(`/api/broadcasts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    start: (id) => req(`/api/broadcasts/${id}/start`, { method: 'POST' }),
    pause: (id) => req(`/api/broadcasts/${id}/pause`, { method: 'POST' }),
    retryFailed: (id) => req(`/api/broadcasts/${id}/retry-failed`, { method: 'POST' }),
    sendNow: (id) => req(`/api/broadcasts/${id}/send-now`, { method: 'POST' }),
    remove: (id) => req(`/api/broadcasts/${id}`, { method: 'DELETE' }),
  },
  messages: {
    list: (phone) => req(`/api/messages${phone ? `?phone=${encodeURIComponent(phone)}` : ''}`),
    threads: () => req('/api/messages/threads'),
    markRead: (phone) =>
      req('/api/messages/mark-read', { method: 'POST', body: JSON.stringify({ phone }) }),
  },
  people: {
    get: (phone) => req(`/api/people/${encodeURIComponent(phone)}`),
    runFlow: (phone, flowId) =>
      req(`/api/people/${encodeURIComponent(phone)}/run-flow`, {
        method: 'POST',
        body: JSON.stringify({ flowId }),
      }),
    subscribe: (phone, sequenceId) =>
      req(`/api/people/${encodeURIComponent(phone)}/subscribe`, {
        method: 'POST',
        body: JSON.stringify({ sequenceId }),
      }),
    unsubscribe: (phone, sequenceId) =>
      req(`/api/people/${encodeURIComponent(phone)}/unsubscribe`, {
        method: 'POST',
        body: JSON.stringify({ sequenceId }),
      }),
    setAttribute: (phone, key, value) =>
      req(`/api/people/${encodeURIComponent(phone)}/attributes`, {
        method: 'POST',
        body: JSON.stringify({ key, value }),
      }),
    removeAttribute: (phone, key) =>
      req(`/api/people/${encodeURIComponent(phone)}/attributes/${encodeURIComponent(key)}`, {
        method: 'DELETE',
      }),
  },
  sequences: {
    list: () => req('/api/sequences'),
    get: (id) => req(`/api/sequences/${id}`),
    create: (data) => req('/api/sequences', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => req(`/api/sequences/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => req(`/api/sequences/${id}`, { method: 'DELETE' }),
    addQueue: (id, data) =>
      req(`/api/sequences/${id}/queues`, { method: 'POST', body: JSON.stringify(data) }),
    updateQueue: (queueId, data) =>
      req(`/api/sequences/queues/${queueId}`, { method: 'PUT', body: JSON.stringify(data) }),
    removeQueue: (queueId) => req(`/api/sequences/queues/${queueId}`, { method: 'DELETE' }),
    subscribe: (id, phone) =>
      req(`/api/sequences/${id}/subscribe`, { method: 'POST', body: JSON.stringify({ phone }) }),
  },
  lists: {
    list: () => req('/api/lists'),
    get: (id) => req(`/api/lists/${id}`),
    create: (data) => req('/api/lists', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => req(`/api/lists/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => req(`/api/lists/${id}`, { method: 'DELETE' }),
    addMember: (id, data) =>
      req(`/api/lists/${id}/members`, { method: 'POST', body: JSON.stringify(data) }),
    removeMember: (id, memberId) =>
      req(`/api/lists/${id}/members/${memberId}`, { method: 'DELETE' }),
    import: async (id, file, defaultCountryCode = '60') => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('defaultCountryCode', defaultCountryCode);
      const res = await fetch(`/api/lists/${id}/members/import`, { method: 'POST', credentials: 'include', body: fd });
      if (!res.ok) throw new Error('import failed');
      return res.json();
    },
  },
  uploads: {
    upload: async (file, onProgress) => {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/uploads', { method: 'POST', credentials: 'include', body: fd });
      if (!res.ok) throw new Error('upload failed');
      return res.json();
    },
  },
  quickReplies: {
    list: () => req('/api/quick-replies'),
    create: (data) => req('/api/quick-replies', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => req(`/api/quick-replies/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => req(`/api/quick-replies/${id}`, { method: 'DELETE' }),
    send: (id, phone) => req(`/api/quick-replies/${id}/send`, { method: 'POST', body: JSON.stringify({ phone }) }),
  },
  attributes: {
    list: (phone) => req(`/api/attributes/${encodeURIComponent(phone)}`),
    set: (phone, key, value) =>
      req(`/api/attributes/${encodeURIComponent(phone)}`, {
        method: 'POST',
        body: JSON.stringify({ key, value }),
      }),
    remove: (phone, key) =>
      req(`/api/attributes/${encodeURIComponent(phone)}/${encodeURIComponent(key)}`, {
        method: 'DELETE',
      }),
  },
};
