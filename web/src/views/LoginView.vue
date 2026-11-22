<template>
  <div class="login-page">
    <div class="access-grid" aria-hidden="true"></div>
    <div class="signal signal-a" aria-hidden="true"></div>
    <div class="signal signal-b" aria-hidden="true"></div>

    <section class="identity-panel" aria-label="智慧衣夾系統資訊">
      <div class="brand-lockup">
        <span class="brand-mark">H</span>
        <span>智慧衣夾</span>
      </div>
      <div class="identity-copy">
        <p class="eyebrow">NTNU IoT · SECURE ACCESS</p>
        <h1>讓每一次晾衣<br>都有數據可循。</h1>
        <p>設備狀態、即時感測、晾衣紀錄與戶外天氣，集中在一個受保護的控制介面。</p>
      </div>
      <div class="security-strip">
        <span><i></i>HTTPS 加密連線</span>
        <span><i></i>8 小時安全工作階段</span>
        <span><i></i>密碼不儲存在瀏覽器</span>
      </div>
      <div class="cloth-line" aria-hidden="true">
        <span class="clip clip-a"></span><span class="cloth"></span><span class="clip clip-b"></span>
      </div>
    </section>

    <main class="login-main">
      <form class="login-form" @submit.prevent="submit">
        <header>
          <p class="step">ACCESS / 01</p>
          <h2>登入控制台</h2>
          <p>使用原本的管理員帳號與密碼。</p>
        </header>

        <label class="field">
          <span>帳號</span>
          <input v-model.trim="username" name="username" autocomplete="username" autocapitalize="none"
            spellcheck="false" maxlength="128" required :disabled="submitting" @input="error = ''">
        </label>

        <label class="field">
          <span>密碼</span>
          <div class="password-input">
            <input v-model="password" name="password" :type="showPassword ? 'text' : 'password'"
              autocomplete="current-password" maxlength="1024" required :disabled="submitting"
              @input="error = ''" @keydown="detectCapsLock" @keyup="detectCapsLock">
            <button type="button" :aria-label="showPassword ? '隱藏密碼' : '顯示密碼'" @click="showPassword = !showPassword">
              {{ showPassword ? '隱藏' : '顯示' }}
            </button>
          </div>
        </label>

        <p v-if="capsLock" class="caps-note">Caps Lock 已開啟</p>
        <p v-if="error" class="login-error" role="alert">{{ error }}</p>

        <button class="submit-btn" type="submit" :disabled="submitting">
          <span>{{ submitting ? '驗證中' : '安全登入' }}</span><i aria-hidden="true">→</i>
        </button>

        <footer>
          <span class="lock-icon" aria-hidden="true"></span>
          Session cookie 僅由伺服器存取，登出後立即失效。
        </footer>
      </form>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRoute } from 'vue-router';
import { login } from '../composables/useAuth';

const route = useRoute();
const username = ref('');
const password = ref('');
const error = ref('');
const submitting = ref(false);
const showPassword = ref(false);
const capsLock = ref(false);

function detectCapsLock(event: KeyboardEvent) {
  capsLock.value = event.getModifierState('CapsLock');
}

async function submit() {
  if (submitting.value) return;
  submitting.value = true;
  error.value = '';
  const result = await login(username.value, password.value);
  submitting.value = false;
  if (!result.ok) {
    error.value = result.error;
    password.value = '';
    return;
  }
  const requested = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
  const destination = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';
  location.assign(destination);
}
</script>

