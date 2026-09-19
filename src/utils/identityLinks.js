// Email-link secrets live only in module memory, never in browser storage or HTTP URLs.
let current = { path: '', token: '' };
export function readIdentityLink(location = window.location, history = window.history) {
  const token = new URLSearchParams(location.hash.slice(1)).get('token');
  if (token) {
    current = { path: location.pathname, token };
    history.replaceState(null, '', location.pathname);
  }
  return current.path === location.pathname ? current.token : '';
}
export function clearIdentityLink() { current = { path: '', token: '' }; }
