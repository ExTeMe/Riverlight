const paths={
  home:'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9', building:'M4 21V5h9v16M13 10h7v11M7 8h3M7 12h3M7 16h3M16 14h1M16 18h1M2 21h20',
  landmark:'m3 9 9-6 9 6H3Zm2 3v7m5-7v7m4-7v7m5-7v7M3 21h18', tree:'m12 3-6 8h3l-5 6h6v4h4v-4h6l-5-6h3L12 3Z',
  road:'M7 3 4 21M17 3l3 18M12 3v4m0 4v3m0 4v3', flower:'M12 12c-8-12-12 0-3 1-10 2-3 11 3 3 4 9 13 1 4-3 9-3 1-13-4-1ZM12 16v6',
  sun:'M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  cloud:'M6 18h12a4 4 0 0 0 0-8 6 6 0 0 0-11.7-1A4.5 4.5 0 0 0 6 18Z', rain:'M5 15a4 4 0 0 1 1-8 6 6 0 0 1 11.5 1A3.5 3.5 0 0 1 19 15M8 17l-1 3m6-3-1 3m6-3-1 3',
  snow:'M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 4l3 3 3-3M9 20l3-3 3 3', fog:'M4 8h16M2 12h20M4 16h16M8 20h8',
  camera:'M4 7h4l2-3h4l2 3h4v13H4V7Zm12 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z', select:'m5 3 14 10-7 1-3 7L5 3Z', erase:'m15 3 7 7-11 11H7L2 16 15 3ZM9 9l7 7M11 21h11',
  undo:'M9 4 4 9l5 5M4 9h10a6 6 0 0 1 0 12', redo:'m15 4 5 5-5 5m5-5H10a6 6 0 0 0 0 12',close:'M6 6l12 12M6 18 18 6',plus:'M12 5v14M5 12h14',minus:'M5 12h14',
  expand:'M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6M8 8l-5-5m13 5 5-5M8 16l-5 5m13-5 5 5',layers:'m12 3 10 6-10 6L2 9l10-6ZM2 13l10 6 10-6M2 17l10 6 10-6',folder:'M3 6h7l2 3h9v11H3V6Z',
  sound:'M11 4 6 9H2v6h4l5 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',mute:'M11 4 6 9H2v6h4l5 5V4Zm5 5 6 6m0-6-6 6',settings:'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6',
  play:'m8 4 12 8-12 8V4Z',pause:'M8 4v16M16 4v16',compass:'m16 8-3 5-5 3 3-5 5-3Zm6 4a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',save:'M4 3h14l3 3v15H3V3h1Zm3 0v6h10V3M7 21v-8h10v8',
  download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',upload:'M12 15V3m-5 5 5-5 5 5M4 16v5h16v-5',move:'M12 2v20M2 12h20M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3',rotate:'M20 9a8 8 0 1 0 0 7M20 3v6h-6',copy:'M9 9h12v12H9V9ZM5 15H3V3h12v2',
  palette:'M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 1-4 2 2 0 0 1 1-4h3a3 3 0 0 0 2-3 9 9 0 0 0-9-7ZM7 8h.01M12 6h.01M17 8h.01M6 13h.01',eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',leaf:'M20 3C8 2 2 8 5 16c8 5 15-1 15-13ZM4 21 15 9',info:'M12 11v6m0-10v.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',chevron:'m9 5 7 7-7 7',check:'m5 12 4 4L19 6',
};
export const icon=(name,size=20)=>`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.home}"/></svg>`;