<style scoped>
.login-page { position: relative; min-height: 100svh; display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(420px, 0.85fr); overflow: hidden; background: var(--bg); color: var(--tx); }
.access-grid { position: absolute; inset: 0; pointer-events: none; background-image: linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px); background-size: 52px 52px; opacity: 0.45; mask-image: linear-gradient(90deg, black, transparent 72%); }
.identity-panel { position: relative; min-height: 100svh; display: flex; flex-direction: column; justify-content: space-between; padding: clamp(32px, 5vw, 76px); border-right: 1px solid var(--bd); background: color-mix(in srgb, var(--sf) 82%, transparent); }
.brand-lockup { display: flex; align-items: center; gap: 13px; font-size: 1.15rem; font-weight: 900; letter-spacing: 0.03em; }
.brand-mark { width: 34px; height: 34px; display: grid; place-items: center; border: 2px solid var(--ac); color: var(--ac); font: 700 1rem var(--font-mono); }
.identity-copy { position: relative; z-index: 2; max-width: 720px; margin: auto 0; }
.eyebrow, .step { margin: 0 0 18px; color: var(--ac); font: 700 0.73rem var(--font-mono); letter-spacing: 0.16em; }
.identity-copy h1 { max-width: 760px; margin: 0; font-size: clamp(3.2rem, 6.6vw, 7.5rem); line-height: 0.95; letter-spacing: -0.07em; }
.identity-copy > p:last-child { max-width: 560px; margin: 34px 0 0; color: var(--tx2); font-size: 1.05rem; line-height: 1.85; }
.security-strip { display: flex; flex-wrap: wrap; gap: 12px 28px; color: var(--mu); font-size: 0.78rem; }
.security-strip span { display: flex; align-items: center; gap: 8px; }
.security-strip i { width: 6px; height: 6px; border-radius: 50%; background: var(--ok-tx); box-shadow: 0 0 12px var(--ok-tx); }
.cloth-line { position: absolute; right: 4%; bottom: 22%; width: 38%; height: 180px; border-top: 1px solid var(--ac-bd); transform: rotate(-7deg); opacity: 0.7; }
.cloth { position: absolute; width: 108px; height: 132px; left: 50%; top: -1px; border: 1px solid var(--ac-bd); background: var(--ac-soft); clip-path: polygon(15% 0, 85% 0, 100% 100%, 0 100%); transform: translateX(-50%); animation: cloth-sway 5s ease-in-out infinite; transform-origin: 50% 0; }
.clip { position: absolute; top: -9px; width: 6px; height: 18px; background: var(--wa); z-index: 2; }
.clip-a { left: calc(50% - 43px); }.clip-b { left: calc(50% + 37px); }
.signal { position: absolute; border: 1px solid var(--ac-bd); border-radius: 50%; pointer-events: none; }
.signal-a { width: 280px; height: 280px; left: 7%; top: 10%; animation: signal-pulse 4s ease-out infinite; }
.signal-b { width: 140px; height: 140px; left: 12%; top: 15%; animation: signal-pulse 4s 1.2s ease-out infinite; }
.login-main { position: relative; z-index: 3; min-height: 100svh; display: grid; place-items: center; padding: clamp(28px, 5vw, 72px); background: var(--sf); }
.login-form { width: min(100%, 460px); }
.login-form header { margin-bottom: 48px; }
.login-form h2 { margin: 0; font-size: clamp(2.2rem, 4vw, 3.7rem); letter-spacing: -0.055em; }
.login-form header > p:last-child { margin: 13px 0 0; color: var(--mu); }
.field { display: block; margin-top: 26px; }
.field > span { display: block; margin-bottom: 9px; color: var(--tx2); font-size: 0.82rem; font-weight: 700; }
.field input { width: 100%; height: 56px; border: 1px solid var(--bd2); border-radius: 0; outline: none; background: var(--code); color: var(--tx); padding: 0 16px; font: 500 1rem var(--font-mono); transition: border-color 160ms, box-shadow 160ms; }
.field input:focus { border-color: var(--ac); box-shadow: 0 0 0 3px var(--ac-soft); }
.field input:disabled { opacity: 0.65; }
.password-input { position: relative; }
.password-input input { padding-right: 72px; }
.password-input button { position: absolute; right: 8px; top: 8px; height: 40px; border: 0; background: transparent; color: var(--ac-tx); padding: 0 10px; cursor: pointer; font: 700 0.75rem var(--font-sans); }
.caps-note { margin: 10px 0 0; color: var(--wa-tx); font-size: 0.8rem; }
.login-error { margin: 18px 0 0; border-left: 3px solid var(--err-tx); background: var(--err-soft); color: var(--err-tx); padding: 12px 14px; font-size: 0.86rem; }
.submit-btn { width: 100%; height: 58px; display: flex; align-items: center; justify-content: space-between; margin-top: 30px; border: 1px solid var(--inv); background: var(--inv); color: var(--inv-tx); padding: 0 20px; cursor: pointer; font: 800 0.95rem var(--font-sans); transition: transform 160ms, background 160ms; }
.submit-btn:hover:not(:disabled) { transform: translateY(-2px); background: var(--ac); border-color: var(--ac); color: #081012; }
.submit-btn:disabled { cursor: wait; opacity: 0.6; }
.submit-btn i { font: normal 1.4rem var(--font-mono); }
.login-form footer { display: flex; align-items: center; gap: 10px; margin-top: 24px; color: var(--mu); font-size: 0.74rem; line-height: 1.5; }
.lock-icon { position: relative; width: 13px; height: 11px; flex: 0 0 auto; border: 1px solid var(--mu); }
.lock-icon::before { content: ''; position: absolute; width: 7px; height: 6px; left: 2px; top: -7px; border: 1px solid var(--mu); border-bottom: 0; border-radius: 5px 5px 0 0; }
@keyframes cloth-sway { 50% { transform: translateX(-50%) rotate(3deg); } }
@keyframes signal-pulse { 0% { transform: scale(0.7); opacity: 0; } 30% { opacity: 0.5; } 100% { transform: scale(1.25); opacity: 0; } }
@media (max-width: 850px) {
  .login-page { grid-template-columns: 1fr; }
  .identity-panel { min-height: 270px; padding: 26px 24px 34px; border-right: 0; border-bottom: 1px solid var(--bd); }
  .identity-copy { margin: 48px 0 0; }
  .identity-copy h1 { font-size: clamp(2.5rem, 13vw, 4.4rem); }
  .identity-copy > p:last-child, .security-strip, .cloth-line, .signal { display: none; }
  .login-main { min-height: auto; padding: 46px 24px 70px; place-items: start center; }
  .login-form header { margin-bottom: 34px; }
}
@media (prefers-reduced-motion: reduce) {
  .cloth, .signal { animation: none !important; }
  .signal { opacity: 0.16; }
}
</style>
