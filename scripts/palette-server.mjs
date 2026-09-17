import http from 'http';

const PORT = parseInt(process.env.PORT || '3005', 10);

const HTML_CONTENT = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>XerService • Home Page Duplicate (#1e525a)</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    :root {
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      --font-mono: 'JetBrains Mono', monospace;

      /* Dark Theme (Default) */
      --bg: #07070f;
      --bg-card: #0f0f1d;
      --bg-secondary: #121226;
      --border: #1e1e38;
      --border-strong: #30304a;
      --fg: #f0f0ff;
      --fg-muted: #9898c0;
      --fg-subtle: #58587a;

      /* Target Theme Color: #1e525a */
      --accent: #1e525a;
      --accent-hover: #2b747f;
      --accent-fg: #ffffff;
      --accent-muted: rgba(30, 82, 90, 0.20);
      --accent-border: rgba(30, 82, 90, 0.45);
      --shadow-accent: 0 8px 28px rgba(30, 82, 90, 0.32);
      --glass: rgba(7, 7, 15, 0.88);
    }

    body.light-theme {
      --bg: #ffffff;
      --bg-card: #ffffff;
      --bg-secondary: #f7f7fa;
      --border: #e2e2ec;
      --border-strong: #c0c0d0;
      --fg: #0a0a12;
      --fg-muted: #52525e;
      --fg-subtle: #8888a0;

      --accent: #1e525a;
      --accent-hover: #153c42;
      --accent-muted: rgba(30, 82, 90, 0.12);
      --accent-border: rgba(30, 82, 90, 0.32);
      --shadow-accent: 0 8px 28px rgba(30, 82, 90, 0.22);
      --glass: rgba(255, 255, 255, 0.90);
    }

    /* Comparison override for original cyan */
    body.original-cyan {
      --accent: #54bdce !important;
      --accent-hover: #42b8ce !important;
      --accent-muted: rgba(84, 189, 206, 0.15) !important;
      --accent-border: rgba(84, 189, 206, 0.34) !important;
      --shadow-accent: 0 8px 28px rgba(84, 189, 206, 0.30) !important;
    }

    body {
      font-family: var(--font-sans);
      background: var(--bg);
      color: var(--fg);
      line-height: 1.6;
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
      transition: background-color 0.25s ease, color 0.25s ease;
    }

    .container {
      max-width: 1080px;
      margin: 0 auto;
      padding: 0 16px;
    }

    /* ─── Top Comparison Toolbar ─── */
    .toolbar {
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      padding: 10px 0;
      position: sticky;
      top: 0;
      z-index: 110;
      backdrop-filter: blur(12px);
    }
    .toolbar-content {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
    }
    .toolbar-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      font-weight: 700;
    }
    .color-chip {
      width: 18px;
      height: 18px;
      border-radius: 4px;
      background: var(--accent);
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      transition: background-color 0.2s;
    }
    .pill-tag {
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 6px;
      background: var(--accent-muted);
      color: var(--accent);
      border: 1px solid var(--accent-border);
    }
    .toolbar-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    /* ─── Button Styles ─── */
    .btn {
      font-family: inherit;
      font-size: 12.5px;
      font-weight: 600;
      padding: 6px 12px;
      border-radius: 8px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid var(--border);
      background: var(--bg-card);
      color: var(--fg);
      text-decoration: none;
      transition: all 0.15s ease;
    }
    .btn:hover {
      border-color: var(--border-strong);
      transform: translateY(-1px);
    }
    .btn-accent {
      background: var(--accent);
      color: var(--accent-fg);
      border-color: transparent;
      box-shadow: 0 3px 12px var(--shadow-accent);
    }
    .btn-accent:hover {
      background: var(--accent-hover);
    }
    .btn-outline {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--fg);
    }
    .btn-sm {
      padding: 4px 10px;
      font-size: 11.5px;
    }

    /* ─── Main XerService Navigation ─── */
    .navbar {
      position: sticky;
      top: 45px;
      z-index: 100;
      background: var(--glass);
      border-bottom: 1px solid var(--border);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
    }
    .nav-shell {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 60px;
      gap: 12px;
    }
    .nav-brand {
      display: flex;
      align-items: center;
      gap: 8px;
      text-decoration: none;
      color: var(--fg);
    }
    .nav-logo-box {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: var(--accent);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-weight: 900;
      font-size: 14px;
      box-shadow: 0 2px 10px var(--shadow-accent);
    }
    .nav-title {
      font-size: 20px;
      font-weight: 800;
      letter-spacing: -0.04em;
    }
    .nav-links {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .nav-link {
      font-size: 13.5px;
      color: var(--fg-muted);
      text-decoration: none;
      font-weight: 500;
    }
    .nav-link:hover, .nav-link.active {
      color: var(--accent);
    }

    /* ─── Home Page Body ─── */
    .home-content {
      padding: 24px 0 60px;
    }

    .home-info-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 24px;
    }
    @media (max-width: 680px) {
      .home-info-grid {
        grid-template-columns: 1fr;
      }
    }

    .home-info-card {
      display: grid;
      grid-template-columns: 32px minmax(0, 1fr);
      gap: 12px;
      align-items: start;
      padding: 16px;
      border-radius: 12px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      box-shadow: 0 2px 8px rgba(0,0,0,0.03);
    }
    .home-info-card h2 {
      font-size: 14px;
      font-weight: 800;
      margin-bottom: 4px;
      letter-spacing: -0.01em;
    }
    .home-info-card p {
      color: var(--fg-muted);
      font-size: 12px;
      line-height: 1.5;
      margin-bottom: 8px;
    }
    .whatsapp-card {
      border-color: rgba(22, 163, 74, 0.28);
    }

    /* ─── Shop Card ─── */
    .shops-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 14px;
    }
    .shop-card {
      display: grid;
      grid-template-columns: 76px minmax(0, 1fr);
      gap: 14px;
      padding: 16px;
      border-radius: 14px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      box-shadow: 0 3px 14px rgba(0,0,0,0.04);
      align-items: center;
      transition: all 0.2s ease;
      cursor: pointer;
    }
    .shop-card:hover {
      transform: translateY(-2px);
      border-color: var(--accent-border);
      box-shadow: 0 8px 24px var(--shadow-accent);
    }
    .shop-thumb {
      width: 76px;
      height: 94px;
      border-radius: 10px;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      font-size: 22px;
      font-weight: 900;
      color: var(--accent);
    }
    .shop-header {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 4px;
    }
    .shop-name {
      font-size: 16px;
      font-weight: 900;
      letter-spacing: -0.02em;
    }
    .badge {
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      padding: 2px 7px;
      border-radius: 6px;
    }
    .badge-open {
      background: rgba(22, 163, 74, 0.15);
      color: #16a34a;
      border: 1px solid rgba(22, 163, 74, 0.35);
    }
    .badge-warn {
      background: var(--accent-muted);
      color: var(--accent);
      border: 1px solid var(--accent-border);
    }
    .shop-time {
      font-size: 12px;
      color: var(--fg-muted);
      display: flex;
      align-items: center;
      gap: 5px;
      margin-bottom: 10px;
    }
    .shop-pricing-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .shop-rates {
      font-size: 11.5px;
      color: var(--fg-muted);
      font-weight: 700;
    }
    .shop-rates strong {
      color: var(--accent);
      font-weight: 800;
    }

    /* ─── View Switcher Tabs ─── */
    .mode-tab {
      padding: 6px 14px;
      font-size: 12px;
      font-weight: 700;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      background: transparent;
      color: var(--fg-muted);
      transition: all 0.15s;
    }
    .mode-tab.active {
      background: var(--accent);
      color: #ffffff;
    }

    /* ─── Toast ─── */
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #10b981;
      color: #ffffff;
      padding: 10px 18px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      box-shadow: 0 8px 24px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      gap: 8px;
      z-index: 1000;
      opacity: 0;
      transform: translateY(10px);
      transition: all 0.2s ease;
      pointer-events: none;
    }
    .toast.show {
      opacity: 1;
      transform: translateY(0);
    }
  </style>
