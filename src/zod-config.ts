import { config } from "zod";

// Zod's JIT probes `new Function("")`; under the CSP (script-src 'self', no 'unsafe-eval') that probe is reported as
// a securitypolicyviolation even though Zod catches the throw. Jitless skips the probe; parsing is unchanged.
config({ jitless: true });
