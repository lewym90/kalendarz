// Co trwa i co jest następne w planie dnia.
export function nextUp(list, now = new Date()) {
  const timed = list.filter((i) => !i.allDay).sort((a, b) => a.start - b.start);
  return { live: timed.filter((i) => i.start <= now && i.end > now), next: timed.find((i) => i.start > now) || null };
}