</head>
<body>
  <div id="toast" class="toast">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
    <span id="toast-text">Copied!</span>
  </div>

  <!-- ─── Top Comparison Control Bar ─── -->
  <div class="toolbar">
    <div class="container toolbar-content">
      <div class="toolbar-badge">
        <div class="color-chip" id="colorChip"></div>
        <span>Home Page Duplicate</span>
        <span class="pill-tag" id="themeTag">#1e525a (Deep Oceanic Cyan)</span>
      </div>

      <div class="toolbar-actions">
        <!-- Compare Color Switcher -->
        <button id="compareColorBtn" class="btn btn-sm" title="Toggle between new #1e525a and original #54bdce">
          <span id="compareIcon">🔄</span>
          <span id="compareText">Switch to Original (#54bdce)</span>
        </button>

        <!-- Light / Dark Mode -->
        <button id="themeModeBtn" class="btn btn-sm">
          <span id="themeModeIcon">☀️</span>
          <span id="themeModeText">Light Mode</span>
        </button>

        <!-- Copy CSS Variables -->
        <button id="copyVarsBtn" class="btn btn-accent btn-sm">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>
          Copy #1e525a CSS
        </button>
      </div>
    </div>
  </div>

  <!-- ─── XerService Navigation Bar ─── -->
  <nav class="navbar">
    <div class="container nav-shell">
      <div class="nav-brand">
        <div class="nav-logo-box">X</div>
        <span class="nav-title">xerservice</span>
      </div>

      <div class="nav-links">
        <a href="#" class="nav-link active">Print Shops</a>
        <a href="#" class="nav-link">How it Works</a>
        <a href="#" class="btn btn-accent btn-sm" style="border-radius: 20px; padding: 6px 14px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
          Upload Document
        </a>
      </div>
    </div>
  </nav>

  <!-- ─── Home Page Body Replica ─── -->
  <main class="container home-content">
    <!-- Notice Banners -->
    <div class="home-info-grid">
      <div class="home-info-card" style="border-left: 3px solid var(--accent);">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><polyline points="9 12 11 14 15 10"></polyline></svg>
        <div>
          <h2>Coimbatore shops only for now</h2>
          <p>Use XerService for listed Coimbatore print shops. Check the shop details clearly before paying.</p>
        </div>
      </div>

      <div class="home-info-card whatsapp-card">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
        <div>
          <h2>Print from WhatsApp</h2>
          <p>Connect your WhatsApp once. After that, send your PDF to XerService and choose it from your account before placing the print order.</p>
          <button class="btn btn-outline btn-sm" style="border-color: #16a34a55; color: #16a34a;">Link WhatsApp</button>
        </div>
      </div>
    </div>

    <!-- Section Header -->
    <div style="display: flex; justify-content: space-between; align-items: flex-end; gap: 10px; margin-bottom: 16px;">
      <div>
        <h1 style="font-size: 22px; font-weight: 900; letter-spacing: -0.02em;">Print Shops</h1>
        <p style="font-size: 13px; color: var(--fg-muted);">Ready for instant print orders • Live preview duplicate with <strong id="accentLabel" style="color: var(--accent);">#1e525a</strong></p>
      </div>
      <span class="pill-tag">3 Shops Available</span>
    </div>

    <!-- Shops List -->
    <div class="shops-grid">
      <!-- Shop 1 -->
      <div class="shop-card">
        <div class="shop-thumb">AN</div>
        <div style="min-width: 0;">
          <div class="shop-header">
            <h2 class="shop-name">Anna Nagar Xerox & Digital Prints</h2>
            <span class="badge badge-open">Open</span>
          </div>
          <div class="shop-time">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            8:30 AM – 9:30 PM
          </div>
          <div class="shop-pricing-row">
            <div class="shop-rates">
              B&W <strong>Rs 1.50</strong> · Color <strong>Rs 8.00</strong>
            </div>
            <button class="btn btn-accent btn-sm">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
              Upload & Print
            </button>
          </div>
        </div>
      </div>

      <!-- Shop 2 -->
      <div class="shop-card">
        <div class="shop-thumb">PS</div>
        <div style="min-width: 0;">
          <div class="shop-header">
            <h2 class="shop-name">PSG Tech Gate Print Studio</h2>
            <span class="badge badge-open">Open</span>
          </div>
          <div class="shop-time">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            8:00 AM – 10:00 PM
          </div>
          <div class="shop-pricing-row">
            <div class="shop-rates">
              B&W <strong>Rs 1.00</strong> · Color <strong>Rs 7.00</strong>
            </div>
            <button class="btn btn-accent btn-sm">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
              Upload & Print
            </button>
          </div>
        </div>
      </div>

      <!-- Shop 3 -->
      <div class="shop-card">
        <div class="shop-thumb">RS</div>
        <div style="min-width: 0;">
          <div class="shop-header">
            <h2 class="shop-name">RS Puram Document Centre</h2>
            <span class="badge badge-warn">⚠ Closing Soon</span>
          </div>
          <p style="font-size: 11px; color: var(--accent); font-weight: 800; margin-bottom: 6px;">
            Orders paused — closing in 20 minutes.
          </p>
          <div class="shop-time">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            9:00 AM – 8:30 PM
          </div>
          <div class="shop-pricing-row">
            <div class="shop-rates">
              B&W <strong>Rs 2.00</strong> · Color <strong>Rs 10.00</strong>
            </div>
            <button class="btn btn-accent btn-sm">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
              Upload & Print
            </button>
          </div>
        </div>
      </div>
    </div>
  </main>

  <script>
    let isOriginal = false;
    let isLight = false;

    const compareBtn = document.getElementById('compareColorBtn');
    const themeModeBtn = document.getElementById('themeModeBtn');
    const copyVarsBtn = document.getElementById('copyVarsBtn');
    const toast = document.getElementById('toast');
    const toastText = document.getElementById('toast-text');

    function showToast(msg) {
      toastText.innerText = msg;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2200);
    }

    // Toggle Color comparison: #1e525a vs #54bdce
    compareBtn.addEventListener('click', () => {
      isOriginal = !isOriginal;
      document.body.classList.toggle('original-cyan', isOriginal);

      const chip = document.getElementById('colorChip');
      const tag = document.getElementById('themeTag');
      const label = document.getElementById('accentLabel');
      const compareText = document.getElementById('compareText');

      if (isOriginal) {
        chip.style.background = '#54bdce';
        tag.innerText = '#54bdce (Original Dusty Cyan)';
        label.innerText = '#54bdce';
        label.style.color = '#54bdce';
        compareText.innerText = 'Switch to New (#1e525a)';
        showToast('Switched to Original #54bdce');
      } else {
        chip.style.background = '#1e525a';
        tag.innerText = '#1e525a (Deep Oceanic Cyan)';
        label.innerText = '#1e525a';
        label.style.color = '#1e525a';
        compareText.innerText = 'Switch to Original (#54bdce)';
        showToast('Switched to #1e525a');
      }
    });

    // Toggle Theme Mode: Dark vs Light
    themeModeBtn.addEventListener('click', () => {
      isLight = !isLight;
      document.body.classList.toggle('light-theme', isLight);
      document.getElementById('themeModeIcon').innerText = isLight ? '🌙' : '☀️';
      document.getElementById('themeModeText').innerText = isLight ? 'Dark Mode' : 'Light Mode';
      showToast(isLight ? 'Light Mode active' : 'Dark Mode active');
    });

    // Copy CSS Variables
    copyVarsBtn.addEventListener('click', () => {
      const css = \`:root {
  --accent: #1e525a;
  --accent-hover: #153c42;
  --accent-fg: #ffffff;
  --accent-muted: rgba(30, 82, 90, 0.12);
  --accent-border: rgba(30, 82, 90, 0.32);
  --shadow-accent: 0 8px 28px rgba(30, 82, 90, 0.24);
}

:root.dark {
  --accent: #1e525a;
  --accent-hover: #2b747f;
  --accent-muted: rgba(30, 82, 90, 0.20);
  --accent-border: rgba(30, 82, 90, 0.45);
  --shadow-accent: 0 8px 32px rgba(30, 82, 90, 0.32);
}\`;
      navigator.clipboard.writeText(css);
      showToast('Copied #1e525a CSS Variables!');
    });
  </script>
</body>
</html>
`;

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  });
  res.end(HTML_CONTENT);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 XerService Home Page Duplicate (#1e525a) is running alone on:`);
  console.log(`👉 http://localhost:${PORT}\n`);
});
