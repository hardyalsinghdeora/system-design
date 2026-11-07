import { AutocompleteTrie } from './trie-autocomplete';

const log: [string, number][] = [
  ['weather today', 120], ['weather tomorrow', 80], ['weather radar', 40], ['web mail', 95],
  ['webcam', 30], ['wedding dresses', 25], ['west coast ferries', 10], ['what time is it', 150],
  ['whatsapp web', 140], ['where is my order', 60],
];

const cached = new AutocompleteTrie({ topK: 5 });
const dfs = new AutocompleteTrie({ topK: 5, mode: 'dfs' });
for (const [q, n] of log) {
  cached.insert(q, n);
  dfs.insert(q, n);
}

const show = (label: string, prefix: string): void => {
  const list = cached.suggest(prefix).map((s) => `${s.query} (${s.count})`);
  console.log(`  ${label.padEnd(24)} "${prefix}" -> ${list.join(', ') || '(none)'}`);
};

console.log('\nAutocomplete over an aggregated query log\n');
show('typing', 'w');
show('typing', 'we');
show('typing', 'WEAther ');
show('unknown prefix', 'xyz');

cached.increment('weather radar', 200);
dfs.increment('weather radar', 200);
console.log('\nA storm warning: "weather radar" gets 200 more searches');
show('after the spike', 'we');

cached.delete('wedding dresses');
dfs.delete('wedding dresses');
show('after a takedown', 'wed');

for (let i = 0; i < 20_000; i++) {
  cached.insert(`w${i.toString(36)}`, 1 + (i % 17));
  dfs.insert(`w${i.toString(36)}`, 1 + (i % 17));
}
cached.suggest('w');
dfs.suggest('w');
const c = cached.stats();
const d = dfs.stats();
console.log('\nMemory vs latency with 20,010 queries');
console.log(`  cached: ${c.nodes} nodes, ${c.cachedEntries} cached suggestions, suggest("w") visited ${cached.lastVisited} nodes`);
console.log(`  dfs:    ${d.nodes} nodes, ${d.cachedEntries} cached suggestions, suggest("w") visited ${dfs.lastVisited} nodes\n`);
