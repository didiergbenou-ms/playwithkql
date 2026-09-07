/**
 * Developer shortcuts.
 *
 * The point is to skip straight to whatever is being tested instead of
 * replaying five terminals every time. It is gated behind a passphrase so a
 * player who wanders onto the public build cannot trip over it.
 *
 * Only the SHA-256 of the phrase ships. That keeps the plaintext out of the
 * bundle, so skimming the JS does not hand it over. Be honest about what this
 * is though: it is obscurity, not security. Anyone determined can reach into
 * the store from the console, and nothing here guards anything valuable - the
 * whole game is client-side and the only "secret" is which answers are right.
 */

const PHRASE_HASH = 'a36097e13a10bf8f010e79d80a84c5909da822b66d4953a6c695f751720b2aaf';

const SESSION_KEY = 'kqld.dev';
/** Longest phrase we will ever compare, so the keystroke buffer stays bounded. */
const BUFFER_MAX = 32;
/** Typing pause after which the buffer resets, so stray keys cannot accumulate. */
const IDLE_RESET_MS = 2500;

async function sha256Hex(input: string): Promise<string | null> {
  // crypto.subtle needs a secure context. https and localhost both qualify, so
  // this only fails on an odd setup - in which case dev mode simply stays off.
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const bytes = new TextEncoder().encode(input);
  const digest = await subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function isDevPhrase(candidate: string): Promise<boolean> {
  const hex = await sha256Hex(candidate);
  return hex === PHRASE_HASH;
}

let active = false;
const listeners = new Set<(on: boolean) => void>();

export function devActive(): boolean {
  return active;
}

export function onDevChange(fn: (on: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setActive(on: boolean) {
  if (active === on) return;
  active = on;
  try {
    if (on) sessionStorage.setItem(SESSION_KEY, '1');
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // private mode - dev mode just will not survive a reload
  }
  for (const fn of [...listeners]) fn(on);
}

export function disableDev(): void {
  setActive(false);
}

/**
 * Two ways in: append `?dev=<phrase>` to the URL (survives reloads, which is
 * the point when you are iterating), or type the phrase anywhere in the game.
 * Returns a teardown function.
 */
export function initDevMode(): () => void {
  try {
    if (sessionStorage.getItem(SESSION_KEY) === '1') active = true;
  } catch {
    /* ignore */
  }

  const params = new URLSearchParams(location.search);
  const fromUrl = params.get('dev');
  if (fromUrl) {
    void isDevPhrase(fromUrl).then((ok) => {
      if (ok) setActive(true);
    });
  }

  let buffer = '';
  let lastKeyAt = 0;

  const onKey = (e: KeyboardEvent) => {
    // Never sniff what is being typed into the query editor or any other field.
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length !== 1) return;

    const now = Date.now();
    if (now - lastKeyAt > IDLE_RESET_MS) buffer = '';
    lastKeyAt = now;

    buffer = (buffer + e.key.toLowerCase()).slice(-BUFFER_MAX);
    void isDevPhrase(buffer).then((ok) => {
      if (ok) {
        buffer = '';
        setActive(true);
      }
    });
  };

  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
