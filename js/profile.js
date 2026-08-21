/* Profile page — view + edit the logged-in user's public.profiles row.
   Requires js/supabase-client.js and js/auth.js loaded first. */
(function () {
  const card = document.getElementById('profilePageCard');
  if (!card) return;

  function renderLoggedOut() {
    card.innerHTML = `
      <span class="eyebrow-label mono">Login required</span>
      <h1>My Profile</h1>
      <p class="auth-sub">You need to be logged in to view your profile.</p>
      <div class="modal-actions">
        <a class="btn-primary" href="../login/index.html?redirect=${encodeURIComponent('../profile/index.html')}">Login</a>
      </div>
    `;
  }

  function renderView(profile, email) {
    card.innerHTML = `
      <span class="eyebrow-label mono">Your account</span>
      <h1>My Profile</h1>
      <p class="auth-sub">${email}</p>
      <div class="member-list" style="margin:20px 0;">
        <div class="member-row"><div class="member-info"><span class="member-name">Full name</span><span class="member-sub">${profile.full_name || '—'}</span></div></div>
        <div class="member-row"><div class="member-info"><span class="member-name">USN / ID</span><span class="member-sub">${profile.usn || '—'}</span></div></div>
        <div class="member-row"><div class="member-info"><span class="member-name">Semester</span><span class="member-sub">${profile.semester || '—'}</span></div></div>
        <div class="member-row"><div class="member-info"><span class="member-name">Section</span><span class="member-sub">${profile.section || '—'}</span></div></div>
        <div class="member-row"><div class="member-info"><span class="member-name">Phone</span><span class="member-sub">${profile.phone || '—'}</span></div></div>
      </div>
      <div class="modal-actions">
        <button class="btn-primary" id="editProfileBtn" type="button" style="width:100%">Edit profile</button>
      </div>
    `;
    document.getElementById('editProfileBtn').addEventListener('click', () => renderEdit(profile, email));
  }

  function renderEdit(profile, email) {
    card.innerHTML = `
      <span class="eyebrow-label mono">Edit</span>
      <h1>My Profile</h1>
      <p class="auth-sub">${email}</p>
      <form class="auth-form" id="editProfileForm">
        <div class="form-group"><label>Full name</label><input required name="full_name" value="${profile.full_name || ''}" placeholder="Full name"></div>
        <div class="form-group"><label>USN / ID</label><input required name="usn" value="${(profile.usn && !profile.usn.startsWith('PENDING-')) ? profile.usn : ''}" placeholder="NNM23IS000"></div>
        <div class="form-group"><label>Semester</label>
          <select required name="semester">
            ${[1,2,3,4,5,6,7,8].map(s => `<option value="${s}" ${profile.semester === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Section</label><input required name="section" value="${profile.section || ''}" placeholder="e.g. A"></div>
        <div class="form-group"><label>Phone (optional)</label><input name="phone" value="${profile.phone || ''}" placeholder="10-digit number"></div>
        <span class="auth-error" id="editProfileError"></span>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" id="cancelEditBtn">Cancel</button>
          <button type="submit" class="btn-primary">Save changes</button>
        </div>
      </form>
    `;
    document.getElementById('cancelEditBtn').addEventListener('click', () => renderView(profile, email));

    document.getElementById('editProfileForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const submitBtn = e.target.querySelector('.btn-primary');
      const errorEl = document.getElementById('editProfileError');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving...';

      const user = VistaAuth.currentUser();
      const { error } = await sb.from('profiles').update({
        full_name: fd.get('full_name').trim(),
        usn: fd.get('usn').trim(),
        semester: parseInt(fd.get('semester'), 10),
        section: fd.get('section').trim(),
        phone: fd.get('phone').trim() || null
      }).eq('id', user.id);

      submitBtn.disabled = false;
      submitBtn.textContent = 'Save changes';

      if (error) {
        errorEl.textContent = error.message.includes('duplicate') ? 'That USN is already registered to another account.' : error.message;
        errorEl.classList.add('show');
        return;
      }

      const updated = await VistaAuth.loadProfile();
      renderView(updated, email);
    });
  }

  (async function init() {
    await VistaAuth.ready;
    if (!VistaAuth.isLoggedIn()) { renderLoggedOut(); return; }
    const user = VistaAuth.currentUser();
    renderView(user.profile || {}, user.email);
  })();

  // If login state changes on this page (e.g. logout in another tab).
  document.addEventListener('vista-auth-changed', () => {
    if (!VistaAuth.isLoggedIn()) { renderLoggedOut(); return; }
    const user = VistaAuth.currentUser();
    renderView(user.profile || {}, user.email);
  });
})();
