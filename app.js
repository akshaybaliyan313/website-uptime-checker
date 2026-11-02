/* Dashboard: draws the site list from the data embedded in the page,
   then refreshes it from /status.json every 10 seconds. */

(function () {
  var SLOTS = 60;            // bars shown per site (matches RECENT in app.py)
  var POLL_SECONDS = 10;

  var listEl = document.getElementById('site-list');
  var verdictEl = document.getElementById('verdict');
  var sublineEl = document.getElementById('subline-text');
  var heroEl = document.querySelector('.hero');

  var data = JSON.parse(document.getElementById('initial-data').textContent);
  var nextIn = data.next_in;
  var offline = false;

  function esc(text) {
    var d = document.createElement('div');
    d.textContent = text == null ? '' : String(text);
    return d.innerHTML;
  }

  function stripHtml(ticks) {
    var maxMs = 1;
    ticks.forEach(function (t) { if (t.u && t.ms > maxMs) maxMs = t.ms; });

    var html = '';
    for (var i = 0; i < SLOTS - ticks.length; i++) html += '<span class="tick empty"></span>';

    ticks.forEach(function (t) {
      if (!t.u) {
        html += '<span class="tick down" title="' + esc(t.t + ', no response') + '"></span>';
      } else {
        var h = 28 + Math.round(72 * (t.ms / maxMs));   // 28% to 100% of the strip
        html += '<span class="tick" style="height:' + h + '%" title="' + esc(t.t + ', ' + t.ms + ' ms') + '"></span>';
      }
    });
    return html;
  }

  function stateText(s) {
    if (s.state === 'pending') return 'Waiting for first check';
    if (s.state === 'up') return '<b>Up</b>, ' + esc(s.response_ms) + ' ms';
    return '<b>Down</b>, ' + (s.status_code ? 'HTTP ' + esc(s.status_code) : 'no response');
  }

  function rowHtml(s) {
    var uptime = s.uptime == null ? '-' : s.uptime.toFixed(1) + '%';
    return '' +
      '<div class="row" data-state="' + s.state + '">' +
        '<a class="name" href="/history/' + s.id + '" title="' + esc(s.url) + '">' +
          '<span class="host">' + esc(s.host) + '</span>' +
          '<span class="state">' + stateText(s) + '</span>' +
        '</a>' +
        '<div class="strip" role="img" aria-label="Last ' + s.ticks.length + ' checks for ' + esc(s.host) + '">' + stripHtml(s.ticks) + '</div>' +
        '<div class="uptime"><strong>' + uptime + '</strong><span>uptime</span></div>' +
        '<form class="remove" method="post" action="/delete/' + s.id + '" data-confirm="Remove ' + esc(s.host) + ' and its history?">' +
          '<button type="submit">Remove</button>' +
        '</form>' +
      '</div>';
  }

  function renderVerdict() {
    var sites = data.sites;
    var total = sites.length;
    var down = sites.filter(function (s) { return s.state === 'down'; });
    var checked = sites.filter(function (s) { return s.state !== 'pending'; });
    var text, state;

    if (total === 0) {
      text = 'No sites yet.'; state = 'pending';
    } else if (checked.length === 0) {
      text = 'Running the first check.'; state = 'pending';
    } else if (total === 1) {
      text = sites[0].host + ' is ' + (sites[0].state === 'up' ? 'up.' : 'down.');
      state = sites[0].state;
    } else if (down.length === total) {
      text = 'All ' + total + ' sites are down.'; state = 'down';
    } else if (down.length > 0) {
      text = down.length + ' of ' + total + ' sites are down.'; state = 'down';
    } else {
      text = 'All ' + total + ' sites are up.'; state = 'up';
    }

    if (verdictEl.textContent !== text) verdictEl.textContent = text;   // only announce real changes
    verdictEl.setAttribute('data-state', state);
    heroEl.classList.toggle('is-down', state === 'down');
  }

  function renderSubline() {
    var text;
    if (offline) {
      text = 'Cannot reach the server. Trying again.';
    } else if (data.sites.length === 0) {
      text = 'Add a web address below to start checking it every minute.';
    } else if (!data.last_check) {
      text = 'Checking now.';
    } else if (nextIn > 0) {
      text = 'Last check at ' + data.last_check + '. Next check in ' + nextIn + (nextIn === 1 ? ' second.' : ' seconds.');
    } else {
      text = 'Last check at ' + data.last_check + '. Checking now.';
    }
    sublineEl.textContent = text;
  }

  function renderList() {
    if (data.sites.length === 0) {
      listEl.innerHTML = '<p class="empty">Nothing is being monitored. Enter a web address above, like example.com.</p>';
    } else {
      listEl.innerHTML = data.sites.map(rowHtml).join('');
    }
  }

  function renderAll() {
    renderVerdict();
    renderList();
    renderSubline();
  }

  function refresh() {
    fetch('/status.json', { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('bad status');
        return r.json();
      })
      .then(function (fresh) {
        data = fresh;
        nextIn = fresh.next_in;
        offline = false;
        renderAll();
      })
      .catch(function () {
        offline = true;
        renderSubline();
      });
  }

  // Confirm before removing a site
  document.addEventListener('submit', function (e) {
    var msg = e.target.getAttribute && e.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  renderAll();
  setInterval(function () {
    if (nextIn > 0) nextIn -= 1;
    renderSubline();
  }, 1000);
  setInterval(refresh, POLL_SECONDS * 1000);
})();
