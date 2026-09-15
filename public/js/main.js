/* ============================================================
   CICM GLOBAL — front-end v3.0
   Hero carousel · analytics heartbeat · countdowns · chat ·
   scroll reveal · event registration modal
   ============================================================ */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    initNav();
    initHero();
    initCountdowns();
    initChat();
    initContact();
    initReveal();
    initHeartbeat();
    initEventReg();
    initBackToTop();
  });

  /* ---------------- NAVBAR ---------------- */
  function initNav() {
    var nb = document.getElementById('navbar');
    if (nb) window.addEventListener('scroll', function () {
      nb.classList.toggle('scrolled', window.scrollY > 40);
    }, { passive: true });
    var nt = document.getElementById('navToggle'), nl = document.getElementById('navLinks');
    if (nt && nl) nt.addEventListener('click', function () {
      nl.classList.toggle('open'); nt.classList.toggle('active');
    });
  }

  /* ---------------- HERO CAROUSEL (codelabs-style) ---------------- */
  function initHero() {
    var slides = document.querySelectorAll('.hero-slide');
    var dots   = document.querySelectorAll('.hero-dot');
    var prev   = document.getElementById('heroPrev');
    var next   = document.getElementById('heroNext');
    if (!slides.length) return;

    var idx = 0, timer;
    function go(i) {
      idx = (i + slides.length) % slides.length;
      slides.forEach(function (s, n) { s.classList.toggle('active', n === idx); });
      dots.forEach(function (d, n) { d.classList.toggle('active', n === idx); });
      reset();
    }
    function reset() {
      clearInterval(timer);
      if (slides.length > 1) timer = setInterval(function () { go(idx + 1); }, 6500);
    }
    if (prev) prev.addEventListener('click', function () { go(idx - 1); });
    if (next) next.addEventListener('click', function () { go(idx + 1); });
    dots.forEach(function (d) {
      d.addEventListener('click', function () { go(parseInt(d.dataset.go, 10)); });
    });

    // Touch swipe
    var hero = document.getElementById('hero'), sx = 0;
    if (hero) {
      hero.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; }, { passive: true });
      hero.addEventListener('touchend', function (e) {
        var dx = e.changedTouches[0].clientX - sx;
        if (Math.abs(dx) > 50) go(idx + (dx < 0 ? 1 : -1));
      }, { passive: true });
    }
    // Pause on hover (desktop)
    if (hero) {
      hero.addEventListener('mouseenter', function () { clearInterval(timer); });
      hero.addEventListener('mouseleave', reset);
    }
    reset();
  }

  /* ---------------- COUNTDOWN TIMERS ---------------- */
  function initCountdowns() {
    document.querySelectorAll('.event-countdown').forEach(function (el) {
      var target = new Date(el.dataset.date + 'T09:00:00').getTime();
      function update() {
        var diff = target - Date.now();
        if (diff < 0) {
          el.innerHTML = '<div class="cd-live"><i class="fas fa-circle"></i> Event in progress</div>';
          return;
        }
        var d = Math.floor(diff / 864e5),
            h = Math.floor(diff % 864e5 / 36e5),
            m = Math.floor(diff % 36e5 / 6e4),
            s = Math.floor(diff % 6e4 / 1e3);
        var nums = el.querySelectorAll('.cd-num');
        if (nums.length === 4) {
          nums[0].textContent = d; nums[1].textContent = ('0'+h).slice(-2);
          nums[2].textContent = ('0'+m).slice(-2); nums[3].textContent = ('0'+s).slice(-2);
        }
      }
      update(); setInterval(update, 1000);
    });
  }

  /* ---------------- CONTACT FORM ---------------- */
  function initContact() {
    var cf = document.getElementById('contactForm');
    if (!cf) return;
    cf.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = document.getElementById('contactMsg');
      if (msg) { msg.style.display = 'block'; }
      cf.reset();
      setTimeout(function () { if (msg) msg.style.display = 'none'; }, 5000);
    });
  }

  /* ---------------- LIVE CHAT ---------------- */
  function initChat() {
    var toggle  = document.getElementById('livechatToggle'),
        box     = document.getElementById('livechatBox'),
        body    = document.getElementById('lcBody'),
        send    = document.getElementById('lcSend'),
        input   = document.getElementById('lcMsg'),
        contact = document.getElementById('lcContact'),
        contactSend = document.getElementById('lcContactSend');
    if (!toggle) return;
    toggle.addEventListener('click', function () {
      var open = box.classList.toggle('open');
      var o = document.getElementById('chatIconOpen'), c = document.getElementById('chatIconClose');
      if (o) o.style.display = open ? 'none' : 'block';
      if (c) c.style.display = open ? 'block' : 'none';
      if (open && input) setTimeout(function(){ input.focus(); }, 200);
    });

    var pendingQuestion = null;   // last unanswered question awaiting contact details

    function addMsg(text, who) {
      var m = document.createElement('div');
      m.className = 'lc-msg ' + (who === 'user' ? 'lc-user' : 'lc-bot');
      m.textContent = text;
      body.appendChild(m); body.scrollTop = body.scrollHeight;
      return m;
    }
    function typing() {
      var t = document.createElement('div');
      t.className = 'lc-msg lc-bot lc-typing'; t.innerHTML = '<span></span><span></span><span></span>';
      body.appendChild(t); body.scrollTop = body.scrollHeight; return t;
    }

    function ask(msg, opts) {
      opts = opts || {};
      addMsg(msg, 'user');
      var chips = document.getElementById('lcChips'); if (chips) chips.style.display = 'none';
      var t = typing();
      fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, name: opts.name || '', email: opts.email || '' }) })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          t.remove();
          addMsg(res.reply || 'Thanks for your message!', 'bot');
          if (res.needContact) {                 // bot couldn't answer — collect contact
            pendingQuestion = msg;
            if (contact) contact.style.display = 'block';
          } else if (res.escalated || res.answered) {
            pendingQuestion = null;
            if (contact) contact.style.display = 'none';
          }
        })
        .catch(function () { t.remove(); addMsg('Sorry, something went wrong. Please try again or email us.', 'bot'); });
    }

    var fire = function () {
      var msg = (input.value || '').trim();
      if (!msg) return;
      input.value = '';
      ask(msg);
    };
    send.addEventListener('click', fire);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') fire(); });

    // quick-reply chips
    var chipWrap = document.getElementById('lcChips');
    if (chipWrap) chipWrap.addEventListener('click', function (e) {
      var b = e.target.closest('.lc-chip'); if (!b) return;
      ask(b.getAttribute('data-q'));
    });

    // escalate with contact details
    if (contactSend) contactSend.addEventListener('click', function () {
      var name = (document.getElementById('lcName').value || '').trim();
      var email = (document.getElementById('lcEmail').value || '').trim();
      if (!email) { document.getElementById('lcEmail').focus(); return; }
      if (!pendingQuestion) { contact.style.display = 'none'; return; }
      contact.style.display = 'none';
      var t = typing();
      fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: pendingQuestion, name: name, email: email }) })
        .then(function (r) { return r.json(); })
        .then(function (res) { t.remove(); addMsg(res.reply || 'Thanks — our team will be in touch.', 'bot'); pendingQuestion = null; })
        .catch(function () { t.remove(); addMsg('Sorry, something went wrong. Please email us directly.', 'bot'); });
    });
  }

  /* ---------------- SCROLL REVEAL ---------------- */
  function initReveal() {
    var els = document.querySelectorAll('.svc-card,.cert-card,.cert-full,.step-card,.office-card,.benefit,.test-card,.stat-item,.principle,.learn-card,.about-card,.info-card,.reveal,.event-detail');
    if (!els.length) return;
    els.forEach(function (el) { el.classList.add('reveal-init'); });
    if (!('IntersectionObserver' in window)) { els.forEach(function (el) { el.classList.add('reveal-in'); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('reveal-in'); io.unobserve(e.target); } });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ---------------- HEARTBEAT (analytics) ---------------- */
  function initHeartbeat() {
    var sid = sessionStorage.getItem('cicm_sid');
    if (!sid) { sid = 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8); sessionStorage.setItem('cicm_sid', sid); }
    function ping() {
      try {
        fetch('/api/track/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sid: sid, path: location.pathname, mobile: window.innerWidth < 768 }) }).catch(function () {});
      } catch (e) {}
    }
    ping(); setInterval(ping, 25000);
  }

  /* ---------------- BACK TO TOP ---------------- */
  function initBackToTop() {
    var btn = document.getElementById('backTop');
    if (!btn) return;
    window.addEventListener('scroll', function () { btn.classList.toggle('show', window.scrollY > 600); }, { passive: true });
    btn.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
  }

  /* ---------------- EVENT REGISTRATION MODAL ---------------- */
  function initEventReg() {
    var modal = document.getElementById('regModal');
    if (!modal) return;
    var openers = document.querySelectorAll('[data-reg-open]');
    var closeEls = modal.querySelectorAll('[data-reg-close]');
    var form = document.getElementById('regForm');
    var steps = modal.querySelectorAll('.reg-step');
    var current = 0;

    function open(eventId, eventTitle) {
      form.reset();
      form.querySelector('[name="eventId"]').value = eventId;
      modal.querySelector('.reg-event-title').textContent = eventTitle || 'Event Registration';
      current = 0; showStep(0);
      var done = modal.querySelector('.reg-done'); if (done) done.style.display = 'none';
      form.style.display = '';
      modal.querySelector('.reg-steps-wrap').style.display = '';
      modal.classList.add('open'); document.body.style.overflow = 'hidden';
      // Ticket/payment gating removed — registration proceeds straight through.
    }
    function close() { modal.classList.remove('open'); document.body.style.overflow = ''; }
    function showStep(n) {
      steps.forEach(function (s, i) { s.classList.toggle('active', i === n); });
      modal.querySelectorAll('.reg-dot').forEach(function (d, i) { d.classList.toggle('active', i <= n); });
    }
    function valid(n) {
      var ok = true;
      steps[n].querySelectorAll('input[required],select[required]').forEach(function (inp) {
        if (!inp.value.trim()) { inp.classList.add('invalid'); ok = false; } else inp.classList.remove('invalid');
        if (inp.type === 'email' && inp.value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(inp.value)) { inp.classList.add('invalid'); ok = false; }
      });
      return ok;
    }

    openers.forEach(function (o) {
      o.addEventListener('click', function (e) { e.preventDefault(); open(o.dataset.regOpen, o.dataset.regTitle); });
    });
    closeEls.forEach(function (c) { c.addEventListener('click', close); });
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

    modal.querySelectorAll('[data-reg-next]').forEach(function (b) {
      b.addEventListener('click', function () { if (valid(current)) { current++; showStep(current); } });
    });
    modal.querySelectorAll('[data-reg-prev]').forEach(function (b) {
      b.addEventListener('click', function () { current--; showStep(current); });
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!valid(current)) return;
      var btn = form.querySelector('.reg-submit');
      var orig = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';
      var fd = new FormData(form); var obj = {}; fd.forEach(function (v, k) { obj[k] = v; });
      var eventId = obj.eventId;
      fetch('/api/events/' + eventId + '/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj)
      }).then(function (r) { return r.json(); }).then(function (res) {
        btn.disabled = false; btn.innerHTML = orig;
        if (res.success) {
          form.style.display = 'none';
          modal.querySelector('.reg-steps-wrap').style.display = 'none';
          var done = modal.querySelector('.reg-done');
          done.style.display = 'block';
          var em = modal.querySelector('.reg-enquiry-email');
          if (em && res.enquiryEmail) { em.textContent = res.enquiryEmail; em.href = 'mailto:' + res.enquiryEmail; }
        } else {
          alert(res.error || 'Something went wrong. Please try again.');
        }
      }).catch(function () { btn.disabled = false; btn.innerHTML = orig; alert('Network error. Please try again.'); });
    });
  }
})();
