export const money = value => Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
export function profileAvatar(url, fallback = 'V', className = 'avatar') {
  const initials = escapeHtml(String(fallback || 'V').trim().slice(0, 1).toUpperCase());
  if (!url) return `<div class="${escapeHtml(className)}" aria-label="Foto de perfil indisponível">${initials}</div>`;
  return `<div class="${escapeHtml(className)} profile-avatar"><img src="${escapeHtml(url)}" alt="Foto de perfil" data-profile-avatar><span hidden>${initials}</span></div>`;
}
export function bindProfileAvatarFallbacks(root = document) {
  root.querySelectorAll('[data-profile-avatar]').forEach(image => {
    image.addEventListener('error', () => {
      image.hidden = true;
      image.nextElementSibling.hidden = false;
    }, { once: true });
  });
}
export function showToast(message, kind = 'info') {
  let toast = document.querySelector('#toast');
  if (!toast) { toast = document.createElement('div'); toast.id = 'toast'; toast.className = 'toast'; document.body.append(toast); }
  toast.textContent = message; toast.dataset.kind = kind; toast.classList.add('visible');
  window.clearTimeout(showToast.timer); showToast.timer = window.setTimeout(() => toast.classList.remove('visible'), 3800);
}
export function setActiveNav(container, view) {
  container.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
}
