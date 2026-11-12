// Set only by the server itself when an assistant's call is passed to one of Clue's own routes. A symbol cannot come
// from the network, so a request from outside can never claim to be an assistant call.
export const AGENT_USER = Symbol('clue.agentUser');
