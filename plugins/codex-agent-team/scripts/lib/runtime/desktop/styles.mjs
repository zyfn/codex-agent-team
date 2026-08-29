export const TEAM_UI_STYLES = String.raw`
  .cat-avatar {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    border-radius: 50%;
    object-fit: cover;
    background: color-mix(in srgb, currentColor 14%, transparent);
    font-size: 11px;
    font-weight: 700;
  }

  .cat-native-member-avatar {
    display: grid;
    width: 16px;
    height: 16px;
    place-items: center;
    overflow: hidden;
    flex: 0 0 auto;
    border-radius: 50%;
    background: color-mix(in srgb, currentColor 14%, transparent);
    color: var(--text-primary, #eee);
    font-size: 9px;
    font-weight: 700;
    line-height: 1;
  }

  .cat-native-member-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  #codex-agent-team-panel {
    --cat-blue: #0a84ff;
    --cat-green: #30d158;
    --cat-amber: #ff9f0a;
    --cat-red: #ff453a;
    --cat-muted: color-mix(in srgb, var(--text-primary, #f5f5f7) 54%, transparent);
    --cat-line: color-mix(in srgb, var(--text-primary, #f5f5f7) 11%, transparent);
    position: fixed;
    z-index: 70;
    isolation: isolate;
    box-sizing: border-box;
    overflow: auto;
    color: var(--text-primary, #f5f5f7);
    background:
      radial-gradient(ellipse 65% 50% at 0% 0%, #3a72ad1d, transparent 72%),
      radial-gradient(ellipse 55% 45% at 100% 0%, #7a678f16, transparent 70%),
      color-mix(in srgb, var(--background-primary, #0f1013) 90%, #11151c);
    font: 14px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif;
  }

  .cat-shell {
    max-width: 1080px;
    margin: 0 auto;
    padding: 34px 38px 72px;
  }

  .cat-glass {
    border: 1px solid color-mix(in srgb, currentColor 13%, transparent);
    background: linear-gradient(
      145deg,
      color-mix(in srgb, var(--background-primary, #151515) 84%, #fff 8%),
      color-mix(in srgb, var(--background-primary, #151515) 94%, transparent)
    );
    box-shadow: 0 24px 70px #00000035, inset 0 1px 0 #ffffff1f;
    backdrop-filter: blur(38px) saturate(150%);
    -webkit-backdrop-filter: blur(38px) saturate(150%);
  }

  .cat-panel-toolbar,
  .cat-actions,
  .cat-brand-meta,
  .cat-connection-state,
  .cat-team-inline-actions,
  .cat-member-row-actions,
  .cat-picker,
  .cat-dialog-actions {
    display: flex;
    align-items: center;
  }

  .cat-panel-toolbar {
    justify-content: space-between;
    gap: 22px;
    margin: 0 0 22px;
  }

  .cat-brand h1 {
    margin: 0;
    color: var(--text-primary, #f5f5f7);
    font-size: 28px;
    font-weight: 690;
    line-height: 1.1;
    letter-spacing: -.035em;
  }

  .cat-brand-meta {
    gap: 8px;
    margin-top: 7px;
    color: var(--cat-muted);
    font-size: 12px;
  }

  .cat-brand-meta-separator { opacity: .45; }
  .cat-connection-state { gap: 6px; }

  .cat-connection-state::before {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--cat-green);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--cat-green) 13%, transparent);
    content: "";
  }

  .cat-connection-state.disconnected::before {
    background: var(--cat-red);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--cat-red) 13%, transparent);
  }

  .cat-actions { gap: 7px; }

  .cat-button,
  .cat-team-expand-all,
  .cat-text-action,
  .cat-picker-button,
  .cat-avatar-source-option,
  .cat-work-source-option,
  .cat-avatar-preset,
  .cat-error-dismiss {
    font: inherit;
    cursor: pointer;
  }

  .cat-button {
    min-height: 34px;
    border: 0;
    border-radius: 10px;
    padding: 7px 12px;
    background: color-mix(in srgb, currentColor 8%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 5%, transparent);
    color: inherit;
    font-size: 12px;
    font-weight: 570;
    transition: background .12s ease, transform .08s ease;
  }

  .cat-button:hover { background: color-mix(in srgb, currentColor 13%, transparent); }
  .cat-button:active { transform: scale(.97); }
  .cat-button.primary { background: var(--cat-blue); box-shadow: 0 5px 18px #0a84ff38; color: #fff; }
  .cat-button.primary:hover { background: #2794ff; }
  .cat-button.tertiary { background: transparent; box-shadow: none; color: var(--cat-muted); }
  .cat-button.danger { color: #ff9b9b; }

  .cat-button:focus-visible,
  .cat-team-directory-row:focus-visible,
  .cat-team-expand-all:focus-visible,
  .cat-text-action:focus-visible,
  .cat-terminal-menu-summary:focus-visible,
  .cat-terminal-menu-option:focus-visible,
  .cat-member-open:focus-visible,
  .cat-picker-button:focus-visible,
  .cat-avatar-source-option:focus-visible,
  .cat-work-source-option:focus-visible,
  .cat-avatar-preset:focus-visible {
    outline: 3px solid color-mix(in srgb, var(--cat-blue) 40%, transparent);
    outline-offset: 2px;
  }

  .cat-error,
  .cat-notice {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
    border-radius: 12px;
    padding: 11px 13px;
    font-size: 12px;
  }

  .cat-error {
    border: 1px solid color-mix(in srgb, var(--cat-red) 28%, transparent);
    background: color-mix(in srgb, var(--cat-red) 10%, transparent);
    color: #ff9fa5;
  }

  .cat-error-message { min-width: 0; overflow-wrap: anywhere; }
  .cat-error-dismiss { flex: 0 0 auto; border: 0; border-radius: 7px; padding: 2px 6px; background: transparent; color: inherit; font-weight: 650; }
  .cat-error-dismiss:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
  .cat-notice { border: 1px solid color-mix(in srgb, var(--cat-green) 25%, transparent); background: color-mix(in srgb, var(--cat-green) 9%, transparent); color: #9fe5b1; }

  .cat-team-directory { overflow: clip; border-radius: 18px; }
  .cat-team-directory-group { border-bottom: 1px solid var(--cat-line); }
  .cat-team-directory-group:last-child { border-bottom: 0; }

  .cat-team-expand-all {
    border: 0;
    border-radius: 8px;
    padding: 7px 8px;
    background: transparent;
    color: var(--cat-muted);
    font-size: 12px;
    font-weight: 570;
  }

  .cat-team-expand-all:hover { color: var(--text-primary, #f5f5f7); }

  .cat-team-directory-row {
    display: grid;
    grid-template-columns: minmax(180px, .7fr) auto minmax(0, 1fr) auto 20px;
    align-items: center;
    gap: 18px;
    width: 100%;
    border: 0;
    border-radius: 0;
    padding: 16px 20px;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
    transition: background .16s ease;
  }

  .cat-team-directory-row:hover { background: color-mix(in srgb, currentColor 4.5%, transparent); }
  .cat-team-directory-row[aria-expanded="true"] { background: color-mix(in srgb, currentColor 3.2%, transparent); }
  .cat-team-directory-name { min-width: 0; overflow: hidden; font-size: 14px; font-weight: 620; letter-spacing: -.012em; text-overflow: ellipsis; white-space: nowrap; }

  .cat-member-carousel {
    display: flex;
    min-width: 0;
    gap: 7px;
    overflow-x: auto;
    overscroll-behavior-inline: contain;
    padding: 3px 1px;
    scroll-snap-type: inline proximity;
    scrollbar-width: none;
  }

  .cat-member-carousel::-webkit-scrollbar { display: none; }

  .cat-member-avatar-ring {
    display: grid;
    width: 38px;
    height: 38px;
    place-items: center;
    flex: 0 0 auto;
    border-radius: 50%;
    padding: 2px;
    box-sizing: border-box;
    background: #7d8795;
    box-shadow: 0 0 0 1px color-mix(in srgb, currentColor 10%, transparent);
    scroll-snap-align: start;
  }

  .cat-member-avatar-ring .cat-avatar { width: 100% !important; height: 100% !important; border: 2px solid color-mix(in srgb, var(--background-primary, #111) 88%, transparent); box-sizing: border-box; }
  .cat-member-avatar-ring.error { background: var(--cat-red); box-shadow: 0 0 0 1px #ffffff24, 0 0 14px color-mix(in srgb, var(--cat-red) 24%, transparent); }
  .cat-member-avatar-ring.waiting { background: var(--cat-amber); box-shadow: 0 0 0 1px #ffffff24, 0 0 14px color-mix(in srgb, var(--cat-amber) 24%, transparent); animation: catWaitingPulse 1.9s ease-in-out infinite; }
  .cat-member-avatar-ring.running { background: conic-gradient(from 20deg, var(--cat-blue) 0 30%, #284f73 30% 48%, #62adff 48% 76%, #284f73 76%); box-shadow: 0 0 0 1px #ffffff1b, 0 0 14px #0a84ff2b; animation: catRunningRing 2.4s linear infinite; }
  .cat-member-avatar-ring.running .cat-avatar { animation: catCounterRotate 2.4s linear infinite; }

  .cat-team-state { min-width: 92px; color: #8b95a4; font-size: 12px; font-weight: 560; text-align: right; white-space: nowrap; }
  .cat-team-state.error { color: var(--cat-red); }
  .cat-team-state.waiting { color: var(--cat-amber); }
  .cat-team-state.running { color: var(--cat-blue); }
  .cat-team-chevron { display: grid; width: 20px; height: 20px; place-items: center; color: var(--cat-muted); }
  .cat-team-chevron-icon { width: 15px; height: 15px; transition: transform .18s ease; }
  .cat-team-directory-row[aria-expanded="true"] .cat-team-chevron-icon { transform: rotate(180deg); }

  .cat-team-directory-members { margin: 0; padding: 0 20px 8px; background: color-mix(in srgb, #000 8%, transparent); }
  .cat-team-directory-members[hidden] { display: none; }
  .cat-team-inline-actions { display: flex; align-items: center; justify-content: flex-end; gap: 2px; padding: 8px 0 3px; }

  .cat-terminal-menu { position: relative; z-index: 4; }
  .cat-terminal-menu[open] { z-index: 8; }

  .cat-terminal-menu-summary {
    display: inline-flex;
    min-height: 28px;
    align-items: center;
    gap: 3px;
    border-radius: 8px;
    padding: 4px 7px 4px 9px;
    color: var(--cat-muted);
    font-size: 11px;
    font-weight: 560;
    list-style: none;
    cursor: pointer;
    user-select: none;
  }

  .cat-terminal-menu-summary::-webkit-details-marker { display: none; }
  .cat-terminal-menu-summary:hover,
  .cat-terminal-menu[open] .cat-terminal-menu-summary { background: color-mix(in srgb, currentColor 7%, transparent); color: var(--text-primary, #f5f5f7); }
  .cat-terminal-menu-summary[aria-disabled="true"] { cursor: default; opacity: .32; }
  .cat-terminal-menu-chevron { display: grid; width: 15px; height: 15px; place-items: center; }
  .cat-terminal-menu-chevron-icon { width: 12px; height: 12px; transition: transform .16s ease; }
  .cat-terminal-menu[open] .cat-terminal-menu-chevron-icon { transform: rotate(180deg); }

  .cat-terminal-menu-popover {
    position: absolute;
    top: calc(100% + 7px);
    left: 0;
    z-index: 12;
    display: grid;
    min-width: 164px;
    gap: 2px;
    border: 1px solid color-mix(in srgb, #fff 13%, transparent);
    border-radius: 13px;
    padding: 5px;
    background: color-mix(in srgb, var(--background-primary, #17181c) 88%, transparent);
    box-shadow: 0 16px 42px #0007, inset 0 1px #ffffff12;
    backdrop-filter: blur(28px) saturate(155%);
    -webkit-backdrop-filter: blur(28px) saturate(155%);
  }

  .cat-terminal-menu-option {
    display: grid;
    grid-template-columns: 25px minmax(0, 1fr);
    align-items: center;
    gap: 9px;
    border: 0;
    border-radius: 9px;
    padding: 7px 9px;
    background: transparent;
    color: var(--text-primary, #f5f5f7);
    font: inherit;
    font-size: 11px;
    font-weight: 570;
    text-align: left;
    cursor: pointer;
  }

  .cat-terminal-menu-option:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
  .cat-terminal-menu-option:disabled { cursor: not-allowed; opacity: .3; filter: grayscale(1); }
  .cat-terminal-app-icon-slot,
  .cat-terminal-app-icon { width: 25px; height: 25px; }
  .cat-terminal-app-icon-slot { display: grid; place-items: center; flex: 0 0 25px; }
  .cat-terminal-app-icon { display: block; border-radius: 6px; object-fit: contain; }

  .cat-text-action {
    border: 0;
    border-radius: 7px;
    padding: 5px 7px;
    background: transparent;
    color: var(--cat-muted);
    font-size: 11px;
    font-weight: 540;
  }

  .cat-text-action:hover { color: var(--text-primary, #f5f5f7); background: color-mix(in srgb, currentColor 7%, transparent); }
  .cat-member-list { display: grid; margin: 0; }

  .cat-member-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    border-bottom: 1px solid var(--cat-line);
    border-radius: 0;
    padding: 4px;
  }

  .cat-member-row:last-child { border-bottom: 0; }
  .cat-member-row:hover { background: color-mix(in srgb, currentColor 3.5%, transparent); }
  .cat-member-open { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; min-width: 0; border: 0; border-radius: 8px; padding: 8px 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
  .cat-member-open:focus-visible { outline-offset: -2px; }
  .cat-member-copy { min-width: 0; }
  .cat-member-name { overflow: hidden; font-weight: 610; text-overflow: ellipsis; white-space: nowrap; }
  .cat-member-role { margin: 2px 0 0; overflow: hidden; color: var(--cat-muted); font-size: 11px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }

  .cat-runtime-text { display: inline-flex; align-items: center; gap: 7px; color: #8b95a4; font-size: 11px; font-weight: 550; white-space: nowrap; }
  .cat-runtime-text::before { width: 7px; height: 7px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 4px color-mix(in srgb, currentColor 10%, transparent); content: ""; }
  .cat-runtime-text.error { color: var(--cat-red); }
  .cat-runtime-text.running { color: var(--cat-blue); }
  .cat-runtime-text.running::before { animation: catPulse 1.6s ease-in-out infinite; }
  .cat-runtime-text.waiting { color: var(--cat-amber); }
  .cat-member-row-actions { gap: 2px; opacity: 0; }
  .cat-member-row:hover .cat-member-row-actions, .cat-member-row-actions:focus-within { opacity: 1; }
  .cat-team-empty { padding: 25px; color: var(--cat-muted); font-size: 12px; text-align: center; }
  .cat-empty { padding: 68px 24px; color: var(--cat-muted); text-align: center; }
  .cat-empty h3 { margin: 0; color: var(--text-primary, #f5f5f7); font-size: 17px; }
  .cat-empty p { margin: 7px auto 0; max-width: 460px; font-size: 12px; }

  #codex-agent-team-modal {
    --cat-blue: #0a84ff;
    --cat-muted: color-mix(in srgb, var(--text-primary, #f5f5f7) 54%, transparent);
    position: fixed;
    inset: 0;
    z-index: 90;
    display: grid;
    place-items: center;
    padding: 22px;
    background: #0009;
    color: var(--text-primary, #f5f5f7);
    font: 14px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }

  .cat-dialog { width: min(620px, 100%); max-height: calc(100vh - 44px); overflow: auto; border-radius: 24px; padding: 23px; }
  .cat-dialog h2 { margin: 0; font-size: 20px; letter-spacing: -.02em; }
  .cat-dialog-description { margin: 6px 0 18px; color: var(--cat-muted); font-size: 12px; line-height: 1.6; }
  .cat-field { display: grid; gap: 6px; margin: 12px 0; }
  .cat-field > label { color: var(--cat-muted); font-size: 11px; }

  .cat-field input,
  .cat-field textarea,
  .cat-field select {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid color-mix(in srgb, currentColor 11%, transparent);
    border-radius: 12px;
    padding: 10px 11px;
    background: color-mix(in srgb, currentColor 3%, transparent);
    color: inherit;
    outline: 0;
    font: inherit;
  }

  .cat-field input:focus,
  .cat-field textarea:focus,
  .cat-field select:focus { border-color: color-mix(in srgb, var(--cat-blue) 55%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--cat-blue) 10%, transparent); }
  .cat-field textarea { min-height: 82px; resize: vertical; }
  .cat-field select { min-height: 42px; }
  .cat-field select option { background: #1f2024; color: #f5f5f7; }
  #codex-agent-team-modal[data-color-scheme="light"] .cat-field select option { background: #fff; color: #1d1d1f; }
  .cat-form-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
  .cat-form-grid .cat-field { min-width: 0; }
  .cat-dialog-actions { justify-content: flex-end; gap: 8px; margin-top: 20px; }

  .cat-avatar-source-toggle { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; width: 220px; padding: 3px; border-radius: 10px; background: color-mix(in srgb, currentColor 7%, transparent); }
  .cat-avatar-source-option { border: 0; border-radius: 8px; padding: 7px 10px; background: transparent; color: var(--cat-muted); font-size: 11px; font-weight: 560; }
  .cat-avatar-source-option[aria-pressed="true"] { background: color-mix(in srgb, currentColor 12%, transparent); box-shadow: 0 1px 5px #0003; color: inherit; }
  .cat-avatar-source-option:disabled { cursor: default; opacity: .38; }
  .cat-avatar-source-panel { min-height: 54px; margin-top: 9px; }
  .cat-avatar-source-panel[hidden] { display: none; }
  .cat-avatar-presets { display: flex; flex-wrap: wrap; gap: 8px; }
  .cat-avatar-preset { display: grid; width: 48px; height: 48px; place-items: center; border: 2px solid transparent; border-radius: 50%; padding: 2px; background: transparent; }
  .cat-avatar-preset:hover { background: color-mix(in srgb, currentColor 7%, transparent); }
  .cat-avatar-preset[aria-pressed="true"] { border-color: var(--cat-blue); }
  .cat-avatar-preset img { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; }

  .cat-work-source-toggle {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 3px;
    padding: 3px;
    border-radius: 11px;
    background: color-mix(in srgb, currentColor 7%, transparent);
  }

  .cat-work-source-option {
    min-width: 0;
    border: 0;
    border-radius: 8px;
    padding: 8px 10px;
    background: transparent;
    color: var(--cat-muted);
    font-size: 11px;
    font-weight: 560;
  }

  .cat-work-source-option:hover { color: var(--text-primary, #f5f5f7); }
  .cat-work-source-option[aria-pressed="true"] {
    background: color-mix(in srgb, currentColor 12%, transparent);
    box-shadow: 0 1px 5px #0003, inset 0 1px #ffffff0c;
    color: var(--text-primary, #f5f5f7);
  }

  .cat-work-source-panel { display: grid; gap: 7px; min-height: 54px; align-content: center; }
  .cat-work-source-panel[hidden] { display: none; }
  .cat-work-source-hint { margin: 0; color: var(--cat-muted); font-size: 10px; line-height: 1.45; }
  .cat-work-source-hint.error { color: #ff9fa5; }

  .cat-workspace-preview {
    display: grid;
    gap: 3px;
    margin-top: 2px;
    border-radius: 11px;
    padding: 10px 11px;
    background: color-mix(in srgb, currentColor 4.5%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 7%, transparent);
  }

  .cat-workspace-preview-label { color: var(--cat-muted); font-size: 9px; font-weight: 570; letter-spacing: .025em; }
  .cat-workspace-preview-path { overflow: hidden; color: var(--text-primary, #f5f5f7); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }

  .cat-picker { gap: 10px; min-height: 42px; border: 1px solid color-mix(in srgb, currentColor 11%, transparent); border-radius: 12px; padding: 7px; background: color-mix(in srgb, currentColor 3%, transparent); }
  .cat-picker-button { flex: 0 0 auto; border: 0; border-radius: 8px; padding: 7px 10px; background: color-mix(in srgb, currentColor 9%, transparent); color: inherit; font-size: 11px; font-weight: 560; }
  .cat-picker-button:hover { background: color-mix(in srgb, currentColor 14%, transparent); }
  .cat-picker-button:disabled { cursor: progress; opacity: .65; }
  .cat-picker-value { min-width: 0; overflow: hidden; color: var(--cat-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  .cat-picker-preview { width: 30px; height: 30px; flex: 0 0 auto; border-radius: 50%; object-fit: cover; }
  .cat-hidden-input { position: absolute !important; width: 1px !important; height: 1px !important; overflow: hidden !important; clip: rect(0 0 0 0) !important; white-space: nowrap !important; }

  @keyframes catPulse { 50% { opacity: .45; transform: scale(.78); } }
  @keyframes catWaitingPulse { 50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--cat-amber) 16%, transparent); } }
  @keyframes catRunningRing { to { transform: rotate(360deg); } }
  @keyframes catCounterRotate { to { transform: rotate(-360deg); } }

  @media (max-width: 760px) {
    .cat-shell { padding: 24px 16px 52px; }
    .cat-panel-toolbar { align-items: flex-start; flex-direction: column; }
    .cat-actions { width: 100%; flex-wrap: wrap; }
    .cat-team-directory-row { grid-template-columns: minmax(112px, .7fr) auto minmax(0, 1fr) auto 18px; gap: 8px; padding: 13px 14px; }
    .cat-terminal-menu-summary { padding-inline: 7px; }
    .cat-terminal-menu-summary-label { display: none; }
    .cat-member-avatar-ring { width: 34px; height: 34px; }
    .cat-member-row { grid-template-columns: 1fr; }
    .cat-member-row-actions { justify-self: start; opacity: 1; }
    .cat-team-directory-members { padding-inline: 12px; }
    .cat-form-grid { grid-template-columns: 1fr; }
    .cat-work-source-toggle { grid-template-columns: 1fr; }
  }

  @media (prefers-reduced-motion: reduce) {
    .cat-member-avatar-ring.waiting,
    .cat-member-avatar-ring.running,
    .cat-member-avatar-ring.running .cat-avatar,
    .cat-runtime-text.running::before { animation: none; }
    .cat-team-chevron-icon,
    .cat-button { transition: none; }
  }

  @media (prefers-reduced-transparency: reduce) {
    #codex-agent-team-panel { background: var(--background-primary, #111); }
    .cat-glass { background: color-mix(in srgb, var(--background-primary, #111) 94%, #fff); backdrop-filter: none; -webkit-backdrop-filter: none; }
  }
`;
