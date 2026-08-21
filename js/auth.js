/* ==========================================================================
   Session / auth-gating helpers — backed by real Supabase Auth.
   --------------------------------------------------------------------------
   Requires supabase-js (CDN) + js/supabase-client.js (which exposes `sb`)
   loaded on the page BEFORE this file.

   Public interface:
     VistaAuth.isLoggedIn()
     VistaAuth.currentUser()      -> { email, id, raw, profile } | null
     VistaAuth.loadProfile()      -> re-fetches public.profiles row, caches it
     VistaAuth.logout()
     VistaAuth.renderNavState()
     VistaAuth.ready              -> Promise, resolves once initial session
                                      check + profile load is done

   Events dispatched on `document`:
     'vista-auth-changed'   -> login, logout, or profile updated
     'vista-password-recovery' -> user clicked a password-reset email link
   ========================================================================== */
window.VistaAuth = (function () {
  let _session = null;
  let _profile = null; // row from public.profiles for the current user

  function isLoggedIn() {
    return !!_session;
  }

  function currentUser() {
    if (!_session || !_session.user) return null;
    return { email: _session.user.email, id: _session.user.id, raw: _session.user, profile: _profile };
  }

  // Fetches this user's public.profiles row and caches it. Call again
  // after editing the profile so currentUser().profile stays fresh.
  async function loadProfile() {
    if (!_session || !_session.user) { _profile = null; return null; }
    const { data, error } = await sb
      .from('profiles')
      .select('*')
      .eq('id', _session.user.id)
      .single();
    if (error) { console.error('loadProfile error', error); return null; }
    _profile = data;
    return _profile;
  }

  async function initSession() {
    const { data } = await sb.auth.getSession();
    _session = data.session;
    if (_session) await loadProfile();
    renderNavState();
    return _session;
  }

  function logout() {
    sb.auth.signOut().then(() => {
      _session = null;
      _profile = null;
      renderNavState();
      document.dispatchEvent(new CustomEvent('vista-auth-changed'));
      window.location.href = getRootPath() + 'index.html';
    });
  }

  function renderNavState() {
    document.querySelectorAll('#navLoginBtn').forEach(btn => {
      const actions = btn.closest('.nav-actions');

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

        // Add a "Profile" link next to it, if not already there.
        if (actions && !actions.querySelector('#navProfileBtn')) {
          const link = document.createElement('a');
          link.id = 'navProfileBtn';
          link.className = 'login-btn';
          link.textContent = 'Profile';
          link.href = getRootPath() + 'profile/index.html';
          actions.insertBefore(link, btn);
        }
      } else {
        btn.textContent = 'Login';
        btn.classList.remove('is-logged-in');
        btn.onclick = null;
        btn.href = getLoginHref();

        const existingProfileLink = actions && actions.querySelector('#navProfileBtn');
        if (existingProfileLink) existingProfileLink.remove();
      }
    });
  }

  // Figures out the relative path back to /login/index.html (and site
  // root) from wherever this page lives, based on the nav login button's
  // original href (already at the right depth for this page).
  function getLoginHref() {
    const existing = document.querySelector('#navLoginBtn');
    if (existing && existing.dataset.loginHref) return existing.dataset.loginHref;
    return existing ? existing.getAttribute('href') : 'login/index.html';
  }
  function getRootPath() {
    const href = getLoginHref();
    return href.replace(/login\/index\.html$/, '');
  }

  // Cache each nav button's original href before we start swapping it.
  document.querySelectorAll('#navLoginBtn').forEach(btn => {
    btn.dataset.loginHref = btn.getAttribute('href');
  });

  // Kick off the initial session check; exposed as `ready` (a Promise, not
  // a function) so other scripts can `await VistaAuth.ready`.
  const readyPromise = initSession();

  sb.auth.onAuthStateChange(async (event, session) => {
    _session = session;
    if (event === 'PASSWORD_RECOVERY') {
      // Supabase has already created a temporary session from the reset-
      // password email link. Let the login page know it should show a
      // "set new password" form instead of the normal login form.
      document.dispatchEvent(new CustomEvent('vista-password-recovery'));
      return;
    }
    if (session) await loadProfile(); else _profile = null;
    renderNavState();
    document.dispatchEvent(new CustomEvent('vista-auth-changed'));
  });

  return {
    isLoggedIn,
    currentUser,
    loadProfile,
    logout,
    renderNavState,
    ready: readyPromise
  };
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
    window.location.href = redirect ? decodeURIComponent(redirect) : '../profile/index.html';
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

    // redirectTo must be an allowed Redirect URL in Supabase ->
    // Authentication -> URL Configuration, or Supabase will silently
    // reject / fall back to the Site URL. This link lands the user back
    // on the login page with a recovery session, which triggers the
    // "set new password" form below.
    await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/login/index.html',
    });

    submitBtn.disabled = false;
    submitBtn.textContent = 'Send Reset Link';
    // Always show the same success note whether or not the email exists —
    // don't leak which emails are registered.
    noteEl.classList.add('show');
    form.reset();
  });
})();

/* Set-new-password form — shown on the login page after a password-reset
   email link is clicked (Supabase fires PASSWORD_RECOVERY, auth.js above
   dispatches 'vista-password-recovery'). Built by swapping the login
   form's contents rather than needing a separate HTML page. */
document.addEventListener('vista-password-recovery', function () {
  const card = document.querySelector('.auth-card');
  if (!card) return; // only relevant on the login page

  card.innerHTML = `
    <span class="eyebrow-label mono">Set a new password</span>
    <h1>Choose a password</h1>
    <p class="auth-sub">You're verified — set a new password for your account.</p>
    <form class="auth-form" id="newPasswordForm">
      <div class="form-group">
        <label for="newPassword">New password</label>
        <input type="password" id="newPassword" name="newPassword" placeholder="At least 8 characters" required minlength="8" autocomplete="new-password">
      </div>
      <div class="form-group">
        <label for="confirmPassword">Confirm password</label>
        <input type="password" id="confirmPassword" name="confirmPassword" placeholder="••••••••" required minlength="8" autocomplete="new-password">
      </div>
      <span class="auth-error" id="newPasswordError"></span>
      <button type="submit" class="auth-submit">Set password & continue</button>
    </form>
  `;

  const form = document.getElementById('newPasswordForm');
  const errorEl = document.getElementById('newPasswordError');
  const submitBtn = form.querySelector('.auth-submit');

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    errorEl.classList.remove('show');

    const pw = form.newPassword.value;
    const confirm = form.confirmPassword.value;

    if (pw !== confirm) {
      errorEl.textContent = "Passwords don't match.";
      errorEl.classList.add('show');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    const { error } = await sb.auth.updateUser({ password: pw });

    submitBtn.disabled = false;
    submitBtn.textContent = 'Set password & continue';

    if (error) {
      errorEl.textContent = error.message;
      errorEl.classList.add('show');
      return;
    }

    window.location.href = '../profile/index.html';
  });
});
