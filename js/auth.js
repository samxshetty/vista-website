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

/* Login form — doubles as sign-up.
   Flow:
   1. Try to sign in with the given email/password.
   2. If that fails (most likely: no account yet), and the email is an
      @nmamit.in address, try to create the account instead.
      - If Supabase says the account already exists, the original
        sign-in failure really was a wrong password -> show that error.
      - Otherwise a new account was just created -> continue to profile
        (a public.profiles row is created automatically by a DB trigger,
        see supabase/schema-patch-signup.sql).
   3. Any other email domain can still sign in (existing accounts, e.g.
      admin/coordinator accounts on non-nmamit.in addresses), it just
      can't be used to create a brand new account. */
(function () {
  const form = document.getElementById('loginForm');
  if (!form) return;

  const NMAMIT_DOMAIN = '@nmamit.in';
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
    submitBtn.textContent = 'Signing in...';

    let { error } = await sb.auth.signInWithPassword({ email, password });

    if (error) {
      const isNmamit = email.toLowerCase().endsWith(NMAMIT_DOMAIN);

      if (!isNmamit) {
        // Not an nmamit.in address and sign-in failed -> can't create an
        // account for it, so this is just a real login failure.
        submitBtn.disabled = false;
        submitBtn.textContent = 'Continue';
        errorEl.textContent = error.message || 'Login failed. Check your email and password.';
        errorEl.classList.add('show');
        return;
      }

      // nmamit.in address -> try creating the account.
      submitBtn.textContent = 'Setting up your account...';
      const signUpResult = await sb.auth.signUp({ email, password });

      submitBtn.disabled = false;
      submitBtn.textContent = 'Continue';

      if (signUpResult.error) {
        const msg = (signUpResult.error.message || '').toLowerCase();
        if (msg.includes('already') || msg.includes('registered')) {
          // Account exists -> the original sign-in error was a wrong password.
          errorEl.textContent = 'Incorrect password for that email.';
        } else {
          errorEl.textContent = signUpResult.error.message || 'Could not create your account.';
        }
        errorEl.classList.add('show');
        return;
      }

      if (!signUpResult.data.session) {
        // Project has "Confirm email" turned on, so Supabase won't hand
        // back a session until the user clicks the confirmation link.
        errorEl.textContent = 'Account created — check your inbox to confirm your email, then log in.';
        errorEl.classList.add('show');
        return;
      }
      // Fall through: signUp returned a live session, treat as logged in.
    } else {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Continue';
    }

    const params = new URLSearchParams(window.location.search);
    const redirect = params.get('redirect');
    window.location.href = redirect ? decodeURIComponent(redirect) : '../profile/index.html';
  });
})();

/* Forgot password form — no automated reset email. Instead this builds a
   pre-filled email (via a mailto: link) from the visitor's browser to the
   VISTA team address, who reset the password manually from the Supabase
   dashboard. Swap RESET_REQUEST_EMAIL below if that inbox ever changes. */
(function () {
  const form = document.getElementById('forgotForm');
  if (!form) return;

  const RESET_REQUEST_EMAIL = 'nn25ise182@nmamit.in';
  const noteEl = document.getElementById('forgotNote');
  const submitBtn = form.querySelector('.auth-submit');

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    const name = form.name.value.trim();
    const usn = form.usn.value.trim();
    const email = form.email.value.trim();
    if (!name || !usn || !email) return;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Opening email...';

    const subject = `VISTA password reset request — ${usn}`;
    const body =
      `Hi VISTA team,\n\nPlease reset my VISTA account password.\n\n` +
      `Name: ${name}\nUSN: ${usn}\nAccount email: ${email}\n\nThanks!`;

    const mailtoLink =
      `mailto:${RESET_REQUEST_EMAIL}` +
      `?subject=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(body)}`;

    window.location.href = mailtoLink;

    submitBtn.disabled = false;
    submitBtn.textContent = 'Send request';
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
