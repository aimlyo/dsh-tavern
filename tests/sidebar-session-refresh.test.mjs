import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// Execute the sidebar's real effect and dependencies under summary snapshot churn.
const source = readFileSync(new URL('../tavern-plugin/src/client/main.js', import.meta.url), 'utf8')
const effect = source.match(/React\.useEffect\(function \(\) \{\s*if \(!currentSummary \|\| currentSummary.blank\) return;\s*notifyDataChanged\(\["sessions"\]\);\s*\}, \[[^\]]+\]\);/)[0]
test('session metadata snapshots do not fan out catalog refreshes; readiness and switching still do', () => {
  let previous, refreshes = 0
  const sandbox = { current: 'A', currentSummary: undefined,
    notifyDataChanged: () => { refreshes++ }, React: { useEffect(fn, deps) {
      if (!previous || deps.some((value, i) => !Object.is(value, previous[i]))) fn()
      previous = deps
    } }
  }
  const render = (id, summary) => { sandbox.current = id; sandbox.currentSummary = summary; vm.runInNewContext(effect, sandbox) }
  render('A', undefined)
  render('A', { blank: true })
  assert.equal(refreshes, 0)
  for (let i = 0; i < 30; i++) render('A', { blank: false, title: 'title-' + i, updatedAt: i, phase: i % 2 ? 'running' : 'idle' })
  assert.equal(refreshes, 1, 'one readiness transition must not trigger 30 catalog refreshes')
  render('B', { blank: false })
  assert.equal(refreshes, 2)
  render('B', { blank: true })
  render('B', { blank: false })
  assert.equal(refreshes, 3)
})

test('opening the card picker reloads cards created outside this browser', async () => {
  const start = source.indexOf('function openPicker()');
  const end = source.indexOf('function closePicker()', start);
  const pickerSource = source.slice(start, end);
  let diskCards = ['original'], cards = ['original'];
  const sandbox = {
    uiMode: 'play', openingPicker: null,
    setMenuSession() {}, setCardEntry() {}, setError() {}, setPicking() {}, setRequestMode() {},
    setCards(value) { cards = value }, console,
    call: async method => method === 'listCards' ? { cards: [...diskCards] } : {},
    tavernErrorHub: { resolve() {}, report() {} }
  };
  vm.runInNewContext(pickerSource, sandbox);
  diskCards.push('converted');
  sandbox.openPicker();
  await new Promise(r => setImmediate(r));
  assert.deepEqual(cards, diskCards, 'newly converted cards must appear without reloading the page');
});
