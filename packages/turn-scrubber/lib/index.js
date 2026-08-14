//#region src/index.ts
/**
* Node half of dsh-turn-scrubber: a deliberate no-op.
*
* The feature is entirely client-side (the turn rail reads the browser
* session store and the rendered conversation DOM), but the bundle stack
* mounts plugin entries by package name, so the package ships a stub
* main that does nothing on the host.
*/
const inject = [];
function apply(_ctx) {}
//#endregion
export { apply, inject };
