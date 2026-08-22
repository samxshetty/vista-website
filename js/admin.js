/* Admin / coordinator dashboard.
   Requires js/supabase-client.js and js/auth.js loaded first.

   Access control has two layers:
   1. Client-side gate here — just UX, redirects/blocks people who
      shouldn't be looking at this page.
   2. Postgres RLS (schema-patch-3-admin.sql) — the real security. Even if
      someone loads this page/script directly, every query below is
      scoped by `is_admin(auth.uid())` on the database side, so a
      non-admin gets empty results / permission errors, not real data.
*/
(function () {
  const root = document.getElementById('adminRoot');
  if (!root) return;

  // Emails that always get admin access, regardless of their public.profiles
  // role. Mirrors the same list baked into is_admin_or_coordinator() in
  // supabase/schema-patch-signup.sql — that DB-side copy is the real
  // security boundary, this is just so the UI doesn't show "access denied"
  // to them first. Keep the two lists in sync.
  const ADMIN_EMAILS = ['samridhshetty2007@gmail.com'];

  let activeTab = 'events';
  let eventsCache = [];      // full events list, refreshed per tab load
  let membersCache = [];

  /* ---------------------------------------------------------------- */
  /* small helpers                                                     */
  /* ---------------------------------------------------------------- */

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  function slugify(s) {
    return (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  const STATUS_LABEL = { open: 'Open', upcoming: 'Upcoming', closed: 'Closed' };
  const STATUS_PILL_CLASS = { open: 'pill-open', upcoming: 'pill-upcoming', closed: 'pill-closed' };
  function statusPill(status) {
    const s = status || 'upcoming';
    return `<span class="pill ${STATUS_PILL_CLASS[s] || 'pill-closed'}">${STATUS_LABEL[s] || s}</span>`;
  }

  /* CSV export — takes an array of plain objects (already flattened) */
  function exportCsv(filename, rows) {
    if (!rows || !rows.length) { alert('Nothing to export yet.'); return; }
    const cols = Object.keys(rows[0]);
    const esc = (v) => {
      if (v == null) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [cols.join(',')].concat(
      rows.map(r => cols.map(c => esc(r[c])).join(','))
    );
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /* modal (self-contained, doesn't touch register.js's overlay) */
  const modalOverlay = document.getElementById('adminModalOverlay');
  const modalBody = document.getElementById('adminModalBody');
  document.getElementById('adminModalClose').addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
  function openModal(html) {
    modalBody.innerHTML = html;
    modalOverlay.classList.add('open');
  }
  function closeModal() {
    modalOverlay.classList.remove('open');
    modalBody.innerHTML = '';
  }

  /* ---------------------------------------------------------------- */
  /* shell (tabs)                                                       */
  /* ---------------------------------------------------------------- */

  function renderShell() {
    root.innerHTML = `
      <div class="admin-tabs">
        <button class="admin-tab ${activeTab === 'events' ? 'active' : ''}" data-tab="events">Events</button>
        <button class="admin-tab ${activeTab === 'registrations' ? 'active' : ''}" data-tab="registrations">Registrations</button>
        <button class="admin-tab ${activeTab === 'members' ? 'active' : ''}" data-tab="members">Members</button>
      </div>
      <div id="adminTabContent" class="admin-tab-content"><p class="empty-note">Loading…</p></div>
    `;
    root.querySelectorAll('.admin-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        renderShell();
      });
    });
    if (activeTab === 'events') loadEventsTab();
    else if (activeTab === 'registrations') loadRegistrationsTab();
    else loadMembersTab();
  }

  function deniedView(reason) {
    root.innerHTML = `
      <div class="glass" style="padding:36px; text-align:center; border-radius:20px; max-width:480px; margin:0 auto;">
        <h2 style="margin-bottom:10px;">Access denied</h2>
        <p class="auth-sub">${reason}</p>
        <div class="modal-actions" style="justify-content:center; margin-top:18px;">
          <a class="btn-primary" href="../index.html">Back to home</a>
        </div>
      </div>
    `;
  }

  /* ---------------------------------------------------------------- */
  /* EVENTS TAB                                                         */
  /* ---------------------------------------------------------------- */

  async function loadEventsTab() {
    const content = document.getElementById('adminTabContent');
    const { data, error } = await sb.from('events').select('*').order('starts_at', { ascending: true });
    if (error) { content.innerHTML = `<p class="auth-error show">${escapeHtml(error.message)}</p>`; return; }
    eventsCache = data || [];
    content.innerHTML = `
      <div class="admin-toolbar">
        <button class="btn-primary" id="newEventBtn" type="button">+ New event</button>
        <button class="btn-secondary" id="exportEventsBtn" type="button">Export CSV</button>
      </div>
      <div class="table-wrap">
        <table class="admin-table">
          <thead><tr>
            <th>Name</th><th>Slug</th><th>Venue</th><th>Starts</th><th>Type</th><th>Registrations</th><th></th>
          </tr></thead>
          <tbody>
            ${eventsCache.map(ev => `
              <tr>
                <td>${escapeHtml(ev.name)}</td>
                <td class="mono">${escapeHtml(ev.slug)}</td>
                <td>${escapeHtml(ev.venue || '—')}</td>
                <td>${fmtDate(ev.starts_at)}</td>
                <td>${ev.is_team_event ? `Team (${ev.team_min_size || 1}–${ev.team_max_size || '?'})` : 'Solo'}</td>
                <td>${statusPill(ev.registration_status)}</td>
                <td class="admin-row-actions">
                  <button class="btn-sm" data-edit="${ev.id}">Edit</button>
                  <button class="btn-sm btn-danger" data-delete="${ev.id}">Delete</button>
                </td>
              </tr>
            `).join('') || `<tr><td colspan="7"><p class="empty-note">No events yet.</p></td></tr>`}
          </tbody>
        </table>
      </div>
    `;

    document.getElementById('newEventBtn').addEventListener('click', () => openEventForm(null));
    document.getElementById('exportEventsBtn').addEventListener('click', () => {
      exportCsv('vista-events.csv', eventsCache.map(ev => ({
        name: ev.name, slug: ev.slug, venue: ev.venue || '', starts_at: ev.starts_at || '',
        is_team_event: ev.is_team_event, team_min_size: ev.team_min_size || '', team_max_size: ev.team_max_size || '',
        registration_status: ev.registration_status || '', whatsapp_link: ev.whatsapp_link || '', form_link: ev.form_link || '',
        created_at: ev.created_at
      })));
    });
    content.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
      const ev = eventsCache.find(e => e.id === b.dataset.edit);
      openEventForm(ev);
    }));
    content.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', () => confirmDeleteEvent(b.dataset.delete)));
  }

  function openEventForm(ev) {
    const isEdit = !!ev;
    openModal(`
      <span class="eyebrow-label mono">${isEdit ? 'Edit event' : 'New event'}</span>
      <h1 class="modal-title">${isEdit ? escapeHtml(ev.name) : 'Create event'}</h1>
      <form class="auth-form" id="eventForm">
        <div class="form-group"><label>Name</label><input required name="name" value="${isEdit ? escapeHtml(ev.name) : ''}" placeholder="e.g. Flaskverse"></div>
        <div class="form-group"><label>Slug (used in the URL / data-event-id, no spaces)</label><input required name="slug" value="${isEdit ? escapeHtml(ev.slug) : ''}" placeholder="flaskverse"></div>
        <div class="form-group"><label>Description</label><input name="description" value="${isEdit ? escapeHtml(ev.description || '') : ''}" placeholder="One line about the event"></div>
        <div class="form-group"><label>Venue</label><input name="venue" value="${isEdit ? escapeHtml(ev.venue || '') : ''}" placeholder="e.g. Seminar Hall 2"></div>
        <div class="form-group"><label>Starts at</label><input type="datetime-local" name="starts_at" value="${isEdit && ev.starts_at ? ev.starts_at.slice(0, 16) : ''}"></div>
        <div class="form-group"><label>Poster URL (optional)</label><input name="poster_url" value="${isEdit ? escapeHtml(ev.poster_url || '') : ''}" placeholder="https://..."></div>
        <div class="form-group">
          <label><input type="checkbox" id="isTeamEvent" name="is_team_event" ${isEdit && ev.is_team_event ? 'checked' : ''}> Team event</label>
        </div>
        <div class="admin-inline-fields" id="teamSizeFields" style="${isEdit && ev.is_team_event ? '' : 'display:none;'}">
          <div class="form-group"><label>Min team size</label><input type="number" min="1" name="team_min_size" value="${isEdit && ev.team_min_size ? ev.team_min_size : 2}"></div>
          <div class="form-group"><label>Max team size</label><input type="number" min="1" name="team_max_size" value="${isEdit && ev.team_max_size ? ev.team_max_size : 4}"></div>
        </div>
        <div class="form-group">
          <label>Registrations</label>
          <select name="registration_status">
            ${['open', 'upcoming', 'closed'].map(s => {
              const current = isEdit ? (ev.registration_status || 'upcoming') : 'upcoming';
              return `<option value="${s}" ${current === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`;
            }).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>WhatsApp group link <span style="opacity:.6;font-weight:400;">(optional)</span></label>
          <input name="whatsapp_link" value="${isEdit ? escapeHtml(ev.whatsapp_link || '') : ''}" placeholder="https://chat.whatsapp.com/...">
        </div>
        <div class="form-group">
          <label>Form link <span style="opacity:.6;font-weight:400;">(optional, e.g. a Google Form)</span></label>
          <input name="form_link" value="${isEdit ? escapeHtml(ev.form_link || '') : ''}" placeholder="https://forms.gle/...">
        </div>
        <p class="reg-form-note"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/><path d="M12 8v5M12 16h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span>Either link is shown to a person once their registration for this event goes through — leave both blank to show nothing.</span></p>
        <span class="auth-error" id="eventFormError"></span>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" id="cancelEventForm">Cancel</button>
          <button type="submit" class="btn-primary">${isEdit ? 'Save changes' : 'Create event'}</button>
        </div>
      </form>
    `);

    const form = document.getElementById('eventForm');
    const nameInput = form.name;
    const slugInput = form.slug;
    if (!isEdit) {
      let slugTouched = false;
      slugInput.addEventListener('input', () => { slugTouched = true; });
      nameInput.addEventListener('input', () => { if (!slugTouched) slugInput.value = slugify(nameInput.value); });
    }
    document.getElementById('isTeamEvent').addEventListener('change', (e) => {
      document.getElementById('teamSizeFields').style.display = e.target.checked ? '' : 'none';
    });
    document.getElementById('cancelEventForm').addEventListener('click', closeModal);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const errorEl = document.getElementById('eventFormError');
      const submitBtn = form.querySelector('.btn-primary');
      const isTeam = !!form.is_team_event.checked;

      const payload = {
        name: fd.get('name').trim(),
        slug: slugify(fd.get('slug')),
        description: fd.get('description').trim() || null,
        venue: fd.get('venue').trim() || null,
        starts_at: fd.get('starts_at') || null,
        poster_url: fd.get('poster_url').trim() || null,
        is_team_event: isTeam,
        team_min_size: isTeam ? parseInt(fd.get('team_min_size'), 10) || null : null,
        team_max_size: isTeam ? parseInt(fd.get('team_max_size'), 10) || null : null,
        registration_status: fd.get('registration_status'),
        whatsapp_link: fd.get('whatsapp_link').trim() || null,
        form_link: fd.get('form_link').trim() || null
      };

      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving...';

      const { error } = isEdit
        ? await sb.from('events').update(payload).eq('id', ev.id)
        : await sb.from('events').insert(payload);

      submitBtn.disabled = false;
      submitBtn.textContent = isEdit ? 'Save changes' : 'Create event';

      if (error) {
        errorEl.textContent = error.message.includes('duplicate') ? 'That slug is already in use.' : error.message;
        errorEl.classList.add('show');
        return;
      }
      closeModal();
      loadEventsTab();
    });
  }

  function confirmDeleteEvent(id) {
    const ev = eventsCache.find(e => e.id === id);
    openModal(`
      <span class="eyebrow-label mono">Delete event</span>
      <h1 class="modal-title">Delete "${escapeHtml(ev ? ev.name : '')}"?</h1>
      <p class="modal-sub">This can't be undone. If people have already registered for this event, the delete will fail — cancel their registrations first.</p>
      <span class="auth-error" id="deleteEventError"></span>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" id="cancelDeleteEvent">Cancel</button>
        <button type="button" class="btn-primary" id="confirmDeleteEvent" style="background:#e0575f;">Delete</button>
      </div>
    `);
    document.getElementById('cancelDeleteEvent').addEventListener('click', closeModal);
    document.getElementById('confirmDeleteEvent').addEventListener('click', async () => {
      const { error } = await sb.from('events').delete().eq('id', id);
      if (error) {
        const errorEl = document.getElementById('deleteEventError');
        errorEl.textContent = error.message;
        errorEl.classList.add('show');
        return;
      }
      closeModal();
      loadEventsTab();
    });
  }

  /* ---------------------------------------------------------------- */
  /* REGISTRATIONS TAB                                                  */
  /* ---------------------------------------------------------------- */

  let regFilterEventId = 'all';
  let regFilterStatus = 'all';
  let regViewMode = 'grouped'; // 'grouped' (by event, default) | 'table' (flat, editable)

  async function loadRegistrationsTab() {
    const content = document.getElementById('adminTabContent');
    content.innerHTML = `<p class="empty-note">Loading…</p>`;

    if (!eventsCache.length) {
      const { data } = await sb.from('events').select('*').order('starts_at', { ascending: true });
      eventsCache = data || [];
    }

    let query = sb.from('registrations')
      .select('id, status, registered_at, profile_id, event_id, team_id, profiles(full_name, usn, semester, section, phone), events(name, slug), teams(team_name, code, is_finalized, leader_id)')
      .order('registered_at', { ascending: false });
    if (regFilterEventId !== 'all') query = query.eq('event_id', regFilterEventId);
    if (regFilterStatus !== 'all') query = query.eq('status', regFilterStatus);

    const { data, error } = await query;
    if (error) { content.innerHTML = `<p class="auth-error show">${escapeHtml(error.message)}</p>`; return; }
    const regs = data || [];

    content.innerHTML = `
      <div class="admin-toolbar">
        <div class="admin-view-toggle">
          <button type="button" data-view="grouped" class="${regViewMode === 'grouped' ? 'active' : ''}">By event</button>
          <button type="button" data-view="table" class="${regViewMode === 'table' ? 'active' : ''}">Table</button>
        </div>
        <select id="regEventFilter" class="admin-filter">
          <option value="all">All events</option>
          ${eventsCache.map(ev => `<option value="${ev.id}" ${regFilterEventId === ev.id ? 'selected' : ''}>${escapeHtml(ev.name)}</option>`).join('')}
        </select>
        <select id="regStatusFilter" class="admin-filter">
          <option value="all" ${regFilterStatus === 'all' ? 'selected' : ''}>All statuses</option>
          <option value="pending" ${regFilterStatus === 'pending' ? 'selected' : ''}>Pending</option>
          <option value="finalized" ${regFilterStatus === 'finalized' ? 'selected' : ''}>Finalized</option>
          <option value="cancelled" ${regFilterStatus === 'cancelled' ? 'selected' : ''}>Cancelled</option>
        </select>
        <button class="btn-secondary" id="exportRegsBtn" type="button">Export CSV</button>
      </div>
      <div id="regViewContainer"></div>
    `;

    const container = document.getElementById('regViewContainer');
    if (regViewMode === 'grouped') renderGroupedRegistrations(container, regs);
    else renderTableRegistrations(container, regs);

    document.querySelectorAll('.admin-view-toggle [data-view]').forEach(btn => {
      btn.addEventListener('click', () => { regViewMode = btn.dataset.view; loadRegistrationsTab(); });
    });
    document.getElementById('regEventFilter').addEventListener('change', (e) => { regFilterEventId = e.target.value; loadRegistrationsTab(); });
    document.getElementById('regStatusFilter').addEventListener('change', (e) => { regFilterStatus = e.target.value; loadRegistrationsTab(); });
    document.getElementById('exportRegsBtn').addEventListener('click', () => {
      exportCsv('vista-registrations.csv', regs.map(r => ({
        event: r.events ? r.events.name : '',
        full_name: r.profiles ? r.profiles.full_name : '',
        usn: r.profiles ? r.profiles.usn : '',
        semester: r.profiles ? r.profiles.semester : '',
        section: r.profiles ? r.profiles.section : '',
        phone: r.profiles ? (r.profiles.phone || '') : '',
        team_name: r.teams ? r.teams.team_name : '',
        team_code: r.teams ? r.teams.code : '',
        is_team_leader: r.teams ? (r.teams.leader_id === r.profile_id) : '',
        status: r.status,
        registered_at: r.registered_at
      })));
    });
  }

  /* --- "By event" grouped view: counts + team rosters / solo lists --- */
  function renderGroupedRegistrations(container, regs) {
    // which events to show: respect the event filter, else every event that
    // has at least one registration (or all events, so empty ones show 0 too)
    const eventsToShow = regFilterEventId !== 'all'
      ? eventsCache.filter(e => e.id === regFilterEventId)
      : eventsCache;

    if (!eventsToShow.length) {
      container.innerHTML = `<p class="empty-note">No events yet.</p>`;
      return;
    }

    container.innerHTML = eventsToShow.map(ev => {
      const evRegs = regs.filter(r => r.event_id === ev.id);

      let bodyHtml, countLabel, countNum, teamCount = null;

      if (ev.is_team_event) {
        const teamsMap = new Map();
        const noTeam = [];
        evRegs.forEach(r => {
          if (r.team_id) {
            if (!teamsMap.has(r.team_id)) teamsMap.set(r.team_id, { team: r.teams, members: [] });
            teamsMap.get(r.team_id).members.push(r);
          } else {
            noTeam.push(r);
          }
        });
        teamCount = teamsMap.size;
        countNum = evRegs.length;
        countLabel = 'Participants';

        const teamCards = Array.from(teamsMap.values()).map(({ team, members }) => `
          <div class="team-card">
            <div class="team-card-header">
              <div>
                <h4>${escapeHtml(team ? team.team_name : 'Unnamed team')}<span class="mono">${team ? escapeHtml(team.code) : ''}</span></h4>
              </div>
              <span class="pill ${team && team.is_finalized ? 'pill-finalized' : 'pill-pending'}">${team && team.is_finalized ? 'Finalized' : 'Not finalized'}</span>
            </div>
            <div class="member-list">
              ${members.map(m => `
                <div class="member-row">
                  <span class="member-name">
                    ${escapeHtml(m.profiles ? m.profiles.full_name : 'Unknown')}
                    ${team && team.leader_id === m.profile_id ? '<span class="member-leader-badge">Leader</span>' : ''}
                  </span>
                  <span class="member-sub">${escapeHtml(m.profiles ? m.profiles.usn : '—')} · ${m.profiles ? (m.profiles.semester + '/' + (m.profiles.section || '—')) : '—'} · ${escapeHtml(m.profiles && m.profiles.phone ? m.profiles.phone : '—')}</span>
                </div>
              `).join('')}
            </div>
          </div>
        `).join('');

        const noTeamHtml = noTeam.length ? `
          <div class="team-card">
            <div class="team-card-header"><h4>Ungrouped registrations</h4></div>
            <div class="member-list">
              ${noTeam.map(m => `
                <div class="member-row">
                  <span class="member-name">${escapeHtml(m.profiles ? m.profiles.full_name : 'Unknown')}</span>
                  <span class="member-sub">${escapeHtml(m.profiles ? m.profiles.usn : '—')}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : '';

        bodyHtml = (teamCards + noTeamHtml) || `<p class="admin-empty-event">No one has registered for this event yet.</p>`;
      } else {
        countNum = evRegs.length;
        countLabel = 'Registered';
        bodyHtml = evRegs.length ? `
          <div class="solo-list">
            ${evRegs.map(r => `
              <div class="member-row">
                <span class="member-name">${escapeHtml(r.profiles ? r.profiles.full_name : 'Unknown')}</span>
                <span class="member-sub">
                  ${escapeHtml(r.profiles ? r.profiles.usn : '—')} · ${r.profiles ? (r.profiles.semester + '/' + (r.profiles.section || '—')) : '—'} · ${escapeHtml(r.profiles && r.profiles.phone ? r.profiles.phone : '—')}
                  <span class="pill pill-${r.status}" style="margin-left:8px;">${escapeHtml(r.status)}</span>
                </span>
              </div>
            `).join('')}
          </div>
        ` : `<p class="admin-empty-event">No one has registered for this event yet.</p>`;
      }

      return `
        <div class="event-group">
          <div class="event-group-header">
            <div class="event-group-title">
              <div>
                <h3>${escapeHtml(ev.name)}</h3>
                <div class="event-group-meta">${escapeHtml(ev.venue || 'Venue TBA')} · ${fmtDate(ev.starts_at)}</div>
              </div>
              ${statusPill(ev.registration_status)}
            </div>
            <div class="event-group-stats">
              <div class="event-group-stat"><div class="num">${countNum}</div><div class="label">${countLabel}</div></div>
              ${teamCount !== null ? `<div class="event-group-stat"><div class="num">${teamCount}</div><div class="label">Teams</div></div>` : ''}
            </div>
          </div>
          ${bodyHtml}
        </div>
      `;
    }).join('');
  }

  /* --- flat, filterable, editable table view (status change / remove) --- */
  function renderTableRegistrations(container, regs) {
    container.innerHTML = `
      <div class="table-wrap">
        <table class="admin-table">
          <thead><tr>
            <th>Event</th><th>Name</th><th>USN</th><th>Sem/Sec</th><th>Phone</th><th>Team</th><th>Status</th><th>Registered</th><th></th>
          </tr></thead>
          <tbody>
            ${regs.map(r => `
              <tr>
                <td>${escapeHtml(r.events ? r.events.name : '—')}</td>
                <td>${escapeHtml(r.profiles ? r.profiles.full_name : '—')}</td>
                <td class="mono">${escapeHtml(r.profiles ? r.profiles.usn : '—')}</td>
                <td>${escapeHtml(r.profiles ? (r.profiles.semester + '/' + r.profiles.section) : '—')}</td>
                <td>${escapeHtml(r.profiles && r.profiles.phone ? r.profiles.phone : '—')}</td>
                <td>${r.teams ? escapeHtml(r.teams.team_name) + ' <span class="mono" style="opacity:.6;">(' + escapeHtml(r.teams.code) + ')</span>' : 'Solo'}</td>
                <td>
                  <select class="admin-status-select" data-reg="${r.id}">
                    <option value="pending" ${r.status === 'pending' ? 'selected' : ''}>Pending</option>
                    <option value="finalized" ${r.status === 'finalized' ? 'selected' : ''}>Finalized</option>
                    <option value="cancelled" ${r.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                  </select>
                </td>
                <td>${fmtDate(r.registered_at)}</td>
                <td class="admin-row-actions"><button class="btn-sm btn-danger" data-remove-reg="${r.id}">Remove</button></td>
              </tr>
            `).join('') || `<tr><td colspan="9"><p class="empty-note">No registrations match this filter.</p></td></tr>`}
          </tbody>
        </table>
      </div>
    `;

    container.querySelectorAll('.admin-status-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        sel.disabled = true;
        const { error } = await sb.from('registrations').update({ status: sel.value }).eq('id', sel.dataset.reg);
        sel.disabled = false;
        if (error) alert('Failed to update status: ' + error.message);
      });
    });
    container.querySelectorAll('[data-remove-reg]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('Remove this registration? This cannot be undone.')) return;
        const { error } = await sb.from('registrations').delete().eq('id', b.dataset.removeReg);
        if (error) { alert('Failed to remove: ' + error.message); return; }
        loadRegistrationsTab();
      });
    });
  }

  /* ---------------------------------------------------------------- */
  /* MEMBERS TAB                                                        */
  /* ---------------------------------------------------------------- */

  async function loadMembersTab() {
    const content = document.getElementById('adminTabContent');
    const { data, error } = await sb.from('profiles').select('*').order('created_at', { ascending: false });
    if (error) { content.innerHTML = `<p class="auth-error show">${escapeHtml(error.message)}</p>`; return; }
    membersCache = data || [];
    const me = VistaAuth.currentUser();

    content.innerHTML = `
      <div class="admin-toolbar">
        <input type="text" id="memberSearch" class="admin-filter" placeholder="Search name / USN...">
        <button class="btn-secondary" id="exportMembersBtn" type="button">Export CSV</button>
      </div>
      <div class="table-wrap">
        <table class="admin-table" id="membersTable">
          <thead><tr><th>Name</th><th>USN</th><th>Sem/Sec</th><th>Phone</th><th>Joined</th><th>Role</th></tr></thead>
          <tbody>
            ${membersCache.map(m => `
              <tr data-search="${escapeHtml((m.full_name || '') + ' ' + (m.usn || '')).toLowerCase()}">
                <td>${escapeHtml(m.full_name || '—')}</td>
                <td class="mono">${escapeHtml(m.usn || '—')}</td>
                <td>${m.semester || '—'}/${escapeHtml(m.section || '—')}</td>
                <td>${escapeHtml(m.phone || '—')}</td>
                <td>${fmtDate(m.created_at)}</td>
                <td>
                  <select class="admin-status-select" data-member="${m.id}" ${m.id === (me && me.id) ? 'disabled title="You can\'t change your own role"' : ''}>
                    <option value="member" ${m.role === 'member' ? 'selected' : ''}>Member</option>
                    <option value="coordinator" ${m.role === 'coordinator' ? 'selected' : ''}>Coordinator</option>
                    <option value="admin" ${m.role === 'admin' ? 'selected' : ''}>Admin</option>
                  </select>
                </td>
              </tr>
            `).join('') || `<tr><td colspan="6"><p class="empty-note">No members yet.</p></td></tr>`}
          </tbody>
        </table>
      </div>
    `;

    document.getElementById('exportMembersBtn').addEventListener('click', () => {
      exportCsv('vista-members.csv', membersCache.map(m => ({
        full_name: m.full_name || '', usn: m.usn || '', semester: m.semester || '', section: m.section || '',
        phone: m.phone || '', role: m.role || 'member', created_at: m.created_at
      })));
    });
    document.getElementById('memberSearch').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      document.querySelectorAll('#membersTable tbody tr[data-search]').forEach(tr => {
        tr.style.display = tr.dataset.search.includes(q) ? '' : 'none';
      });
    });
    content.querySelectorAll('[data-member]').forEach(sel => {
      sel.addEventListener('change', async () => {
        const newRole = sel.value;
        if (newRole === 'admin' && !confirm('Grant full admin access to this member?')) {
          sel.value = sel.dataset.prev || 'member';
          return;
        }
        sel.disabled = true;
        const { error } = await sb.from('profiles').update({ role: newRole }).eq('id', sel.dataset.member);
        sel.disabled = false;
        if (error) alert('Failed to update role: ' + error.message);
      });
      sel.dataset.prev = sel.value;
    });
  }

  /* ---------------------------------------------------------------- */
  /* boot / access gate                                                 */
  /* ---------------------------------------------------------------- */

  (async function init() {
    await VistaAuth.ready;
    if (!VistaAuth.isLoggedIn()) {
      deniedView('You need to log in with a coordinator or admin account to see this page.');
      // Bounce to login, then back here.
      window.location.href = '../login/index.html?redirect=' + encodeURIComponent('../admin/index.html');
      return;
    }
    const user = VistaAuth.currentUser();
    const role = user.profile && user.profile.role;
    const isHardcodedAdmin = user.email && ADMIN_EMAILS.includes(user.email.toLowerCase());
    if (!isHardcodedAdmin && role !== 'admin' && role !== 'coordinator') {
      deniedView("This account doesn't have admin or coordinator access.");
      return;
    }
    renderShell();
  })();

  document.addEventListener('vista-auth-changed', () => {
    if (!VistaAuth.isLoggedIn()) {
      window.location.href = '../login/index.html?redirect=' + encodeURIComponent('../admin/index.html');
    }
  });
})();