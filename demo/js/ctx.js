// Shared app context, filled in by app.js at start-up. Screens import this instead of app.js (no import cycles).
export const ctx = {};
export const state = { view: 'home', person: 'Family', tab: {}, lastActive: Date.now(), syncing: false };
