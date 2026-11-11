// Gives a slow step a deadline, so a screen never waits for ever on something that is not coming back.
export function withDeadline(promise, ms, what = 'This') {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(`${what} took longer than ${Math.round(ms / 1000)} seconds`), { name: 'TimeoutError' })), ms); });
  return Promise.race([Promise.resolve(promise), late]).finally(() => clearTimeout(timer));
}
