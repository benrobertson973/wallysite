/* SF-Symbols-like icon set (hand drawn SVG, 24x24 grid) */
(function (IM) {
  'use strict';
  const S = 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
  const F = 'fill="currentColor"';
  const icons = {
    'chevron-left': `<path ${S} d="M14.5 5.5 8 12l6.5 6.5"/>`,
    'chevron-right': `<path ${S} d="M9.5 5.5 16 12l-6.5 6.5"/>`,
    'chevron-down': `<path ${S} d="M6 9.5l6 6 6-6"/>`,
    'chevron-up': `<path ${S} d="M6 14.5l6-6 6 6"/>`,
    'disclosure': `<path ${F} d="M9 6.5v11l8-5.5z"/>`,
    'import': `<path ${S} d="M12 3.5v11.5M7.2 10.5 12 15.3l4.8-4.8M4.5 19.5h15"/>`,
    'share': `<path ${S} d="M12 3.2v11.3M8 7l4-4 4 4M8.5 10H6.3a1.3 1.3 0 0 0-1.3 1.3v8.2a1.3 1.3 0 0 0 1.3 1.3h11.4a1.3 1.3 0 0 0 1.3-1.3v-8.2A1.3 1.3 0 0 0 17.7 10h-2.2"/>`,
    'play': `<path ${F} d="M7 4.6v14.8c0 .8.9 1.3 1.6.9l11.8-7.4a1 1 0 0 0 0-1.8L8.6 3.7C7.9 3.3 7 3.8 7 4.6z"/>`,
    'pause': `<rect ${F} x="6" y="4.5" width="4" height="15" rx="1"/><rect ${F} x="14" y="4.5" width="4" height="15" rx="1"/>`,
    'back-end': `<rect ${F} x="4.5" y="5" width="2.4" height="14" rx="1"/><path ${F} d="M19.5 5.9v12.2c0 .8-.9 1.3-1.6.8L9.2 12.8a1 1 0 0 1 0-1.6l8.7-6.1c.7-.5 1.6 0 1.6.8z"/>`,
    'forward-end': `<rect ${F} x="17.1" y="5" width="2.4" height="14" rx="1"/><path ${F} d="M4.5 5.9v12.2c0 .8.9 1.3 1.6.8l8.7-6.1a1 1 0 0 0 0-1.6L6.1 5.1c-.7-.5-1.6 0-1.6.8z"/>`,
    'mic': `<rect ${F} x="9" y="2.8" width="6" height="11" rx="3"/><path ${S} d="M5.8 11.2a6.2 6.2 0 0 0 12.4 0M12 17.4v3.4M9 20.8h6"/>`,
    'fullscreen': `<path ${S} d="M14 4h6v6M20 4l-6.5 6.5M10 20H4v-6M4 20l6.5-6.5"/>`,
    'fullscreen-exit': `<path ${S} d="M20 10h-6V4M14 10l6.5-6.5M4 14h6v6M10 14l-6.5 6.5"/>`,
    'wand': `<path ${S} d="M4 20 14.5 9.5M13 8l3 3"/><path ${F} d="M17.5 2.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8zM20.2 9.5l.5 1.1 1.1.5-1.1.5-.5 1.1-.5-1.1-1.1-.5 1.1-.5zM10.5 2.8l.5 1.1 1.1.5-1.1.5-.5 1.1-.5-1.1-1.1-.5 1.1-.5z"/>`,
    'overlay': `<rect ${S} x="3" y="5" width="13" height="10" rx="1.5"/><rect x="8" y="9" width="13" height="10" rx="1.5" fill="currentColor" fill-opacity=".35" stroke="currentColor" stroke-width="1.7"/>`,
    'color-balance': `<circle ${S} cx="12" cy="12" r="8.2"/><path ${F} d="M12 3.8a8.2 8.2 0 0 0 0 16.4z"/>`,
    'color-correction': `<path ${S} d="M12 3.5c-4.8 0-8.5 3.6-8.5 8.1 0 4.6 3.9 8.4 8 8.4 1.4 0 2-.9 2-1.8 0-1.3-1-1.5-1-2.7 0-1 .8-1.7 1.8-1.7h2.3c2.2 0 3.9-1.6 3.9-3.8 0-3.7-3.8-6.5-8.5-6.5z"/><circle ${F} cx="7.8" cy="11.5" r="1.3"/><circle ${F} cx="10" cy="7.6" r="1.3"/><circle ${F} cx="14.4" cy="7.6" r="1.3"/><circle ${F} cx="17" cy="11" r="1.3"/>`,
    'crop': `<path ${S} d="M6.5 2.5v14a1 1 0 0 0 1 1h14M2.5 6.5h14a1 1 0 0 1 1 1v14"/>`,
    'stabilize': `<rect ${S} x="3" y="7.5" width="12.5" height="9" rx="2"/><path ${S} d="M15.5 10.8 20.5 8v8l-5-2.8"/><path ${S} d="M1.5 4.5c1.2-1 2.4-1 3.6 0s2.4 1 3.6 0M1.5 20c1.2-1 2.4-1 3.6 0s2.4 1 3.6 0" stroke-width="1.3"/>`,
    'volume': `<path ${F} d="M3.5 9.3v5.4c0 .6.4 1 1 1h3l4.4 3.8c.6.5 1.6.1 1.6-.8V5.3c0-.9-1-1.3-1.6-.8L7.5 8.3h-3c-.6 0-1 .4-1 1z"/><path ${S} d="M16.2 8.8a4.5 4.5 0 0 1 0 6.4M18.8 6.2a8.2 8.2 0 0 1 0 11.6"/>`,
    'volume-mute': `<path ${F} d="M3.5 9.3v5.4c0 .6.4 1 1 1h3l4.4 3.8c.6.5 1.6.1 1.6-.8V5.3c0-.9-1-1.3-1.6-.8L7.5 8.3h-3c-.6 0-1 .4-1 1z"/><path ${S} d="M16.5 9.5l5 5M21.5 9.5l-5 5"/>`,
    'equalizer': `<path ${S} d="M5 20v-6M5 10V4M12 20v-9M12 7V4M19 20v-4M19 12V4M3 14h4M10 7h4M17 12h4"/>`,
    'speed': `<path ${S} d="M3.5 17.5a8.8 8.8 0 1 1 17 0"/><path ${S} d="M12 14.5l4.2-5"/><circle ${F} cx="12" cy="14.8" r="1.7"/><path ${S} d="M6.2 11.5l1.2.6M12 6.5v1.3M17.8 11.5l-1.2.6" stroke-width="1.4"/>`,
    'filter': `<circle ${S} cx="12" cy="8.5" r="5"/><circle ${S} cx="8.5" cy="14.5" r="5"/><circle ${S} cx="15.5" cy="14.5" r="5"/>`,
    'info': `<circle ${S} cx="12" cy="12" r="8.5"/><path ${S} d="M12 11v5.5"/><circle ${F} cx="12" cy="7.7" r="1.2"/>`,
    'sidebar': `<rect ${S} x="2.8" y="4.5" width="18.4" height="15" rx="2.2"/><path ${S} d="M9 4.5v15M5 8h2M5 10.5h2M5 13h2"/>`,
    'search': `<circle ${S} cx="10.5" cy="10.5" r="6"/><path ${S} d="M15 15l5 5"/>`,
    'gear': `<path ${S} d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z"/><path ${S} d="M10.4 3.2h3.2l.5 2.4 1.8 1 2.3-.8 1.6 2.8-1.8 1.6v2l1.8 1.6-1.6 2.8-2.3-.8-1.8 1-.5 2.4h-3.2l-.5-2.4-1.8-1-2.3.8-1.6-2.8 1.8-1.6v-2L4.2 8.6l1.6-2.8 2.3.8 1.8-1z"/>`,
    'plus': `<path ${S} d="M12 5v14M5 12h14" stroke-width="2"/>`,
    'minus': `<path ${S} d="M5 12h14" stroke-width="2"/>`,
    'plus-circle': `<circle ${F} cx="12" cy="12" r="9.5"/><path d="M12 7.5v9M7.5 12h9" stroke="#000" stroke-opacity=".75" stroke-width="2.2" stroke-linecap="round"/>`,
    'ellipsis': `<circle ${F} cx="6" cy="12" r="1.7"/><circle ${F} cx="12" cy="12" r="1.7"/><circle ${F} cx="18" cy="12" r="1.7"/>`,
    'ellipsis-circle': `<circle ${S} cx="12" cy="12" r="9"/><circle ${F} cx="7.8" cy="12" r="1.3"/><circle ${F} cx="12" cy="12" r="1.3"/><circle ${F} cx="16.2" cy="12" r="1.3"/>`,
    'music': `<path ${F} d="M19.5 3.3v11.9a3 3 0 1 1-1.8-2.8V7.6L9.5 9.4v7.8a3 3 0 1 1-1.8-2.8V6.4c0-.5.3-.9.8-1l10.2-2.6c.4-.1.8.2.8.5z"/>`,
    'camera': `<rect ${F} x="2.5" y="6" width="13.5" height="12" rx="2.4"/><path ${F} d="M17.3 10.1l3.5-2.3c.6-.4 1.2 0 1.2.7v7c0 .7-.6 1.1-1.2.7l-3.5-2.3z"/>`,
    'folder': `<path ${F} d="M3 6.8c0-1 .8-1.8 1.8-1.8h4.4c.5 0 1 .2 1.3.6l1.3 1.4h7.4c1 0 1.8.8 1.8 1.8v9.4c0 1-.8 1.8-1.8 1.8H4.8c-1 0-1.8-.8-1.8-1.8z"/>`,
    'desktop': `<rect ${S} x="2.8" y="4" width="18.4" height="12.5" rx="1.6"/><path ${S} d="M9 20h6M12 16.5V20"/>`,
    'doc': `<path ${S} d="M6 3.5h8l4.5 4.5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/><path ${S} d="M14 3.5V8h4.5"/>`,
    'film': `<rect ${S} x="3.5" y="3" width="17" height="18" rx="2"/><path ${S} d="M7.5 3v18M16.5 3v18M3.5 8h4M3.5 12h4M3.5 16h4M16.5 8h4M16.5 12h4M16.5 16h4"/>`,
    'star': `<path ${F} d="M12 2.8l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 16.6l-5.6 3.2 1.3-6.2L3 9.3l6.3-.7z"/>`,
    'star-outline': `<path ${S} d="M12 3.2l2.6 5.6 6.1.7-4.5 4.1 1.2 6L12 16.6 6.6 19.6l1.2-6-4.5-4.1 6.1-.7z"/>`,
    'library': `<path ${F} d="M12 2.2l2.9 6.2 6.8.8-5 4.6 1.4 6.7L12 17.1l-6.1 3.4 1.4-6.7-5-4.6 6.8-.8z" opacity=".95"/>`,
    'photos': `<g ${F}><ellipse cx="12" cy="6.2" rx="2.6" ry="3.8" opacity=".95"/><ellipse cx="12" cy="17.8" rx="2.6" ry="3.8" opacity=".7"/><ellipse cx="6.2" cy="12" rx="3.8" ry="2.6" opacity=".8"/><ellipse cx="17.8" cy="12" rx="3.8" ry="2.6" opacity=".85"/><ellipse cx="7.9" cy="7.9" rx="2.6" ry="3.8" transform="rotate(-45 7.9 7.9)" opacity=".6"/><ellipse cx="16.1" cy="16.1" rx="2.6" ry="3.8" transform="rotate(-45 16.1 16.1)" opacity=".75"/><ellipse cx="16.1" cy="7.9" rx="2.6" ry="3.8" transform="rotate(45 16.1 7.9)" opacity=".9"/><ellipse cx="7.9" cy="16.1" rx="2.6" ry="3.8" transform="rotate(45 7.9 16.1)" opacity=".65"/></g>`,
    'project-media': `<rect ${S} x="3" y="5" width="18" height="14" rx="2"/><path ${F} d="M10 9.2v5.6c0 .4.4.6.7.4l4.4-2.8a.5.5 0 0 0 0-.8l-4.4-2.8c-.3-.2-.7 0-.7.4z"/>`,
    'rotate-left': `<path ${S} d="M4.5 8.5h8a6 6 0 1 1-6 6.2"/><path ${S} d="M8 5 4.5 8.5 8 12"/>`,
    'rotate-right': `<path ${S} d="M19.5 8.5h-8a6 6 0 1 0 6 6.2"/><path ${S} d="M16 5l3.5 3.5L16 12"/>`,
    'check-circle': `<circle ${F} cx="12" cy="12" r="10"/><path d="M7.3 12.3l3.1 3.1 6.3-6.6" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>`,
    'check': `<path ${S} d="M5 12.5l4.5 4.5L19 7.5" stroke-width="2"/>`,
    'xmark': `<path ${S} d="M6 6l12 12M18 6 6 18" stroke-width="2"/>`,
    'xmark-circle': `<circle ${F} cx="12" cy="12" r="9.5"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="#2a2a2a" stroke-width="2" stroke-linecap="round"/>`,
    'turtle': `<path ${F} d="M4.5 14.5c0-3.6 3-6.5 7-6.5s7 2.9 7 6.5z"/><path ${F} d="M19 12.5c.5-1.2 1.6-2 2.7-1.6.6.2.5 1.2-.1 1.4l-1.7.9zM6 15.2l-.9 2.3h2l.8-2.3zM15 15.2l.9 2.3h-2l-.8-2.3zM3.8 14.5l-1.3 1"/>`,
    'hare': `<path ${F} d="M6 17.5c-1.6 0-2.5-.9-2.5-2 0-2.8 3.2-5.3 7.2-5.3 1.5 0 2.7.3 3.7.8l1.6-4.2c.3-.8 1.4-.9 1.7-.1.2.5 0 1.4-.4 2.5l1.3-2c.5-.7 1.5-.4 1.4.4-.1 1-1 2.6-2.3 4 1 .8 1.8 1.9 1.8 3 0 1.6-1.4 2.9-3.2 2.9z"/>`,
    'transition': `<path ${F} d="M4 5.5v13l8-6.5zM20 5.5v13l-8-6.5z"/>`,
    'trash': `<path ${S} d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13a1 1 0 0 0 1 .9h7a1 1 0 0 0 1-.9l1-13M10 10v7M14 10v7"/>`,
    'eyedropper': `<path ${S} d="M14.5 5.5l4 4M16.5 3.5a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8L18 10 14 6zM15.5 8.5l-9.3 9.3-2.6 2.8.5-3.2 9.4-9.4"/>`,
    'record': `<circle cx="12" cy="12" r="10" fill="#fff" fill-opacity=".92"/><circle cx="12" cy="12" r="7.6" fill="#ff3b30"/>`,
    'stop-record': `<circle cx="12" cy="12" r="10" fill="#fff" fill-opacity=".92"/><rect x="7.5" y="7.5" width="9" height="9" rx="1.6" fill="#ff3b30"/>`,
    'align-left': `<path ${S} d="M4 6h16M4 10h10M4 14h16M4 18h10"/>`,
    'align-center': `<path ${S} d="M4 6h16M7 10h10M4 14h16M7 18h10"/>`,
    'align-right': `<path ${S} d="M4 6h16M10 10h10M4 14h16M10 18h10"/>`,
    'align-justify': `<path ${S} d="M4 6h16M4 10h16M4 14h16M4 18h16"/>`,
    'bold': `<path ${F} d="M7 4h5.8c2.9 0 4.6 1.4 4.6 3.6 0 1.6-1.1 2.8-2.6 3.1v.1c1.9.2 3.2 1.6 3.2 3.4 0 2.6-2 4.3-5.2 4.3H7zm3 2.4v4h2.2c1.6 0 2.4-.7 2.4-2s-.9-2-2.3-2zm0 6.2v4.5h2.6c1.8 0 2.7-.8 2.7-2.3s-1-2.2-2.8-2.2z"/>`,
    'italic': `<path ${F} d="M10 4h7v2h-2.6l-2.8 12H14v2H7v-2h2.6l2.8-12H10z"/>`,
    'outline-text': `<path fill="none" stroke="currentColor" stroke-width="1.2" d="M4.5 19.5 10.6 4h2.8l6.1 15.5h-3l-1.5-4.1H9l-1.5 4.1zm5.4-6.6h4.2L12 7.2z"/>`,
    'apple': `<path ${F} d="M16.4 12.6c0-2.5 2-3.7 2.1-3.8-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.1 2.5-1.8 3.1-.5 7.6 1.3 10.1.8 1.2 1.8 2.6 3.1 2.5 1.3 0 1.7-.8 3.3-.8 1.5 0 1.9.8 3.3.8 1.4 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8-.1 0-2.6-1-2.6-4.1zM14 5.3c.7-.8 1.1-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z"/>`,
    'wifi': `<path ${F} d="M12 19.5l2.4-2.9a3.6 3.6 0 0 0-4.8 0zM5.9 12.2l1.6 1.9a7 7 0 0 1 9 0l1.6-1.9a9.6 9.6 0 0 0-12.2 0zM2.6 8.3l1.6 1.9a12.2 12.2 0 0 1 15.6 0l1.6-1.9a14.8 14.8 0 0 0-18.8 0z"/>`,
    'battery': `<rect fill="none" stroke="currentColor" stroke-opacity=".6" stroke-width="1.2" x="1.8" y="7" width="18" height="10" rx="2.6"/><rect ${F} x="3.4" y="8.6" width="12.5" height="6.8" rx="1.3"/><path ${F} opacity=".6" d="M21.2 10.3v3.4c.8-.3 1.3-1 1.3-1.7s-.5-1.4-1.3-1.7z"/>`,
    'control-center': `<rect fill="none" stroke="currentColor" stroke-width="1.5" x="3" y="5" width="18" height="6" rx="3"/><circle ${F} cx="18" cy="8" r="1.8"/><rect fill="none" stroke="currentColor" stroke-width="1.5" x="3" y="13" width="18" height="6" rx="3"/><circle ${F} cx="6" cy="16" r="1.8"/>`,
    'spotlight': `<circle fill="none" stroke="currentColor" stroke-width="2" cx="10" cy="10" r="5.5"/><path stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M14.5 14.5l5 5"/>`,
    'lock': `<rect ${F} x="5" y="10.5" width="14" height="10" rx="2"/><path ${S} d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>`,
    'heart': `<path ${F} d="M12 20.5s-8.5-5.1-8.5-11A4.8 4.8 0 0 1 12 6.6a4.8 4.8 0 0 1 8.5 2.9c0 5.9-8.5 11-8.5 11z"/>`,
    'scissors': `<circle ${S} cx="6.5" cy="17.5" r="2.8"/><circle ${S} cx="6.5" cy="6.5" r="2.8"/><path ${S} d="M8.8 8.3 20 18M8.8 15.7 20 6"/>`,
    'waveform': `<path ${S} d="M3 12h1.5M6.5 8v8M10 5v14M13.5 9v6M17 6.5v11M20.5 10.5v3"/>`,
    'photo': `<rect ${S} x="3" y="5" width="18" height="14" rx="2"/><circle ${F} cx="8.5" cy="9.5" r="1.7"/><path ${F} d="M4 18l5-5.5 3.5 3.5 3-3L20 17.5V18z"/>`,
    'email': `<rect ${S} x="3" y="5.5" width="18" height="13" rx="2"/><path ${S} d="M3.5 7l8.5 6.5L20.5 7"/>`,
    'globe': `<circle ${S} cx="12" cy="12" r="8.8"/><path ${S} d="M3.5 12h17M12 3.2c2.6 2.4 3.9 5.4 3.9 8.8s-1.3 6.4-3.9 8.8c-2.6-2.4-3.9-5.4-3.9-8.8S9.4 5.6 12 3.2z"/>`,
    'movie-file': `<path ${S} d="M6 3.5h8l4.5 4.5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/><path ${F} d="M10 11v6c0 .4.4.6.7.4l4.4-3a.5.5 0 0 0 0-.8l-4.4-3c-.3-.2-.7 0-.7.4z"/>`,
    'theater': `<rect ${S} x="2.5" y="4.5" width="19" height="12" rx="1.5"/><path ${S} d="M7 20h10"/>`,
    'magic-movie': `<rect ${S} x="3" y="5" width="18" height="14" rx="2.5"/><path ${F} d="M13 7.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9zM8.3 12l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/>`,
    'storyboard': `<rect ${S} x="3" y="4" width="8" height="7" rx="1.5"/><rect ${S} x="13" y="4" width="8" height="7" rx="1.5"/><rect ${S} x="3" y="13" width="8" height="7" rx="1.5"/><rect ${S} x="13" y="13" width="8" height="7" rx="1.5"/>`,
    'trailer': `<path ${F} d="M3.5 9.5h17v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path ${F} d="M3.2 8.2 19.4 4a.9.9 0 0 1 1.1.6l.5 1.9L4.6 10.8l-.9-.2-.5-1.9a.9.9 0 0 1 0-.5z" opacity=".8"/>`,
    'movie': `<rect ${S} x="3" y="5" width="18" height="14" rx="2.5"/><path ${F} d="M10 9v6c0 .4.4.6.7.4l4.4-3a.5.5 0 0 0 0-.8l-4.4-3c-.3-.2-.7 0-.7.4z"/>`,
    'loop': `<path ${S} d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H19M16 3l3 3-3 3M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H5M8 21l-3-3 3-3"/>`,
    'meters': `<rect ${F} x="7" y="4" width="3.5" height="16" rx="1" opacity=".5"/><rect ${F} x="7" y="10" width="3.5" height="10" rx="1"/><rect ${F} x="13.5" y="4" width="3.5" height="16" rx="1" opacity=".5"/><rect ${F} x="13.5" y="8" width="3.5" height="12" rx="1"/>`,
    'clock': `<circle ${S} cx="12" cy="12" r="8.5"/><path ${S} d="M12 7v5l3.5 2"/>`,
    'map': `<path ${S} d="M3.5 6.5 9 4.5l6 2 5.5-2v13L15 19.5l-6-2-5.5 2z"/><path ${S} d="M9 4.5v13M15 6.5v13"/>`,
  };
  IM.ICONS = icons;
  /** Returns an SVG element for the given icon name. */
  IM.icon = function (name, size, cls) {
    const span = document.createElement('span');
    span.className = 'ic' + (cls ? ' ' + cls : '');
    const s = size || 16;
    span.innerHTML = `<svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true">${icons[name] || ''}</svg>`;
    return span;
  };
  IM.iconHTML = function (name, size) {
    const s = size || 16;
    return `<span class="ic"><svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true">${icons[name] || ''}</svg></span>`;
  };
})(window.IM = window.IM || {});
