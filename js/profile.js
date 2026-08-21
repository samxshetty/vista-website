/* Profile page — view + edit the logged-in user's public.profiles row.
   Requires js/supabase-client.js and js/auth.js loaded first. */
(function () {
  const card = document.getElementById('profilePageCard');
  if (!card) return;

  const ROLE_LABEL = { member: 'Member', coordinator: 'Coordinator', admin: 'Admin' };

  function initials(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  }

  function avatarHtml(profile) {
    if (profile.avatar_url) {
      return `<img class="profile-avatar" src="${profile.avatar_url}" alt="Avatar">`;
    }
    return `<div class="profile-avatar">${initials(profile.full_name)}</div>`;
  }

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

  async function loadRegistrations(userId) {
    const { data, error } = await sb
      .from('registrations')
      .select('id, status, event_id, team_id, events(name, slug), teams(team_name, code, is_finalized)')
      .eq('profile_id', userId)
      .order('registered_at', { ascending: false });
    if (error) { console.error('loadRegistrations error', error); return []; }
    return data || [];
  }

  function regRowHtml(reg) {
    const eventName = reg.events ? reg.events.name : 'Unknown event';
    const isFinalized = reg.status === 'finalized';
    let sub = '';
    if (reg.teams) {
      sub = `Team "${reg.teams.team_name}" · code ${reg.teams.code}`;
    } else {
      sub = 'Solo registration';
    }
    return `
      <div class="reg-row">
        <div class="reg-row-info">
          <div class="reg-row-name">${eventName}</div>
          <div class="reg-row-sub">${sub}</div>
        </div>
        <span class="reg-status ${isFinalized ? 'finalized' : 'pending'}">${isFinalized ? 'Finalized' : 'Pending'}</span>
      </div>
    `;
  }

  async function renderView(profile, email, userId) {
    const role = profile.role || 'member';
    card.innerHTML = `
      <div class="profile-header">
        <div class="profile-avatar-wrap">
          ${avatarHtml(profile)}
          <label class="profile-avatar-edit" title="Change avatar">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none"><path d="M4 20h4l10-10-4-4L4 16v4z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
            <input type="file" id="avatarInput" accept="image/*">
          </label>
        </div>
        <div class="profile-heading">
          <h1>${profile.full_name || 'My Profile'}</h1>
          <p class="auth-sub">${email}</p>
          <span class="role-badge">${ROLE_LABEL[role] || role}</span>
        </div>
      </div>

      <div class="profile-info-grid">
        <div class="info-cell"><span class="info-label">USN / ID</span><span class="info-value">${profile.usn || '—'}</span></div>
        <div class="info-cell"><span class="info-label">Semester</span><span class="info-value">${profile.semester || '—'}</span></div>
        <div class="info-cell"><span class="info-label">Section</span><span class="info-value">${profile.section || '—'}</span></div>
        <div class="info-cell"><span class="info-label">Phone</span><span class="info-value">${profile.phone || '—'}</span></div>
      </div>

      <div class="modal-actions">
        <button class="btn-primary" id="editProfileBtn" type="button" style="width:100%">Edit profile</button>
      </div>

      <div class="profile-section-title">My Registrations</div>
      <div id="regList"><p class="empty-note">Loading…</p></div>
    `;

    document.getElementById('editProfileBtn').addEventListener('click', () => renderEdit(profile, email, userId));

    const avatarInput = document.getElementById('avatarInput');
    avatarInput.addEventListener('change', () => handleAvatarUpload(avatarInput, profile, email, userId));

    const regList = document.getElementById('regList');
    const regs = await loadRegistrations(userId);
    regList.innerHTML = regs.length
      ? regs.map(regRowHtml).join('')
      : `<p class="empty-note">You haven't registered for any events yet.</p>`;
  }

  async function handleAvatarUpload(input, profile, email, userId) {
    const file = input.files && input.files[0];
    if (!file) return;

    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${userId}/avatar.${ext}`;

    const { error: uploadError } = await sb.storage
      .from('avatars')
      .upload(path, file, { upsert: true, cacheControl: '3600' });

    if (uploadError) {
      alert('Avatar upload failed: ' + uploadError.message);
      return;
    }

    const { data: pub } = sb.storage.from('avatars').getPublicUrl(path);
    // Cache-bust so the new image shows immediately even if the filename is unchanged.
    const url = pub.publicUrl + '?t=' + Date.now();

    const { error: updateError } = await sb.from('profiles').update({ avatar_url: url }).eq('id', userId);
    if (updateError) {
      alert('Saved image but failed to update profile: ' + updateError.message);
      return;
    }

    const updated = await VistaAuth.loadProfile();
    renderView(updated, email, userId);
  }

  function renderEdit(profile, email, userId) {
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
    document.getElementById('cancelEditBtn').addEventListener('click', () => renderView(profile, email, userId));

    document.getElementById('editProfileForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const submitBtn = e.target.querySelector('.btn-primary');
      const errorEl = document.getElementById('editProfileError');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving...';

      const { error } = await sb.from('profiles').update({
        full_name: fd.get('full_name').trim(),
        usn: fd.get('usn').trim(),
        semester: parseInt(fd.get('semester'), 10),
        section: fd.get('section').trim(),
        phone: fd.get('phone').trim() || null
      }).eq('id', userId);

      submitBtn.disabled = false;
      submitBtn.textContent = 'Save changes';

      if (error) {
        errorEl.textContent = error.message.includes('duplicate') ? 'That USN is already registered to another account.' : error.message;
        errorEl.classList.add('show');
        return;
      }

      const updated = await VistaAuth.loadProfile();
      renderView(updated, email, userId);
    });
  }

  (async function init() {
    await VistaAuth.ready;
    if (!VistaAuth.isLoggedIn()) { renderLoggedOut(); return; }
    const user = VistaAuth.currentUser();
    renderView(user.profile || {}, user.email, user.id);
  })();

  // If login state changes on this page (e.g. logout in another tab).
  document.addEventListener('vista-auth-changed', () => {
    if (!VistaAuth.isLoggedIn()) { renderLoggedOut(); return; }
    const user = VistaAuth.currentUser();
    renderView(user.profile || {}, user.email, user.id);
  });
})();
