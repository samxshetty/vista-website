/* Renders the public Events grid from Supabase `events` table instead of
   hardcoded HTML. Admins manage events entirely from /admin — this file
   just reads and displays what's in the database.

   Requires js/supabase-client.js loaded first. Exposes
   window.VistaEventsReady (a Promise) so js/register.js can wait for the
   cards to exist in the DOM before it wires up the Register buttons.
*/
(function () {
  const grid = document.getElementById('eventsGrid');
  if (!grid) { window.VistaEventsReady = Promise.resolve(); return; }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function fmtDate(iso) {
    if (!iso) return 'Date TBA';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function placeholderPoster(slug) {
    return `https://picsum.photos/seed/vista-${encodeURIComponent(slug || 'event')}/700/420`;
  }

  function eventCard(ev) {
    const tag = ev.is_team_event
      ? `Team event · ${ev.team_min_size || 1}–${ev.team_max_size || '?'}`
      : 'Solo event';
    const closed = !ev.is_open;
    return `
      <div class="event-card glass reveal">
        <div class="event-poster">
          <img src="${escapeHtml(ev.poster_url || placeholderPoster(ev.slug))}" alt="${escapeHtml(ev.name)} poster">
          <span class="event-tag">${escapeHtml(tag)}</span>
        </div>
        <div class="event-body">
          <h3>${escapeHtml(ev.name)}</h3>
          <p class="desc">${escapeHtml(ev.description || '')}</p>
          <div class="event-meta">
            <div><svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.4"/></svg><div><b>Date</b>${fmtDate(ev.starts_at)}</div></div>
            <div><svg viewBox="0 0 24 24" fill="none"><path d="M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21z" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="9.5" r="2.2" stroke="currentColor" stroke-width="1.4"/></svg><div><b>Venue</b>${escapeHtml(ev.venue || 'TBA')}</div></div>
          </div>
        </div>
        <div class="event-actions">
          <button class="event-register-btn" data-event-id="${escapeHtml(ev.slug)}" data-event-name="${escapeHtml(ev.name)}" data-team="${ev.is_team_event ? 'true' : 'false'}" ${closed ? 'disabled title="Registrations are closed for this event"' : ''}>${closed ? 'Registrations closed' : 'Register'}</button>
        </div>
      </div>
    `;
  }

  function reRunReveal() {
    const els = grid.querySelectorAll('.reveal:not(.in)');
    if (!('IntersectionObserver' in window)) { els.forEach(el => el.classList.add('in')); return; }
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: .15 });
    els.forEach(el => io.observe(el));
  }

  async function loadEvents() {
    const { data, error } = await sb
      .from('events')
      .select('*')
      .order('starts_at', { ascending: true });

    if (error) {
      grid.innerHTML = `<p class="empty-note">Couldn't load events right now. Please refresh.</p>`;
      console.error('events load error', error);
      return;
    }

    const events = data || [];
    if (!events.length) {
      grid.innerHTML = `<p class="empty-note">No events announced yet — check back soon.</p>`;
      return;
    }

    grid.innerHTML = events.map(eventCard).join('');
    reRunReveal();
  }

  window.VistaEventsReady = loadEvents();
})();
