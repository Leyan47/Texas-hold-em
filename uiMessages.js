export function appendLogMessage(messages, message, limit = 8) {
  const nextMessages = [...messages, message];
  return nextMessages.slice(Math.max(0, nextMessages.length - limit));
}
