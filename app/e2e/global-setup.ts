import { startStubIdp } from "./stub-idp.js";
export default async function globalSetup() {
  const server = await startStubIdp(8791);
  return async () => { await new Promise<void>((r) => server.close(() => r())); };
}
