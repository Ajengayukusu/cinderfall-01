// nav.js — route finding over the yard's waypoint graph. The graph is small and hand-laid
// (world.js), so breadth-first search is all it needs; bots ask for a path of node names and
// then steer node to node with the shared physics, which keeps their movement honest around
// corners instead of cutting through cover.

import { NODES, EDGES } from './world.js';

const adjacency = new Map();
for (const name of Object.keys(NODES)) adjacency.set(name, []);
for (const [a, b] of EDGES) {
  adjacency.get(a).push(b);
  adjacency.get(b).push(a);
}

export function nodePos(name) {
  const [x, z] = NODES[name];
  return { x, z };
}

export function nearestNode(x, z) {
  let best = null, bestD = Infinity;
  for (const name of Object.keys(NODES)) {
    const [nx, nz] = NODES[name];
    const d = (nx - x) * (nx - x) + (nz - z) * (nz - z);
    if (d < bestD) { bestD = d; best = name; }
  }
  return best;
}

// Shortest path as a list of node names including both ends, or null when unreachable.
export function findPath(fromName, toName) {
  if (fromName === toName) return [fromName];
  const prev = new Map([[fromName, null]]);
  const queue = [fromName];
  while (queue.length) {
    const cur = queue.shift();
    for (const next of adjacency.get(cur)) {
      if (prev.has(next)) continue;
      prev.set(next, cur);
      if (next === toName) {
        const path = [toName];
        let p = cur;
        while (p !== null) { path.unshift(p); p = prev.get(p); }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

// Path from wherever a body stands: start at its nearest node, end at the goal node.
export function pathFrom(x, z, toName) {
  return findPath(nearestNode(x, z), toName);
}
