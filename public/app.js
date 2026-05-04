// ═══════════════════════════════════════════════
// GRUDGE ARENA — Frontend App
// Connects to the Bridge API on the VPS
// ═══════════════════════════════════════════════

const API = 'https://wow.grudge-studio.com/api';

const App = {
  // Session state
  accountId: null,
  username: null,
  password: null,
  characters: [],
  charOptions: null, // race/class combos from server

  // Character creation state
  selectedFaction: null,
  selectedRace: null,
  selectedClass: null,
  selectedSpec: null,
  selectedGear: null,

  // ── Init ──────────────────────────────────────
  init() {
    this.playIntro();
    this.bindNav();
    this.bindLogin();
    this.bindFaction();
    this.bindQueue();
    this.bindPlay();
    this.bindCreate();
    this.checkHealth();
  },

  // ── Intro Sequence ────────────────────────────
  // Plays intro.mp4, transitions to splash.png, then fades out
  playIntro() {
    const overlay = document.getElementById('introOverlay');
    const video = document.getElementById('introVideo');
    const splash = document.getElementById('splashImg');

    if (!overlay || !video) return;

    // Try to play the video
    const playPromise = video.play();

    if (playPromise !== undefined) {
      playPromise.catch(() => {
        // Autoplay blocked — skip straight to splash
        this.showSplashThenFade(overlay, splash);
      });
    }

    // When video ends, show splash image then fade out
    video.addEventListener('ended', () => {
      this.showSplashThenFade(overlay, splash);
    });

    // Safety timeout — if video hangs, force dismiss after 15s
    setTimeout(() => {
      if (!overlay.classList.contains('gone')) {
        this.dismissIntro(overlay);
      }
    }, 15000);

    // Click/tap to skip
    overlay.addEventListener('click', () => {
      video.pause();
      this.dismissIntro(overlay);
    });
  },

  showSplashThenFade(overlay, splash) {
    splash.classList.remove('hidden');
    // Trigger CSS transition
    requestAnimationFrame(() => splash.classList.add('visible'));
    // Hold splash for 2 seconds, then fade out the whole overlay
    setTimeout(() => this.dismissIntro(overlay), 2000);
  },

  dismissIntro(overlay) {
    overlay.classList.add('fade-out');
    setTimeout(() => overlay.classList.add('gone'), 800);
  },

  // ── Navigation ────────────────────────────────
  bindNav() {
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const view = link.dataset.view;
        if (view) this.showView(view);
      });
    });
  },

  showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));

    const view = document.getElementById(`view-${name}`);
    const link = document.querySelector(`[data-view="${name}"]`);
    if (view) view.classList.add('active');
    if (link) link.classList.add('active');

    // Load data when switching views
    if (name === 'records' && this.accountId) this.loadRecords();
  },

  showAuthNav() {
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('hidden'));
  },

  // ── Health Check ──────────────────────────────
  async checkHealth() {
    const el = document.getElementById('serverStatus');
    try {
      const res = await fetch(`${API}/health`, { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      if (data.status === 'ok') {
        el.innerHTML = '<span class="status-dot online"></span>Online';
      } else {
        el.innerHTML = '<span class="status-dot offline"></span>DB Error';
      }
    } catch {
      el.innerHTML = '<span class="status-dot offline"></span>Offline';
    }
  },

  // ── Login (Puter Auth) ─────────────────────────
  bindLogin() {
    const btn = document.getElementById('loginBtn');
    btn.addEventListener('click', () => this.login());

    // Auto-login if already signed in to Puter
    if (typeof puter !== 'undefined' && puter.auth.isSignedIn()) {
      this.login();
    }
  },

  async login() {
    const errorEl = document.getElementById('loginError');
    const statusEl = document.getElementById('loginStatus');
    const btn = document.getElementById('loginBtn');

    errorEl.classList.add('hidden');
    statusEl.classList.remove('hidden');
    statusEl.textContent = 'Authenticating...';
    btn.disabled = true;

    try {
      // Step 1: Puter auth — opens popup if not signed in
      if (typeof puter === 'undefined') throw new Error('Auth service unavailable');
      if (!puter.auth.isSignedIn()) {
        await puter.auth.signIn();
      }
      const puterUser = await puter.auth.getUser();
      const puterToken = puter.authToken;

      statusEl.textContent = `Welcome, ${puterUser.username}. Connecting to arena...`;

      // Step 2: Send Puter UUID to bridge → MaNGOS account
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          puterUuid: puterUser.uuid,
          puterUsername: puterUser.username,
          puterToken,
        }),
      });

      if (!res.ok) throw new Error((await res.json()).error || 'Login failed');
      const data = await res.json();

      this.accountId = data.accountId;
      this.username = data.username;
      this.password = data.password || null;
      this.characters = data.characters || [];
      this.puterUuid = puterUser.uuid;

      // Show nav and go to character view
      statusEl.classList.add('hidden');
      this.showAuthNav();
      await this.loadCharOptions();
      this.showView('character');
      this.renderExistingChars();

    } catch (e) {
      statusEl.classList.add('hidden');
      this.showError(errorEl, e.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<img src="favicon.png" alt="" class="btn-logo"> Sign In with Grudge';
    }
  },

  // ── Character Options ─────────────────────────
  async loadCharOptions() {
    if (this.charOptions) return;
    try {
      const res = await fetch(`${API}/character/options`);
      this.charOptions = await res.json();
    } catch (e) {
      console.error('Failed to load character options:', e);
    }
  },

  renderExistingChars() {
    const container = document.getElementById('existingChars');
    const list = document.getElementById('charList');

    if (!this.characters.length) {
      container.classList.add('hidden');
      return;
    }

    container.classList.remove('hidden');
    const races = this.charOptions?.races || {};
    const classes = this.charOptions?.classes || {};

    list.innerHTML = this.characters.map(c => `
      <div class="char-card stone-panel">
        <div class="char-name gold-text">${this.escapeHtml(c.name)}</div>
        <div class="char-info">${races[c.race] || 'Unknown'} ${classes[c.class] || 'Unknown'}</div>
        <div class="char-level">Level ${c.level}</div>
      </div>
    `).join('');
  },

  // ── Faction Selection ─────────────────────────
  bindFaction() {
    document.querySelectorAll('.faction-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const faction = btn.dataset.faction;
        this.selectFaction(faction);
      });
    });
  },

  selectFaction(faction) {
    this.selectedFaction = faction;
    this.selectedRace = null;
    this.selectedClass = null;

    // Update button states
    document.querySelectorAll('.faction-btn').forEach(b => b.classList.remove('selected'));
    document.querySelector(`[data-faction="${faction}"]`).classList.add('selected');

    // Show race/class step
    this.renderRaceClass();
    document.getElementById('step-raceclass').classList.remove('hidden');
    document.getElementById('step-specgear').classList.add('hidden');
    document.getElementById('step-name').classList.add('hidden');
    document.getElementById('createSuccess').classList.add('hidden');
  },

  renderRaceClass() {
    if (!this.charOptions) return;

    const allianceRaces = [1, 3, 4, 7]; // Human, Dwarf, NE, Gnome
    const hordeRaces = [2, 5, 6, 8]; // Orc, Undead, Tauren, Troll
    const validRaces = this.selectedFaction === 'Alliance' ? allianceRaces : hordeRaces;

    const races = this.charOptions.races;
    const raceImgMap = { 1: 'human', 2: 'orc', 3: 'dwarf', 4: 'nightelf', 5: 'undead', 6: 'tauren', 7: 'gnome', 8: 'troll' };
    const raceList = document.getElementById('raceList');
    raceList.innerHTML = validRaces
      .filter(r => races[r])
      .map(r => `<button class="option-btn" data-race="${r}"><img src="img/races/${raceImgMap[r]}.jpg" alt="${races[r]}">${races[r]}</button>`)
      .join('');

    raceList.querySelectorAll('.option-btn').forEach(btn => {
      btn.addEventListener('click', () => this.selectRace(parseInt(btn.dataset.race)));
    });

    // Clear class list until race is picked
    document.getElementById('classList').innerHTML =
      '<p style="color:var(--fg-muted);font-size:0.85rem;">Select a race first</p>';
  },

  selectRace(raceId) {
    this.selectedRace = raceId;
    this.selectedClass = null;

    // Highlight
    document.querySelectorAll('#raceList .option-btn').forEach(b => b.classList.remove('selected'));
    document.querySelector(`#raceList [data-race="${raceId}"]`).classList.add('selected');

    // Filter valid classes for this race
    const validCombos = this.charOptions.combos.filter(c => c.race === raceId);
    const validClassIds = validCombos.map(c => c.class);
    const classes = this.charOptions.classes;

    const classList = document.getElementById('classList');
    classList.innerHTML = validClassIds
      .filter(id => classes[id])
      .map(id => `<button class="option-btn" data-class="${id}" style="color:var(--class-${this.classVarName(id)})"><img src="img/classes/${this.classVarName(id)}.jpg" alt="${classes[id]}">${classes[id]}</button>`)
      .join('');

    classList.querySelectorAll('.option-btn').forEach(btn => {
      btn.addEventListener('click', () => this.selectClass(parseInt(btn.dataset.class)));
    });
  },

  classVarName(classId) {
    const map = {
      1: 'warrior', 2: 'paladin', 3: 'hunter', 4: 'rogue',
      5: 'priest', 7: 'shaman', 8: 'mage', 9: 'warlock', 11: 'druid'
    };
    return map[classId] || 'warrior';
  },

  async selectClass(classId) {
    this.selectedClass = classId;

    document.querySelectorAll('#classList .option-btn').forEach(b => b.classList.remove('selected'));
    document.querySelector(`#classList [data-class="${classId}"]`).classList.add('selected');

    // Load specs and gear for this class
    try {
      const res = await fetch(`${API}/character/class/${classId}`);
      const data = await res.json();
      this.renderSpecGear(data);
      document.getElementById('step-specgear').classList.remove('hidden');
    } catch (e) {
      console.error('Failed to load class options:', e);
    }
  },

  renderSpecGear(data) {
    const specList = document.getElementById('specList');
    const gearList = document.getElementById('gearList');

    if (data.specs && data.specs.length) {
      specList.innerHTML = data.specs.map(s => `
        <button class="option-btn" data-spec="${s.entry}">
          ${this.escapeHtml(s.name)}
          ${s.role ? `<span class="option-role">${this.escapeHtml(s.role)}</span>` : ''}
        </button>
      `).join('');

      specList.querySelectorAll('.option-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          this.selectedSpec = parseInt(btn.dataset.spec);
          specList.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          this.maybeShowNameStep();
        });
      });
    } else {
      specList.innerHTML = '<p style="color:var(--fg-muted);font-size:0.85rem;">No templates available</p>';
      this.selectedSpec = null;
    }

    if (data.gear && data.gear.length) {
      gearList.innerHTML = data.gear.map(g => `
        <button class="option-btn" data-gear="${g.entry}">
          ${this.escapeHtml(g.name)}
          ${g.role ? `<span class="option-role">${this.escapeHtml(g.role)}</span>` : ''}
        </button>
      `).join('');

      gearList.querySelectorAll('.option-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          this.selectedGear = parseInt(btn.dataset.gear);
          gearList.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          this.maybeShowNameStep();
        });
      });
    } else {
      gearList.innerHTML = '<p style="color:var(--fg-muted);font-size:0.85rem;">No templates available</p>';
      this.selectedGear = null;
    }

    // If no specs/gear, go straight to name
    if ((!data.specs || !data.specs.length) && (!data.gear || !data.gear.length)) {
      this.showNameStep();
    }
  },

  maybeShowNameStep() {
    // Show name step once at least spec or gear is chosen (or if none are available)
    const specList = document.getElementById('specList');
    const gearList = document.getElementById('gearList');
    const hasSpecs = specList.querySelector('.option-btn');
    const hasGear = gearList.querySelector('.option-btn');

    const specOk = !hasSpecs || this.selectedSpec !== null;
    const gearOk = !hasGear || this.selectedGear !== null;

    if (specOk && gearOk) this.showNameStep();
  },

  showNameStep() {
    const races = this.charOptions?.races || {};
    const classes = this.charOptions?.classes || {};

    document.getElementById('charSummary').innerHTML =
      `<strong>${this.selectedFaction}</strong> · ` +
      `<strong>${races[this.selectedRace] || '?'}</strong> ` +
      `<strong>${classes[this.selectedClass] || '?'}</strong> · Level 60`;

    document.getElementById('step-name').classList.remove('hidden');
    document.getElementById('charNameInput').focus();
  },

  // ── Create Character ──────────────────────────
  bindCreate() {
    document.getElementById('createCharBtn').addEventListener('click', () => this.createCharacter());
    document.getElementById('charNameInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.createCharacter();
    });
  },

  async createCharacter() {
    const nameInput = document.getElementById('charNameInput');
    const errorEl = document.getElementById('createError');
    const name = nameInput.value.trim();

    errorEl.classList.add('hidden');
    if (!name) {
      this.showError(errorEl, 'Enter a character name');
      return;
    }
    if (!/^[A-Za-z]{2,12}$/.test(name)) {
      this.showError(errorEl, 'Name must be 2-12 letters only');
      return;
    }

    const btn = document.getElementById('createCharBtn');
    btn.disabled = true;
    btn.textContent = 'Creating...';

    try {
      const res = await fetch(`${API}/character/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: this.accountId,
          name,
          race: this.selectedRace,
          classId: this.selectedClass,
          specEntry: this.selectedSpec,
          gearEntry: this.selectedGear,
        }),
      });

      if (!res.ok) throw new Error((await res.json()).error || 'Creation failed');
      const char = await res.json();

      // Show success
      document.getElementById('step-faction').classList.add('hidden');
      document.getElementById('step-raceclass').classList.add('hidden');
      document.getElementById('step-specgear').classList.add('hidden');
      document.getElementById('step-name').classList.add('hidden');

      document.getElementById('createdCharInfo').innerHTML =
        `<strong class="gold-text">${this.escapeHtml(char.name)}</strong><br>` +
        `${char.raceName} ${char.className} · ${char.faction}<br>` +
        `Level ${char.level}`;

      document.getElementById('createSuccess').classList.remove('hidden');

      // Add to local character list
      this.characters.push(char);

    } catch (e) {
      this.showError(errorEl, e.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span class="btn-icon">✦</span> Create Character';
    }
  },

  // ── Queue ─────────────────────────────────────
  bindQueue() {
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        this.joinQueue(mode);
      });
    });
  },

  async joinQueue(mode) {
    if (!this.accountId) {
      this.showView('home');
      return;
    }

    // Highlight selected mode
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('selected'));
    document.querySelector(`[data-mode="${mode}"]`).classList.add('selected');

    // Show spinner
    const statusPanel = document.getElementById('queueStatus');
    const matchPanel = document.getElementById('matchReady');
    statusPanel.classList.remove('hidden');
    matchPanel.classList.add('hidden');
    document.getElementById('queueMsg').textContent = `Queuing ${mode} WSG...`;
    document.getElementById('queueDetail').textContent = 'Spawning battlebots...';

    try {
      const res = await fetch(`${API}/queue/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: this.accountId, mode }),
      });

      if (!res.ok) throw new Error((await res.json()).error || 'Queue failed');
      const data = await res.json();

      // Show match ready
      statusPanel.classList.add('hidden');
      matchPanel.classList.remove('hidden');
      document.getElementById('matchInfo').innerHTML =
        `<strong>${mode} Warsong Gulch</strong><br>` +
        `${data.botsAdded} bots spawned<br>` +
        `Match ID: ${data.matchId}`;

      this.currentMatchId = data.matchId;

    } catch (e) {
      document.getElementById('queueMsg').textContent = 'Queue Failed';
      document.getElementById('queueDetail').textContent = e.message;
    }
  },

  // ── Play Session (Embedded Guacamole) ────────
  guacClient: null,

  bindPlay() {
    document.getElementById('playBtn').addEventListener('click', () => this.launchSession());
    document.getElementById('gameFullscreenBtn').addEventListener('click', () => this.toggleFullscreen());
    document.getElementById('gameDisconnectBtn').addEventListener('click', () => this.disconnectGame());
  },

  async launchSession() {
    const btn = document.getElementById('playBtn');
    btn.disabled = true;
    btn.textContent = 'Launching...';

    try {
      // Request a game session from the bridge
      const res = await fetch(`${API}/play/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: this.accountId,
          username: this.username,
        }),
      });

      if (!res.ok) throw new Error((await res.json()).error || 'Session failed');
      const session = await res.json();

      // Switch to game view
      this.showView('game');
      document.getElementById('gameCharName').textContent = this.username;
      document.getElementById('gameStatus').textContent = 'Connecting...';
      document.getElementById('gameLoading').classList.remove('hidden');

      // Connect Guacamole client
      this.connectGuacamole(session.wsUrl);

    } catch (e) {
      console.error('Session error:', e);
      alert(e.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span class="btn-icon">▶</span> Launch Game Session';
    }
  },

  connectGuacamole(wsUrl) {
    const canvasEl = document.getElementById('gameCanvas');
    const loadingEl = document.getElementById('gameLoading');
    const statusEl = document.getElementById('gameStatus');

    // Clean up previous client
    if (this.guacClient) {
      this.guacClient.disconnect();
      this.guacClient = null;
      // Remove old display
      const oldCanvas = canvasEl.querySelector('div:not(.game-loading)');
      if (oldCanvas) oldCanvas.remove();
    }

    // Create WebSocket tunnel
    const tunnel = new Guacamole.WebSocketTunnel(wsUrl);
    const client = new Guacamole.Client(tunnel);
    this.guacClient = client;

    // Add display element
    const display = client.getDisplay().getElement();
    canvasEl.appendChild(display);

    // Connect
    client.connect();

    // State handlers
    client.onstatechange = (state) => {
      const states = { 0: 'Idle', 1: 'Connecting...', 2: 'Waiting...', 3: 'Connected', 4: 'Disconnecting...', 5: 'Disconnected' };
      statusEl.textContent = states[state] || 'Unknown';

      if (state === 3) {
        // Connected — hide loading
        loadingEl.classList.add('hidden');
      } else if (state === 5) {
        // Disconnected
        loadingEl.classList.remove('hidden');
        loadingEl.querySelector('p').textContent = 'Disconnected';
      }
    };

    client.onerror = (error) => {
      console.error('Guacamole error:', error);
      statusEl.textContent = 'Error';
      loadingEl.classList.remove('hidden');
      loadingEl.querySelector('p').textContent = error.message || 'Connection error';
    };

    // Forward keyboard events
    const keyboard = new Guacamole.Keyboard(document);
    keyboard.onkeydown = (keysym) => client.sendKeyEvent(1, keysym);
    keyboard.onkeyup = (keysym) => client.sendKeyEvent(0, keysym);

    // Forward mouse events
    const mouse = new Guacamole.Mouse(display);
    mouse.onmousedown = mouse.onmouseup = mouse.onmousemove = (mouseState) => {
      client.sendMouseState(mouseState);
    };

    // Touch support
    const touch = new Guacamole.Mouse.Touchpad(display);
    touch.onmousedown = touch.onmouseup = touch.onmousemove = (mouseState) => {
      client.sendMouseState(mouseState);
    };
  },

  toggleFullscreen() {
    const canvas = document.getElementById('gameCanvas');
    if (!document.fullscreenElement) {
      canvas.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  },

  async disconnectGame() {
    if (this.guacClient) {
      this.guacClient.disconnect();
      this.guacClient = null;
    }

    // Tell bridge to clean up
    await fetch(`${API}/play/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: this.accountId }),
    }).catch(() => {});

    this.showView('queue');
  },

  // ── Records ───────────────────────────────────
  async loadRecords() {
    const container = document.getElementById('recordsContent');
    const empty = document.getElementById('noRecords');

    try {
      const res = await fetch(`${API}/record/${this.accountId}`);
      const records = await res.json();

      if (!records.length) {
        container.innerHTML = '';
        empty.classList.remove('hidden');
        return;
      }

      empty.classList.add('hidden');
      container.innerHTML = records.map(r => `
        <div class="record-card fantasy-panel">
          <div class="record-mode">${this.escapeHtml(r.match_mode)}</div>
          <div class="record-wl">
            <div class="wins">
              ${r.wins || 0}
              <span class="record-label">Wins</span>
            </div>
            <div class="losses">
              ${r.losses || 0}
              <span class="record-label">Losses</span>
            </div>
          </div>
          <div class="record-stats">
            ${r.total_games} games · ${r.total_kills || 0} kills · ${(r.total_damage || 0).toLocaleString()} damage
          </div>
        </div>
      `).join('');

    } catch (e) {
      container.innerHTML = '<p class="empty-state">Failed to load records</p>';
    }
  },

  // ── Helpers ───────────────────────────────────
  showError(el, msg) {
    el.textContent = msg;
    el.classList.remove('hidden');
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
};

// Boot
document.addEventListener('DOMContentLoaded', () => App.init());

// Expose for inline onclick handlers
window.App = App;
