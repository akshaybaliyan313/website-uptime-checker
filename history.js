/* History page: draws the response-time chart as plain SVG. */

(function () {
  var box = document.getElementById('chart');
  var points = JSON.parse(document.getElementById('chart-data').textContent);
  var NS = 'http://www.w3.org/2000/svg';

  if (points.length < 2) {
    box.innerHTML = '<p class="chart-note">A chart appears after two checks.</p>';
    return;
  }

  var W = 820, H = 240, padL = 60, padR = 14, padT = 12, padB = 28;
  var innerW = W - padL - padR, innerH = H - padT - padB;

  var maxMs = 0;
  points.forEach(function (p) { if (p.up && p.ms > maxMs) maxMs = p.ms; });
  var step = maxMs > 1000 ? 500 : maxMs > 400 ? 200 : maxMs > 150 ? 100 : 50;
  var top = Math.max(step, Math.ceil(maxMs / step) * step);

  function x(i) { return padL + (i / (points.length - 1)) * innerW; }
  function y(ms) { return padT + innerH - (ms / top) * innerH; }

  function el(name, attrs) {
    var node = document.createElementNS(NS, name);
    for (var k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }

  var svg = el('svg', {
    viewBox: '0 0 ' + W + ' ' + H, role: 'img',
    'aria-label': 'Response time for the last ' + points.length + ' checks, up to ' + top + ' milliseconds'
  });

  // Horizontal guides with millisecond labels
  for (var g = 0; g <= 4; g++) {
    var ms = (top / 4) * g;
    svg.appendChild(el('line', { class: 'grid', x1: padL, x2: W - padR, y1: y(ms), y2: y(ms) }));
    var label = el('text', { class: 'axis-label', x: padL - 8, y: y(ms) + 4, 'text-anchor': 'end' });
    label.textContent = Math.round(ms) + ' ms';
    svg.appendChild(label);
  }

  // Failed checks: red bands behind the line
  points.forEach(function (p, i) {
    if (!p.up) {
      var band = el('rect', { class: 'miss', x: x(i) - 2, y: padT, width: 4, height: innerH, rx: 2 });
      var t = el('title', {}); t.textContent = p.t + ', no response';
      band.appendChild(t);
      svg.appendChild(band);
    }
  });

  // Line, broken wherever a check failed
  var d = '', pen = false;
  points.forEach(function (p, i) {
    if (!p.up) { pen = false; return; }
    d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.ms).toFixed(1) + ' ';
    pen = true;
  });
  svg.appendChild(el('path', { class: 'line', d: d.trim() }));

  // Dots with hover text (only when there are few enough to stay readable)
  if (points.length <= 60) {
    points.forEach(function (p, i) {
      if (!p.up) return;
      var dot = el('circle', { class: 'dot', cx: x(i).toFixed(1), cy: y(p.ms).toFixed(1), r: 3 });
      var t = el('title', {}); t.textContent = p.t + ', ' + p.ms + ' ms';
      dot.appendChild(t);
      svg.appendChild(dot);
    });
  }

  // Time labels at both ends
  var first = el('text', { class: 'axis-label', x: padL, y: H - 8, 'text-anchor': 'start' });
  first.textContent = points[0].t;
  var last = el('text', { class: 'axis-label', x: W - padR, y: H - 8, 'text-anchor': 'end' });
  last.textContent = points[points.length - 1].t;
  svg.appendChild(first);
  svg.appendChild(last);

  box.appendChild(svg);
})();
