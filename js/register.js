/* Event registration + team create/join flow — now backed by Supabase
   (tables: events, teams, team_members, registrations, profiles), instead
   of localStorage.

   Flow (unchanged from the original UX):
   - Click "Register" -> confirm modal.
   - Solo event  -> pulls the user's details from their `profiles` row and
                    registers immediately (status 'finalized').
   - Team event  -> create (generates a code) or join (with a code). The
                    registration stays 'pending' until the team leader opens
                    "Manage team" and hits Submit — that flips the team AND
                    every member's registration to finalized.
   - Profile     -> the first time someone registers and their profile is
                    still incomplete (placeholder USN / no section), we ask
                    once and save it to public.profiles so every future
                    registration reuses it automatically.

   Requires js/supabase-client.js and js/auth.js loaded first.
*/
(function () {
  const overlay = document.getElementById('modalOverlay');
  const modalBody = document.getElementById('modalBody');
  if (!overlay || !modalBody) return;

  // slug (as used in data-event-id on the page) -> events.id (uuid)
  let eventSlugToId = {};
  // slug -> { eventId, status, teamId, code, teamName, isLeader, finalized }
  let state = {};

  /* ---------- data loading ---------- */
  async function loadEventIds() {
    const slugs = Array.from(document.querySelectorAll('.event-register-btn'))
      .map(b => b.dataset.eventId);
    if (!slugs.length) return;
    const { data, error } = await sb
      .from('events')
      .select('id, slug')
      .in('slug', slugs);
    if (error) { console.error('loadEventIds error', error); return; }
    eventSlugToId = {};
    data.forEach(e => { eventSlugToId[e.slug] = e.id; });
  }

  async function loadState() {
    state = {};
    if (!window.VistaAuth || !VistaAuth.isLoggedIn()) return;
    const user = VistaAuth.currentUser();
    const { data, error } = await sb
      .from('registrations')
      .select('event_id, status, team_id, events(slug), teams(id, code, team_name, leader_id, is_finalized)')
      .eq('profile_id', user.id);
    if (error) { console.error('loadState error', error); return; }
    data.forEach(r => {
      if (!r.events) return;
      state[r.events.slug] = {
        eventId: r.event_id,
        status: r.status,
        teamId: r.team_id,
        code: r.teams ? r.teams.code : null,
        teamName: r.teams ? r.teams.team_name : null,
        isLeader: r.teams ? r.teams.leader_id === user.id : false,
        finalized: r.teams ? r.teams.is_finalized : (r.status === 'finalized')
      };
    });
  }

  async function fetchTeamMembers(teamId) {
    const { data, error } = await sb
      .from('team_members')
      .select('profile_id, profiles(full_name, usn, semester, section)')
      .eq('team_id', teamId);
    if (error) { console.error('fetchTeamMembers error', error); return []; }
    return data;
  }

  /* ---------- modal plumbing ---------- */
  function openModal(html) {
    modalBody.innerHTML = html;
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    modalBody.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', closeModal));
  }
  function closeModal() {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    modalBody.innerHTML = '';
  }
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay.classList.contains('open')) closeModal(); });

  function errorModal(msg) {
    openModal(`
      <button class="modal-close" data-close aria-label="Close">&times;</button>
      <span class="eyebrow-label mono">Something went wrong</span>
      <h3 class="modal-title">Couldn't complete that</h3>
      <p class="modal-sub">${msg}</p>
      <div class="modal-actions"><button class="btn-primary" data-close>Close</button></div>
    `);
  }

  /* ---------- button state ---------- */
  function refreshButtons() {
    document.querySelectorAll('.event-register-btn').forEach(btn => {
      const slug = btn.dataset.eventId;
      const r = state[slug];
      btn.classList.remove('registered', 'pending');
      if (!r) {
        btn.textContent = 'Register';
        return;
      }
      if (!r.teamId) {
        btn.classList.add('registered');
        btn.textContent = 'Registered \u2713';
      } else if (r.finalized) {
        btn.classList.add('registered');
        btn.textContent = `Registered \u2713 \u00b7 ${r.teamName}`;
      } else {
        btn.classList.add('pending');
        btn.textContent = r.isLeader ? `Manage team \u00b7 ${r.teamName}` : `Pending \u00b7 ${r.teamName}`;
      }
    });
  }

  /* ---------- profile ---------- */
  function profileIncomplete(profile) {
    return !profile || !profile.full_name || !profile.usn || profile.usn.startsWith('PENDING-') || !profile.section;
  }

  function profileStep(onDone) {
    const user = VistaAuth.currentUser();
    const existing = (user && user.profile) || {};
    openModal(`
      <button class="modal-close" data-close aria-label="Close">&times;</button>
      <span class="eyebrow-label mono">One-time setup</span>
      <h3 class="modal-title">Complete your profile</h3>
      <p class="modal-sub">We'll save this and reuse it automatically for every event you register for.</p>
      <form class="auth-form" id="profileForm">
        <div class="form-group"><label>Full name</label><input required name="full_name" value="${existing.full_name || ''}" placeholder="Full name"></div>
        <div class="form-group"><label>USN / ID</label><input required name="usn" value="${(existing.usn && !existing.usn.startsWith('PENDING-')) ? existing.usn : ''}" placeholder="NNM23IS000"></div>
        <div class="form-group"><label>Semester</label>
          <select required name="semester">
            ${[1,2,3,4,5,6,7,8].map(s => `<option value="${s}" ${existing.semester === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Section</label><input required name="section" value="${existing.section || ''}" placeholder="e.g. A"></div>
        <span class="auth-error" id="profileError"></span>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" data-close>Cancel</button>
          <button type="submit" class="btn-primary">Save & continue</button>
        </div>
      </form>
    `);
    document.getElementById('profileForm').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const submitBtn = e.target.querySelector('.btn-primary');
      const errorEl = document.getElementById('profileError');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving...';
      const { error } = await sb.from('profiles').update({
        full_name: fd.get('full_name').trim(),
        usn: fd.get('usn').trim(),
        semester: parseInt(fd.get('semester'), 10),
        section: fd.get('section').trim()
      }).eq('id', user.id);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save & continue';
      if (error) {
        errorEl.textContent = error.message.includes('duplicate') ? 'That USN is already registered to another account.' : error.message;
        errorEl.classList.add('show');
        return;
      }
      await VistaAuth.loadProfile();
      onDone();
    });
  }

  function withProfile(onReady) {
    const user = VistaAuth.currentUser();
    if (!profileIncomplete(user.profile)) { onReady(); return; }
    profileStep(onReady);
  }

  function memberRow(m) {
    const p = m.profiles || {};
    const name = p.full_name || 'Member';
    const isLeaderRow = m.isLeader;
    return `
      <div class="member-row">
        <div class="member-avatar">${name.trim().charAt(0).toUpperCase()}</div>
        <div class="member-info">
          <span class="member-name">${name}${isLeaderRow ? ' <span class="member-badge">Leader</span>' : ''}</span>
          <span class="member-sub">${p.usn || ''} \u00b7 Sem ${p.semester || '-'} \u00b7 Sec ${p.section || '-'}</span>
        </div>
      </div>`;
  }

  /* ---------- steps ---------- */
  function loginRequiredStep(slug, name) {
    const here = window.location.pathname + window.location.search;
    const loginHref = document.querySelector('#navLoginBtn')?.dataset.loginHref
      || document.querySelector('#navLoginBtn')?.getAttribute('href')
      || '../login/index.html';
    const url = loginHref + '?redirect=' + encodeURIComponent(here);
    openModal(`
      <button class="modal-close" data-close aria-label="Close">&times;</button>
      <span class="eyebrow-label mono">Login required</span>
      <h3 class="modal-title">Please login to register</h3>
      <p class="modal-sub">You need to be logged in to register for ${name}. Log in and you'll be brought right back here.</p>
      <div class="modal-actions">
        <button class="btn-secondary" data-close>Cancel</button>
        <a class="btn-primary" href="${url}">Login</a>
      </div>
    `);
  }

  function confirmStep(slug, name, isTeam) {
    openModal(`
      <button class="modal-close" data-close aria-label="Close">&times;</button>
      <span class="eyebrow-label mono">Confirm</span>
      <h3 class="modal-title">Register for ${name}?</h3>
      <p class="modal-sub">You're about to register for this event${isTeam ? ' as a team' : ''}. ${isTeam ? "Next, you'll create a new team or join one with a code — using the details from your profile." : "We'll register you using the details from your profile."}</p>
      <div class="modal-actions">
        <button class="btn-secondary" data-close>Cancel</button>
        <button class="btn-primary" id="confirmYes" type="button">Yes, continue</button>
      </div>
    `);
    document.getElementById('confirmYes').addEventListener('click', () => {
      if (isTeam) teamStep(slug, name); else registerSolo(slug, name);
    });
  }

  async function registerSolo(slug, name) {
    withProfile(async () => {
      const user = VistaAuth.currentUser();
      const eventId = eventSlugToId[slug];
      const { error } = await sb.from('registrations').insert({
        event_id: eventId, profile_id: user.id, status: 'finalized'
      });
      if (error) { errorModal(error.message); return; }
      await loadState();
      refreshButtons();
      successStep(`You're registered for ${name}. See you there!`);
    });
  }

  async function genCode(eventId) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // skips ambiguous chars (0/O, 1/I)
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
      const { data } = await sb.from('teams').select('id').eq('code', code).maybeSingle();
      if (!data) return code;
    }
    throw new Error('Could not generate a unique team code, please try again.');
  }

  function teamStep(slug, name) {
    openModal(`
      <button class="modal-close" data-close aria-label="Close">&times;</button>
      <span class="eyebrow-label mono">Team registration</span>
      <h3 class="modal-title">${name}</h3>
      <div class="reg-tabs">
        <div class="reg-tab active" data-tab="create">Create team</div>
        <div class="reg-tab" data-tab="join">Join team</div>
      </div>
      <div id="tabContent"></div>
    `);

    const tabs = modalBody.querySelectorAll('.reg-tab');
    const content = document.getElementById('tabContent');

    function renderCreate() {
      content.innerHTML = `
        <form class="auth-form" id="createTeamForm">
          <div class="form-group"><label>Team name</label><input required name="teamName" placeholder="e.g. Byte Busters"></div>
          <p class="reg-form-note"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/><path d="M12 8v5M12 16h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span>You'll be added as team leader using your saved profile.</span></p>
          <span class="auth-error" id="createTeamError"></span>
          <div class="modal-actions">
            <button type="button" class="btn-secondary" data-close>Cancel</button>
            <button type="submit" class="btn-primary">Create team</button>
          </div>
        </form>`;
      content.querySelector('#createTeamForm').addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const teamName = fd.get('teamName').trim();
        const submitBtn = e.target.querySelector('.btn-primary');
        const errorEl = document.getElementById('createTeamError');
        withProfile(async () => {
          const user = VistaAuth.currentUser();
          const eventId = eventSlugToId[slug];
          submitBtn.disabled = true;
          submitBtn.textContent = 'Creating...';
          try {
            const code = await genCode(eventId);
            const { data: team, error: teamErr } = await sb
              .from('teams')
              .insert({ event_id: eventId, code, team_name: teamName, leader_id: user.id })
              .select().single();
            if (teamErr) throw teamErr;
            const { error: memberErr } = await sb.from('team_members')
              .insert({ team_id: team.id, profile_id: user.id });
            if (memberErr) throw memberErr;
            const { error: regErr } = await sb.from('registrations')
              .insert({ event_id: eventId, profile_id: user.id, team_id: team.id, status: 'pending' });
            if (regErr) throw regErr;
            await loadState();
            refreshButtons();
            codeStep(code, slug, name);
          } catch (err) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Create team';
            errorEl.textContent = err.message || 'Could not create team.';
            errorEl.classList.add('show');
          }
        });
      });
    }

    function renderJoin() {
      content.innerHTML = `
        <form class="auth-form" id="joinTeamForm">
          <div class="form-group"><label>Team code</label><input required name="code" maxlength="6" style="text-transform:uppercase;letter-spacing:.15em;font-family:'Space Mono',monospace" placeholder="ABC123"></div>
          <p class="reg-form-note"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/><path d="M12 8v5M12 16h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span>You'll join using your saved profile.</span></p>
          <div class="auth-error" id="joinError"></div>
          <div class="modal-actions">
            <button type="button" class="btn-secondary" data-close>Cancel</button>
            <button type="submit" class="btn-primary">Join team</button>
          </div>
        </form>`;
      content.querySelector('#joinTeamForm').addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const code = fd.get('code').trim().toUpperCase();
        const submitBtn = e.target.querySelector('.btn-primary');
        const errorEl = document.getElementById('joinError');

        withProfile(async () => {
          const user = VistaAuth.currentUser();
          const eventId = eventSlugToId[slug];
          submitBtn.disabled = true;
          submitBtn.textContent = 'Joining...';

          const { data: team, error: findErr } = await sb
            .from('teams').select('*').eq('code', code).eq('event_id', eventId).maybeSingle();

          if (findErr || !team) {
            submitBtn.disabled = false; submitBtn.textContent = 'Join team';
            errorEl.textContent = "That code doesn't match a team for this event. Double-check with your team leader.";
            errorEl.classList.add('show');
            return;
          }
          if (team.is_finalized) {
            submitBtn.disabled = false; submitBtn.textContent = 'Join team';
            errorEl.textContent = 'This team has already submitted its registration and is closed to new members.';
            errorEl.classList.add('show');
            return;
          }
          const { data: existingMember } = await sb
            .from('team_members').select('id').eq('team_id', team.id).eq('profile_id', user.id).maybeSingle();
          if (existingMember) {
            submitBtn.disabled = false; submitBtn.textContent = 'Join team';
            errorEl.textContent = "You've already joined this team.";
            errorEl.classList.add('show');
            return;
          }

          const { error: memberErr } = await sb.from('team_members')
            .insert({ team_id: team.id, profile_id: user.id });
          if (memberErr) {
            submitBtn.disabled = false; submitBtn.textContent = 'Join team';
            errorEl.textContent = memberErr.message;
            errorEl.classList.add('show');
            return;
          }
          const { error: regErr } = await sb.from('registrations')
            .insert({ event_id: eventId, profile_id: user.id, team_id: team.id, status: 'pending' });
          if (regErr) {
            submitBtn.disabled = false; submitBtn.textContent = 'Join team';
            errorEl.textContent = regErr.message;
            errorEl.classList.add('show');
            return;
          }

          await loadState();
          refreshButtons();
          joinedStep(team.team_name, name);
        });
      });
    }

    tabs.forEach(t => t.addEventListener('click', () => {
      tabs.forEach(x => x.classList.toggle('active', x === t));
      t.dataset.tab === 'create' ? renderCreate() : renderJoin();
    }));
    renderCreate();
  }

  function codeStep(code, slug, eventName) {
    const r = state[slug];
    openModal(`
      <button class="modal-close" data-close aria-label="Close">&times;</button>
      <span class="eyebrow-label mono">Team created</span>
      <h3 class="modal-title">"${r.teamName}" is in for ${eventName}</h3>
      <p class="modal-sub">Share this code with your teammates — they can use it to join your team using their own profile.</p>
      <div class="team-code-box">
        <span class="team-code">${code}</span>
        <button class="copy-btn" id="copyCodeBtn" type="button">Copy</button>
      </div>
      <div class="reg-form-note">
        <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/><path d="M12 8v5M12 16h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <span>Registration isn't final yet. Once your teammates have joined, come back to "Manage team" and hit Submit.</span>
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" data-close>Do this later</button>
        <button class="btn-primary" id="goManage" type="button">Manage team</button>
      </div>
    `);
    document.getElementById('copyCodeBtn').addEventListener('click', () => {
      const btn = document.getElementById('copyCodeBtn');
      navigator.clipboard.writeText(code).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
      }).catch(() => {
        btn.textContent = 'Select & copy';
      });
    });
    document.getElementById('goManage').addEventListener('click', () => manageTeamStep(slug));
  }

  function joinedStep(teamName, eventName) {
    openModal(`
      <button class="modal-close" data-close aria-label="Close">&times;</button>
      <div style="text-align:center;">
        <div class="modal-success-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <h3 class="modal-title">You've joined "${teamName}"</h3>
        <p class="modal-sub">for ${eventName}. Your registration is pending until your team leader submits it.</p>
        <button class="btn-primary" data-close style="width:100%">Done</button>
      </div>
    `);
  }

  /* Leader (or member, view-only) opens this from the event card once a team exists. */
  async function manageTeamStep(slug) {
    const r = state[slug];
    if (!r || !r.teamId) return;
    const members = await fetchTeamMembers(r.teamId);
    const { data: teamRow } = await sb.from('teams').select('leader_id').eq('id', r.teamId).single();
    members.forEach(m => { m.isLeader = teamRow && m.profile_id === teamRow.leader_id; });

    const finalized = !!r.finalized;
    const isLeader = r.isLeader;

    openModal(`
      <button class="modal-close" data-close aria-label="Close">&times;</button>
      <span class="eyebrow-label mono">${finalized ? 'Registered' : 'Manage team'}</span>
      <h3 class="modal-title">${r.teamName}</h3>
      <p class="modal-sub">code <b style="letter-spacing:.1em;">${r.code}</b></p>
      <div class="member-list">
        ${members.map(memberRow).join('')}
      </div>
      ${finalized
        ? `<div class="reg-form-note"><svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>This team's registration has been submitted and is final.</span></div>`
        : isLeader
          ? `<div class="reg-form-note"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/><path d="M12 8v5M12 16h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span>Submit once everyone's joined — you can't add members after that.</span></div>`
          : `<div class="reg-form-note"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/><path d="M12 8v5M12 16h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span>Waiting on your team leader to submit the registration.</span></div>`
      }
      <span class="auth-error" id="manageError"></span>
      <div class="modal-actions">
        <button class="btn-secondary" data-close>Close</button>
        ${(!finalized && isLeader) ? `<button class="btn-primary" id="submitTeamBtn" type="button">Submit registration</button>` : ''}
      </div>
    `);

    const submitBtn = document.getElementById('submitTeamBtn');
    if (submitBtn) {
      submitBtn.addEventListener('click', () => finalizeTeam(slug, submitBtn));
    }
  }

  async function finalizeTeam(slug, submitBtn) {
    const r = state[slug];
    const errorEl = document.getElementById('manageError');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    // NOTE: this calls the finalize_team() Postgres function (see the RLS
    // patch in supabase/schema-patch.sql) because a team leader isn't
    // otherwise allowed to update teammates' own registration rows.
    const { error } = await sb.rpc('finalize_team', { p_team_id: r.teamId });

    if (error) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit registration';
      errorEl.textContent = error.message;
      errorEl.classList.add('show');
      return;
    }
    await loadState();
    refreshButtons();
    successStep(`Your team "${r.teamName}" is registered. See you there!`);
  }

  function successStep(msg) {
    openModal(`
      <button class="modal-close" data-close aria-label="Close">&times;</button>
      <div style="text-align:center;">
        <div class="modal-success-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <h3 class="modal-title">You're all set!</h3>
        <p class="modal-sub">${msg}</p>
        <button class="btn-primary" data-close style="width:100%">Done</button>
      </div>
    `);
  }

  /* ---------- init ---------- */
  document.querySelectorAll('.event-register-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const slug = btn.dataset.eventId;
      const existing = state[slug];
      if (existing) {
        // Solo + already-finalized team registrations are done — nothing to manage.
        if (existing.teamId && !existing.finalized) {
          manageTeamStep(slug);
        }
        return;
      }
      const name = btn.dataset.eventName;
      const isTeam = btn.dataset.team === 'true';
      if (!window.VistaAuth || !VistaAuth.isLoggedIn()) {
        loginRequiredStep(slug, name);
        return;
      }
      confirmStep(slug, name, isTeam);
    });
  });

  (async function init() {
    await loadEventIds();
    await VistaAuth.ready;
    await loadState();
    refreshButtons();
    document.addEventListener('vista-auth-changed', async () => {
      await loadState();
      refreshButtons();
    });
  })();
})();