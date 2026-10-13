/**
 * ?qa: the game as the QA player (apps/qa) plays it. Developer views stay out of its reach and out
 * of its screenshots: the stats overlay (it shows coordinates) and the Game Boy screen in the
 * corner, which also stays off so its old graphics aren't mistaken for the HD game's.
 */
export const QA_RUN = new URLSearchParams(location.search).has("qa");
