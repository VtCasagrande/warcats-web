import {writeFile} from 'node:fs/promises';
// Production vectors distilled from the Magnific references; originals stay in the art archive.
// True SVG geometry, currentColor-compatible and readable at 20–24 px.
const icons={
 transport:'<path d="M5 10V6a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v4M7 9h10l3 4v6H4v-6l3-4ZM8 6h8M4 14h16M8 19v2M16 19v2"/><circle cx="7.5" cy="16.5" r=".6"/><circle cx="16.5" cy="16.5" r=".6"/>',
 pilot:'<path d="M3 4h18M12 3v4M5 21h14M7 18h10M9 18v3M15 18v3M6 12a6 6 0 0 1 12 0v4a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-4Z M12 9v7M9 10v5M15 10v5"/>',
 suppression:'<path d="m4 3 6 6M2 8l5 5M1 13l3 3M13 5l8 3v6c0 4-4 6-6 7-2-1-6-3-6-7v-3"/>',
 spot:'<path d="m12 3 9 9-9 9-9-9 9-9ZM12 8v2M12 14v2M8 12h2M14 12h2"/>',
 arsenal:'<path d="M2 10h12l2 2h6v2h-8l-3-1H6l-2 4H2l1-5ZM7 13l-1 4h4l1-4M9 7h6v3M10 7V5h4v2M17 12V9"/>',
 skins:'<path d="m3 15 12-12h6v6L9 21H3v-6ZM3 15h6v6M9 9h6v6M15 3v6h6M6 12l6 6"/>',
 operations:'<circle cx="12" cy="12" r="4"/><path d="m8 3 4 3 4-3M3 8l3 4-3 4M8 21l4-3 4 3M21 8l-3 4 3 4"/>',
 account:'<path d="M5 12V9a7 7 0 0 1 14 0v3M4 11h16M7 12v3a5 5 0 0 0 10 0v-3M3 22c1-4 5-5 9-5s8 1 9 5M9 8V6M15 8V6"/>',
 settings:'<path d="M6 3v4M6 13v8M12 3v9M12 18v3M18 3v2M18 11v10M4 7h4v6H4V7ZM10 12h4v6h-4v-6ZM16 5h4v6h-4V5Z"/>'
};
for(const[key,body]of Object.entries(icons))await writeFile(`public/assets/magnific/expansion/icons/${key}.svg`,`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#e8edd9" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`);
