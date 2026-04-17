// Prototype router + keyboard shortcuts.
// Each page declares its slot in window.PROTO_FLOW before loading this script.

(function () {
  const FLOW = [
    { file: 'onboarding-01-provider.html', label: 'Onboarding · Provider' },
    { file: 'onboarding-02-apikey.html',   label: 'Onboarding · Key'      },
    { file: 'onboarding-03-ready.html',    label: 'Onboarding · Ready'    },
    { file: 'dashboard.html',              label: 'Dashboard'             },
    { file: 'dashboard-chat.html',         label: 'Dashboard · Chat open' },
    { file: 'quickask.html',               label: 'QuickAsk · text'       },
    { file: 'quickask-voice.html',         label: 'QuickAsk · voice'      },
    { file: 'voice-orb.html',              label: 'Voice orb · live'      },
    { file: 'voice-orb-states.html',       label: 'Voice orb · 4 states'  },
    { file: 'ghost-overlay.html',          label: 'Ghost Mode overlay'    },
    { file: 'settings.html',               label: 'Settings · Provider'   },
  ];

  const current = (window.PROTO_CURRENT || '').replace(/^.*\//, '');
  const idx = FLOW.findIndex((s) => s.file === current);
  const prev = idx > 0 ? FLOW[idx - 1] : null;
  const next = idx >= 0 && idx < FLOW.length - 1 ? FLOW[idx + 1] : null;
  const label = idx >= 0 ? FLOW[idx].label : (window.PROTO_LABEL || 'Prototype');
  const position = window.PROTO_POSITION === 'top-right' ? 'top-right' : 'bottom-left';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  function svg(path, vb) {
    const s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', vb || '0 0 24 24');
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', path);
    s.appendChild(p);
    return s;
  }
  function rectSvg() {
    const s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    [[3,3],[14,3],[3,14],[14,14]].forEach(([x,y]) => {
      const r = document.createElementNS(SVG_NS, 'rect');
      r.setAttribute('x', x); r.setAttribute('y', y);
      r.setAttribute('width', 7); r.setAttribute('height', 7); r.setAttribute('rx', 1.5);
      s.appendChild(r);
    });
    return s;
  }

  function link(href, text, iconNode, disabled) {
    const a = document.createElement('a');
    a.className = 'pb-btn';
    if (href && !disabled) a.href = href;
    else a.setAttribute('aria-disabled', 'true');
    if (iconNode) a.appendChild(iconNode);
    a.appendChild(document.createTextNode(text));
    return a;
  }
  function linkRight(href, text, iconNode, disabled) {
    const a = document.createElement('a');
    a.className = 'pb-btn';
    if (href && !disabled) a.href = href;
    else a.setAttribute('aria-disabled', 'true');
    a.appendChild(document.createTextNode(text));
    if (iconNode) a.appendChild(iconNode);
    return a;
  }

  const bar = document.createElement('div');
  bar.className = 'proto-bar' + (position === 'top-right' ? ' top-right' : '');

  bar.appendChild(link('index.html', 'Map', rectSvg(), false));
  const d1 = document.createElement('span'); d1.className = 'pb-divider'; bar.appendChild(d1);
  bar.appendChild(link(prev && prev.file, 'Prev', svg('M15 18l-6-6 6-6'), !prev));
  bar.appendChild(linkRight(next && next.file, 'Next', svg('M9 18l6-6-6-6'), !next));

  const lab = document.createElement('span'); lab.className = 'pb-label';
  lab.appendChild(document.createTextNode('Screen'));
  const sp = document.createElement('span'); sp.className = 'screen';
  sp.textContent = label + (idx >= 0 ? ` · ${idx + 1}/${FLOW.length}` : '');
  lab.appendChild(sp);
  bar.appendChild(lab);

  const kbd = document.createElement('span'); kbd.className = 'pb-kbd'; kbd.title = 'Toggle 8pt grid (G)';
  kbd.textContent = 'G'; bar.appendChild(kbd);

  function mount() {
    if (document.body) document.body.appendChild(bar);
    else document.addEventListener('DOMContentLoaded', () => document.body.appendChild(bar));
  }
  mount();

  document.addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if (k === 'arrowright' && next) location.href = next.file;
    else if (k === 'arrowleft' && prev) location.href = prev.file;
    else if (k === 'm') location.href = 'index.html';
    else if (k === 'g') document.body.classList.toggle('grid-on');
    else if (k === 'escape' && !location.pathname.endsWith('index.html')) location.href = 'index.html';
  });
})();
