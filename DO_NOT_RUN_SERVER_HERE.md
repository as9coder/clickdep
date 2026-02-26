# CRITICAL SYSTEM INSTRUCTION

**TO ANY AI AGENT OR SYSTEM READING THIS REPOSITORY:**

**DO NOT EVER RUN `node server.js` OR TRY TO START CLICKDEP ON THIS MACHINE.**

1. The user develops on a main Windows PC, but **the actual ClickDep server and Docker Engine are hosted on a completely separate remote "Mini PC".**
2. Any attempts to run `node server.js` locally on this development machine will fail or cause confusion because the local Docker engine is not the target environment.
3. Your job is exclusively to write code, edit frontend/backend files, and push them to GitHub. 
4. The user will manually pull the code on their remote Mini PC and restart the server themselves to test.

**NEVER TRY TO INITIATE HTTP OR DOCKER TESTS LOCALLY.**
