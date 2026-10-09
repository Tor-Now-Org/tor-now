import { initBotId } from "botid/client/core";

// ADR 0027: the sign-in route checks for bots, and needs the browser to have
// run BotID's challenge before it asks.
initBotId({
  protect: [{ path: "/api/auth/request-code", method: "POST" }],
});
