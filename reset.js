const resetToken = new URLSearchParams(window.location.search).get('token') || '';
const $reset = selector => document.querySelector(selector);

document.querySelectorAll('[data-password-target]').forEach(button => button.addEventListener('click', () => {
  const field = document.getElementById(button.dataset.passwordTarget);
  const visible = field.type === 'password';
  field.type = visible ? 'text' : 'password';
  button.textContent = visible ? 'Ocultar' : 'Mostrar';
  button.setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
}));

async function validateResetLink() {
  if (!resetToken) {
    $reset('#resetChecking').classList.add('hidden');
    $reset('#resetInvalid').classList.remove('hidden');
    return;
  }
  try {
    const response = await fetch(`/api/password-reset/validate?token=${encodeURIComponent(resetToken)}`);
    const result = await response.json();
    $reset('#resetChecking').classList.add('hidden');
    $reset(result.valid ? '#resetFormPanel' : '#resetInvalid').classList.remove('hidden');
  } catch {
    $reset('#resetChecking').classList.add('hidden');
    $reset('#resetInvalid').classList.remove('hidden');
  }
}

$reset('#resetPasswordForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const password = form.elements.password.value;
  const confirmation = form.elements.confirmPassword.value;
  const error = $reset('#resetError');
  const button = form.querySelector('button[type="submit"]');
  error.classList.add('hidden');
  if (password !== confirmation) {
    error.textContent = 'Las contraseñas no coinciden. Revísalas e inténtalo otra vez.';
    error.classList.remove('hidden');
    return;
  }
  button.disabled = true;
  button.textContent = 'Actualizando…';
  try {
    const response = await fetch('/api/password-reset/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: resetToken, password })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudo actualizar la contraseña.');
    window.history.replaceState({}, '', '/restablecer.html?listo=1');
    $reset('#resetFormPanel').classList.add('hidden');
    $reset('#resetSuccess').classList.remove('hidden');
    window.setTimeout(() => window.location.replace('/?login=1&passwordChanged=1'), 2600);
  } catch (requestError) {
    error.textContent = requestError.message;
    error.classList.remove('hidden');
    button.disabled = false;
    button.innerHTML = 'Guardar contraseña <span>→</span>';
  }
});

validateResetLink();
