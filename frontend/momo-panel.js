// Shared Momo widget markup, injected on every page so the floating voice
// agent is identical site-wide. Loaded BEFORE momo.js, which wires it up.
document.body.insertAdjacentHTML(
  "beforeend",
  `
  <!-- Momo: floating real-time voice agent -->
  <button id="momoFab" class="momo-fab" type="button" aria-label="Talk to Momo">
    <span class="momo-fab-icon" aria-hidden="true">🎙️</span>
    <span class="momo-fab-label">Talk to Momo</span>
  </button>

  <section id="momoPanel" class="momo-panel" hidden aria-label="Momo voice agent">
    <header class="momo-panel-head">
      <div class="momo-brand">
        <span class="momo-spark" aria-hidden="true">✦</span>
        <div>
          <strong>Momo</strong>
          <small>Your kitchen voice assistant</small>
        </div>
      </div>
      <div class="momo-window-actions">
        <button id="momoMinimize" type="button" class="momo-icon-button" aria-label="Minimize Momo">−</button>
        <button id="momoClose" type="button" class="momo-icon-button" aria-label="Close Momo">×</button>
      </div>
    </header>

    <div id="momoAuthGate" class="momo-gate">
      <div class="momo-hero-avatar" aria-hidden="true">
        <div class="momo-avatar momo-avatar-large"></div>
        <span class="momo-mic-badge">🎙</span>
      </div>
      <div class="momo-gate-copy">
        <h2>Welcome to Momo!</h2>
        <p>Sign in to get hands-free help with our recipes and more.</p>
      </div>
      <div class="momo-security-note">
        <span>We use Google Sign-In for a secure and personalized experience.</span>
      </div>
      <div id="googleSignIn" class="momo-google-button"></div>

      <div class="momo-auth-divider"><span>or use your email</span></div>

      <form id="momoEmailForm" class="momo-email-form" novalidate>
        <input id="momoNameInput" class="momo-auth-input" type="text"
               placeholder="Your name" autocomplete="name" hidden>
        <input id="momoEmailInput" class="momo-auth-input" type="email"
               placeholder="Email address" autocomplete="email" required>
        <input id="momoPasswordInput" class="momo-auth-input" type="password"
               placeholder="Password (min 8 characters)" autocomplete="current-password"
               minlength="8" required>
        <p id="momoAuthError" class="momo-auth-error" role="alert" hidden></p>
        <button id="momoEmailSubmit" type="submit" class="momo-auth-submit">Sign in</button>
      </form>

      <p class="momo-auth-toggle">
        <span id="momoToggleText">New to Momo?</span>
        <button id="momoAuthToggle" type="button" class="momo-link-button">Create an account</button>
      </p>

      <div class="momo-privacy">
        <span></span>
        <strong>Secure</strong>
        <span></span>
        <p>Your data is private and never shared.</p>
      </div>
    </div>

    <div id="momoLive" class="momo-live" hidden>
      <div class="momo-live-body">
        <aside id="momoHistory" class="momo-history" aria-label="Previous chats">
          <button id="momoNewChat" type="button" class="momo-icon-btn"
                  title="New chat" aria-label="New chat">+</button>
          <button id="momoHistoryToggle" type="button" class="momo-icon-btn"
                  title="Show previous chats" aria-label="Show previous chats">‹</button>
          <div id="momoHistoryPanel" class="momo-history-panel" hidden>
            <p class="momo-history-heading">Previous chats</p>
            <div id="momoHistoryList" class="momo-history-list"></div>
          </div>
        </aside>

        <div class="momo-main">
          <div class="momo-ready-bar">
            <div>
              <p id="momoStatus" class="momo-status">Ready to help</p>
              <span>Ask me anything about our recipes.</span>
            </div>
            <div class="momo-avatar momo-avatar-small" aria-hidden="true"></div>
          </div>
          <div id="momoTranscript" class="momo-transcript" aria-live="polite"></div>
          <div class="momo-suggestions" aria-label="Suggested prompts">
            <button type="button">Repeat ingredients</button>
            <button type="button">What’s next?</button>
            <button type="button">Start over</button>
          </div>
          <form class="momo-composer">
            <label for="momoPromptInput" class="sr-only">Ask Momo</label>
            <input id="momoPromptInput" type="text" placeholder="Ask Momo..." readonly>
            <button id="momoMic" type="button" class="momo-mic-button" aria-label="Start talking">🎙</button>
          </form>
          <div class="momo-controls">
            <button id="momoStop" type="button" disabled>Stop</button>
          </div>
        </div>
      </div>
      <footer class="momo-account-bar">
        <button id="momoSignOut" type="button" class="momo-signout">Sign out</button>
        <span id="momoAccountLabel">Signed in</span>
      </footer>
    </div>
  </section>
  `
);
