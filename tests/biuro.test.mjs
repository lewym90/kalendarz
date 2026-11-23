// Kalendarz biura: subskrypcja .ics z Mojej Agencji, tylko do odczytu.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ICS = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:prezentacja-1@moja-agencja\r\nDTSTART:20261124T113000Z\r\nDTEND:20261124T123000Z\r\nSUMMARY:Prezentacja\r\nLOCATION:Mieszkanie\\, ul. Zmyślona 7\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:umowa-2@moja-agencja\r\nDTSTART;VALUE=DATE:20261126\r\nDTEND;VALUE=DATE:20261127\r\nSUMMARY:Koniec umowy pośrednictwa\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';

test('kalendarz biura: pobiera .ics i pokazuje wpisy jako cudze (tylko do odczytu)', async () => {
  globalThis.fetch = async (url) => ({ ok: true, status: 200, text: async () => (url.includes('dobry') ? ICS : '') });
  const b = await import('../js/biuro.js');
  await assert.rejects(() => b.setBiuro('https://example.com/kalendarz.html'), /adres kalendarza/);
  await b.setBiuro('webcal://biuro.example.com/publiczne/biuro/dobry.ics');
  assert.equal(b.biuroInfo().url, 'https://biuro.example.com/publiczne/biuro/dobry.ics');
  const ev = b.biuroEvents();
  assert.equal(ev.length, 2);
  assert.equal(ev[0].peer.name, 'Biuro');
  assert.equal(ev[0].loc, 'Mieszkanie, ul. Zmyślona 7');
  assert.equal(ev[1].allDay, true);
  const { peerEvents } = await import('../js/peers.js');
  assert.ok(peerEvents().some((e) => e.title === 'Koniec umowy pośrednictwa'));
  await b.setBiuro('');
  assert.equal(b.biuroEvents().length, 0);
});
