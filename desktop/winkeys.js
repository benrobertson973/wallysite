/*
 * Windows: while iMovie is in front, the Windows key works like ⌘ on a Mac — Win+B splits a clip, Win+Z undoes,
 * Win+C / Win+V copy and paste, and so on.
 *
 * Windows handles Win+<key> itself before any app sees it, so the only way in is a low-level keyboard hook. It is
 * installed only while the iMovie window is focused; it swallows Win+<key> and hands the page Ctrl+<key>, which is
 * the app's ⌘ on Windows. The Windows key on its own still opens Start. Win+L (lock), Win+D, Win+Tab, Win+arrows,
 * Win+. / Win+; (emoji) and Win+Shift+S (screenshot) are left to Windows.
 */
'use strict';
const koffi = require('koffi');

const WH_KEYBOARD_LL = 13;
const WM_KEYDOWN = 0x100, WM_KEYUP = 0x101, WM_SYSKEYDOWN = 0x104, WM_SYSKEYUP = 0x105;
const LLKHF_INJECTED = 0x10;
const VK_LWIN = 0x5b, VK_RWIN = 0x5c;
const SHIFT = new Set([0x10, 0xa0, 0xa1]), ALT = new Set([0x12, 0xa4, 0xa5]);
const VK_MASK = 0xe8;          // an unassigned key: tapping it keeps Start from opening when the Windows key is released
const KEYEVENTF_KEYUP = 0x2;

const PUNCT = { 0xbb: '=', 0xbd: '-', 0xbc: ',', 0xbf: '/', 0xdc: '\\', 0xdb: '[', 0xdd: ']', 0xde: "'", 0xc0: '`', 0x08: 'Backspace', 0x2e: 'Delete' };
/** Accelerator key name for a virtual-key code the app may use with ⌘, or null to leave the key to Windows. */
function keyName(vk, shift) {
  if (vk >= 0x41 && vk <= 0x5a) {
    const ch = String.fromCharCode(vk);
    if (ch === 'L' || ch === 'D' || (ch === 'S' && shift)) return null;
    return ch;
  }
  if (vk >= 0x30 && vk <= 0x39) return String.fromCharCode(vk);
  return PUNCT[vk] || null;
}

function attach(win) {
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const KBDLLHOOKSTRUCT = koffi.struct('KBDLLHOOKSTRUCT', {
    vkCode: 'uint32_t', scanCode: 'uint32_t', flags: 'uint32_t', time: 'uint32_t', dwExtraInfo: 'uintptr_t',
  });
  koffi.proto('intptr_t __stdcall LowLevelKeyboardProc(int nCode, uintptr_t wParam, void *lParam)');
  const SetWindowsHookExW = user32.func('void * __stdcall SetWindowsHookExW(int idHook, LowLevelKeyboardProc *lpfn, void *hmod, uint32_t dwThreadId)');
  const CallNextHookEx = user32.func('intptr_t __stdcall CallNextHookEx(void *hhk, int nCode, uintptr_t wParam, void *lParam)');
  const UnhookWindowsHookEx = user32.func('bool __stdcall UnhookWindowsHookEx(void *hhk)');
  const GetForegroundWindow = user32.func('intptr_t __stdcall GetForegroundWindow()');
  const keybd_event = user32.func('void __stdcall keybd_event(uint8_t bVk, uint8_t bScan, uint32_t dwFlags, uintptr_t dwExtraInfo)');
  const GetModuleHandleW = kernel32.func('void * __stdcall GetModuleHandleW(const char16_t *name)');

  const hwndBuf = win.getNativeWindowHandle();
  const hwnd = hwndBuf.length >= 8 ? Number(hwndBuf.readBigUInt64LE(0)) : hwndBuf.readUInt32LE(0);
  const winDown = new Set(); // Windows keys held
  let shift = false, alt = false;
  let masked = false;         // the mask key was sent during this press of the Windows key
  const swallowed = new Set(); // keys whose key-up must be swallowed too

  const proc = (nCode, wParam, lParam) => {
    try {
      if (nCode === 0) {
        const k = koffi.decode(lParam, KBDLLHOOKSTRUCT);
        const msg = Number(wParam);
        const down = msg === WM_KEYDOWN || msg === WM_SYSKEYDOWN;
        const up = msg === WM_KEYUP || msg === WM_SYSKEYUP;
        const vk = k.vkCode;
        if (!(k.flags & LLKHF_INJECTED)) {
          if (vk === VK_LWIN || vk === VK_RWIN) {
            if (down) winDown.add(vk);
            else if (up) { winDown.delete(vk); if (!winDown.size) masked = false; }
          } else if (SHIFT.has(vk)) shift = down;
          else if (ALT.has(vk)) alt = down;
          else if (up && swallowed.has(vk)) {
            swallowed.delete(vk);
            return 1;
          } else if (down && winDown.size && Number(GetForegroundWindow()) === hwnd) {
            const name = keyName(vk, shift);
            if (name) {
              if (!masked) { keybd_event(VK_MASK, 0, 0, 0); keybd_event(VK_MASK, 0, KEYEVENTF_KEYUP, 0); masked = true; }
              swallowed.add(vk);
              const modifiers = ['control'];
              if (shift) modifiers.push('shift');
              if (alt) modifiers.push('alt');
              const wc = win.webContents;
              wc.sendInputEvent({ type: 'keyDown', keyCode: name, modifiers });
              wc.sendInputEvent({ type: 'keyUp', keyCode: name, modifiers });
              return 1;
            }
          }
        }
      }
    } catch (err) { /* never let a hook error block the keyboard */ }
    return CallNextHookEx(null, nCode, wParam, lParam);
  };
  const cb = koffi.register(proc, 'LowLevelKeyboardProc *');

  let hook = null;
  const install = () => {
    if (hook) return;
    hook = SetWindowsHookExW(WH_KEYBOARD_LL, cb, GetModuleHandleW(null), 0);
    winDown.clear(); swallowed.clear(); shift = alt = masked = false;
  };
  const remove = () => {
    if (!hook) return;
    UnhookWindowsHookEx(hook);
    hook = null;
  };
  win.on('focus', install);
  win.on('blur', remove);
  win.on('closed', () => { remove(); koffi.unregister(cb); });
  if (win.isFocused()) install();
}

module.exports = { attach, keyName };
