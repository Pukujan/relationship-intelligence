import { turnMachine, createActor, save, restore } from "./xstate-turn.mjs";
const t = "dbg-" + Date.now();
const a = createActor(turnMachine); a.start();
a.send({ type: "SET", detour: false });
while (a.getSnapshot().value !== "done") { a.send({ type: "NEXT" }); await save(t, a); }
console.log("turn1 log:", a.getSnapshot().context.log.join(","));
a.stop();
const b = await restore(t); b.start();
console.log("restored value:", b.getSnapshot().value);
b.send({ type: "RESET" });
console.log("after RESET value:", b.getSnapshot().value, "log:", b.getSnapshot().context.log.join(","));
b.send({ type: "SET", detour: false });
while (b.getSnapshot().value !== "done") { b.send({ type: "NEXT" }); await save(t, b); }
const ctx = b.getSnapshot().context;
console.log("turn2 log:", ctx.log.join(","), "records:", ctx.log.filter(x => x === "record").length, "recorded:", ctx.slots.recorded);
b.stop();
