/* ==========================================================================
   Session / auth-gating helpers — now backed by real Supabase Auth.
   --------------------------------------------------------------------------
   Requires supabase-js (CDN) + js/supabase-client.js to be loaded on the
   page BEFORE this file. The public interface (VistaAuth.isLoggedIn(),
   VistaAuth.currentUser(), VistaAuth.login(), VistaAuth.logout(),
   VistaAuth.renderNavState()) is unchanged, so register.js and any other
   script that reads it keeps working. What changed is what's underneath:
   session state now lives in Supabase (cookies/localStorage it manages
   itself), not in our own 'vista_session' key, and login/logout call the
   real Auth API instead of faking it.
   ========================================================================== */
window.VistaAuth = (function () {
  let _session = null;

  function isLoggedIn() {
    return !!_session;
  }

  function currentUser() {
    if (!_session || !_session.user) return null;
    return { email: _session.user.email, id: _session.user.id, raw: _session.user };
  }

  function ready() {
    return sb.auth.getSession().then(({ data }) => {
      _session = data.session;
      renderNavState();
      return _session;
    });
  }

  function login(user) {
    renderNavState();
  }

  function logout() {
    sb.auth.signOut().then(() => {
      _session = null;
      renderNavState();
      window.location.href = getRootPath() + 'index.html';
    });
  }

  function renderNavState() {
    document.querySelectorAll('#navLoginBtn').forEach(btn => {
      if (isLoggedIn()) {
        const user = currentUser();
        btn.textContent = 'Logout';
        btn.classList.add('is-logged-in');
        btn.href = '#';
        btn.onclick = (e) => {
          e.preventDefault();
          logout();
        };
        btn.title = user && user.email ? `Signed in as ${user.email}` : 'Logout';
      } else {
        btn.textContent = 'Login';
        btn.classList.remove('is-logged-in');
        btn.onclick = null;
        btn.href = getLoginHref();
      }
    });
  }

  function getLoginHref() {
    const existing = document.querySelector('#navLoginBtn');
    if (existing && existing.dataset.loginHref) return existing.dataset.loginHref;
    return existing ? existing.getAttribute('href') : 'login/index.html';
  }
  function getRootPath() {
    const href = getLoginHref();
    return href.replace(/login\/index\.html$/, '');
  }

  document.querySelectorAll('#navLoginBtn').forEach(btn => {
    btn.dataset.loginHref = btn.getAttribute('href');
  });

  ready();

  sb.auth.onAuthStateChange((_event, session) => {
    _session = session;
    renderNavState();
  });

  return { isLoggedIn, currentUser, login, logout, renderNavState, ready };
})();

/* Login form */
(function () {
  const form = document.getElementById('loginForm');
  if (!form) return;

  const errorEl = document.getElementById('loginError');
  const submitBtn = form.querySelector('.auth-submit');

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    errorEl.classList.remove('show');

    const email = form.email.value.trim();
    const password = form.password.value;

    if (!email || !password) {
      errorEl.textContent = 'Please fill in both fields.';
      errorEl.classList.add('show');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Logging in...';

    const { error } = await sb.auth.signInWithPassword({ email, password });

    submitBtn.disabled = false;
    submitBtn.textContent = 'Login';

    if (error) {
      errorEl.textContent = error.message || 'Login failed. Check your email and password.';
      errorEl.classList.add('show');
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const redirect = params.get('redirect');
    window.location.href = redirect ? decodeURIComponent(redirect) : '../index.html';
  });
})();

/* Forgot password form */
(function () {
  const form = document.getElementById('forgotForm');
  if (!form) return;

  const noteEl = document.getElementById('forgotNote');
  const submitBtn = form.querySelector('.auth-submit');

  form.addEventListener('submit', async function (e) {
    e.preventDefault();

    const email = form.email.value.trim();
    if (!email) return;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';

    await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/login/index.html',
    });

    submitBtn.disabled = false;
    submitBtn.textContent = 'Send Reset Link';
    noteEl.classList.add('show');
    form.reset();
  });
})();