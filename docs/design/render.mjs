// Render each design HTML to a 1920x1080 PNG via headless Chromium.
// Run with: node docs/design/render.mjs

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const screens = [
  { html: 'onboarding-01-provider.html', out: 'onboarding-01-provider.png' },
  { html: 'onboarding-02-apikey.html',   out: 'onboarding-02-apikey.png'   },
  { html: 'onboarding-03-ready.html',    out: 'onboarding-03-ready.png'    },
  { html: 'dashboard.html',              out: 'dashboard.png'              },
  { html: 'dashboard-chat.html',         out: 'dashboard-chat.png'         },
  { html: 'settings.html',               out: 'settings.png'               },
  { html: 'quickask.html',               out: 'quickask.png'               },
  { html: 'voice-orb.html',              out: 'voice-orb.png'              },
  { html: 'voice-orb-states.html',       out: 'voice-orb-states.png'       },
  { html: 'ghost-overlay.html',          out: 'ghost-overlay.png'          },
  { html: 'quickask-voice.html',         out: 'quickask-voice.png'         },
];

// Hover pass: same screen, one card forced into hovered state.
const hovers = [
  {
    html: 'dashboard.html',
    out:  'dashboard.hover.png',
    // target the Right Now card via CSS injection
    inject: `.right-now { transform: translateY(-3px); box-shadow: var(--g-rim), 0 50px 100px rgba(0,0,0,0.5) !important; background: linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.08) 100%) !important; } .right-now .chip-action:nth-child(1) { background: rgba(255,255,255,0.18) !important; border-color: rgba(255,255,255,0.35) !important; transform: translateY(-1px); }`,
  },
  {
    html: 'onboarding-01-provider.html',
    out:  'onboarding-01-provider.hover.png',
    inject: `.provider:nth-child(2) { background: rgba(255,255,255,0.11) !important; border-color: var(--g-edge-mid) !important; transform: translateY(-1px); box-shadow: 0 8px 24px rgba(0,0,0,0.2); }`,
  },
];

const width = 1920;
const height = 1080;

(async () => {
  const browser = await chromium.launch({
    executablePath: '/home/arnav/.cache/ms-playwright/chromium_headless_shell-1219/chrome-headless-shell-linux64/chrome-headless-shell',
    args: ['--force-color-profile=srgb', '--disable-web-security'],
  });

  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  });

  const page = await context.newPage();

  const shots = [...screens, ...hovers.map((h) => ({ ...h, isHover: true }))];

  for (const s of shots) {
    const url = 'file://' + resolve(__dirname, s.html);
    console.log(`→ ${s.html}  →  ${s.out}`);
    await page.goto(url, { waitUntil: 'networkidle' });
    // Ensure fonts are loaded
    await page.evaluate(() => document.fonts.ready);
    if (s.inject) {
      await page.addStyleTag({ content: s.inject });
    }
    // Give backdrop-filter + animations a frame to settle; freeze animations
    await page.addStyleTag({
      content: `*, *::before, *::after { animation-play-state: paused !important; transition: none !important; }`,
    });
    // Hide prototype chrome (proto-bar) in exported PNGs
    await page.evaluate(() => document.body.classList.add('shoot'));
    await page.waitForTimeout(200);
    await page.screenshot({
      path: resolve(__dirname, s.out),
      fullPage: false,
      omitBackground: false,
      type: 'png',
      clip: { x: 0, y: 0, width, height },
    });
  }

  await browser.close();
  console.log('done.');
})().catch((err) => { console.error(err); process.exit(1); });
